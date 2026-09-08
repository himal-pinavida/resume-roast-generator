import request from "supertest";
import { Registry } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { createEnforcementMetrics } from "../../src/observability/enforcement-metrics.js";
import { EnforcementEventNames } from "../../src/observability/enforcement-events.js";
import { createSubjectHasher } from "../../src/observability/pii.js";
import { InMemoryEnforcementStore } from "../../src/store/enforcement-store.js";
import { createCapturingPinoLogger } from "../helpers/recording-logger.js";

function createHarness(options: { metricsEnabled?: boolean } = {}) {
  const capture = createCapturingPinoLogger();
  const registry = new Registry();
  const metrics = createEnforcementMetrics(registry, capture.logger);
  const store = new InMemoryEnforcementStore();
  const app = buildApp({
    logger: capture.logger,
    metrics,
    store,
    registry,
    subjectHash: createSubjectHasher("test-key"),
    environment: "test",
    service: "resume-roast-api",
    metricsEnabled: options.metricsEnabled,
  });
  return { app, logs: capture.records, registry, store, metrics };
}

describe("health and readiness", () => {
  it("serves /healthz and /readyz", async () => {
    const { app } = createHarness();
    const health = await request(app).get("/healthz").expect(200);
    expect(health.body).toEqual({ status: "ok", version: "1.0.0" });
    await request(app).get("/readyz").expect(200);
  });
});

describe("GET /metrics", () => {
  it("returns Prometheus text with all three counter families", async () => {
    const { app } = createHarness();
    const response = await request(app).get("/metrics").expect(200);

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("enforcement_triggers_total");
    expect(response.text).toContain("captcha_challenges_total");
    expect(response.text).toContain("quota_state_changes_total");
  });

  it("is not mounted when metrics are disabled", async () => {
    const { app } = createHarness({ metricsEnabled: false });
    await request(app).get("/metrics").expect(404);
  });

  it("routes a failing metrics collector through the error middleware", async () => {
    const capture = createCapturingPinoLogger();
    const failingRegistry = {
      metrics: vi.fn().mockRejectedValue(new Error("collector unavailable")),
    } as unknown as Registry;
    const store = new InMemoryEnforcementStore();
    const app = buildApp({
      logger: capture.logger,
      metrics: createEnforcementMetrics(new Registry(), capture.logger),
      store,
      registry: failingRegistry,
      subjectHash: createSubjectHasher("test-key"),
      environment: "test",
      service: "resume-roast-api",
    });

    const response = await request(app).get("/metrics").expect(500);

    expect(response.body.error.code).toBe("internal:server_error");
    expect(response.body.error.correlationId).toMatch(/^req_/);
    expect(response.headers["x-request-id"]).toBe(response.body.error.correlationId);

    const errorLogs = capture.records.filter(
      (record) => record.payload.msg === "Unhandled error for GET /metrics",
    );
    expect(errorLogs).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain("collector unavailable");
  });
});

describe("enforcement HTTP paths", () => {
  it("returns the rate-limit envelope with matching correlation IDs", async () => {
    const { app, logs, store } = createHarness();
    store.rateLimitDecision = {
      limited: true,
      policyId: "roast.rate_limit.v1",
      retryAfterSeconds: 60,
    };

    const response = await request(app)
      .post("/api/resume/roast")
      .send({ resumeText: "John Doe 555-123", consent: true })
      .expect(429);

    const correlationId = response.headers["x-request-id"];
    expect(correlationId).toMatch(/^req_/);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.body.error).toMatchObject({
      code: "enforcement:rate_limited",
      correlationId,
      details: { policyId: "roast.rate_limit.v1" },
    });

    const events = logs.filter(
      (record) => record.eventName === EnforcementEventNames.RateLimitTriggered,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.correlationId).toBe(correlationId);
  });

  it("returns 503 with Retry-After 300 when the kill switch is active", async () => {
    const { app, logs, store } = createHarness();
    store.killSwitchState = "ACTIVE";

    const response = await request(app).post("/api/resume/roast").send({}).expect(503);
    expect(response.headers["retry-after"]).toBe("300");
    expect(response.body.error.code).toBe("enforcement:kill_switch_active");

    expect(
      logs.filter(
        (record) => record.eventName === EnforcementEventNames.KillSwitchActive,
      ),
    ).toHaveLength(1);
  });

  it("returns 429 with Retry-After when a temporary block is applied", async () => {
    const { app, logs, store } = createHarness();
    store.tempBlock = {
      blockTtlSeconds: 600,
      blockReason: "repeated_abuse_signals",
    };

    const response = await request(app).post("/api/resume/roast").send({}).expect(429);
    expect(response.headers["retry-after"]).toBe("600");
    expect(response.body.error.code).toBe("enforcement:temp_blocked");
    expect(response.body.error.details).toEqual({
      blockReason: "repeated_abuse_signals",
      blockTtlSeconds: 600,
    });

    const events = logs.filter(
      (record) => record.eventName === EnforcementEventNames.TempBlockTriggered,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.blockTtlSeconds).toBe(600);
  });

  it("challenges a request when CAPTCHA escalation is required", async () => {
    const { app, logs, store } = createHarness();
    store.captchaChallengeRequired = true;

    const response = await request(app).post("/api/resume/roast").send({}).expect(429);
    expect(response.body.error.code).toBe("enforcement:captcha_required");
    expect(response.body.error.details).toEqual({ reason: "quotaTier" });

    const events = logs.filter(
      (record) => record.eventName === EnforcementEventNames.CaptchaChallenged,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.reason).toBe("quotaTier");
  });

  it("accepts the request when CAPTCHA verification passes", async () => {
    const { app, logs, store } = createHarness();
    store.captchaDecision = { outcome: "passed" };

    await request(app)
      .post("/api/resume/roast")
      .send({ captchaToken: "captcha-token-xyz" })
      .expect(202);

    expect(
      logs.filter(
        (record) => record.eventName === EnforcementEventNames.CaptchaPassed,
      ),
    ).toHaveLength(1);
  });

  it("rejects the request with a failure category when CAPTCHA verification fails", async () => {
    const { app, logs, store } = createHarness();
    store.captchaDecision = { outcome: "timeout" };

    const response = await request(app)
      .post("/api/resume/roast")
      .send({ captchaToken: "captcha-token-xyz" })
      .expect(429);
    expect(response.body.error.code).toBe("enforcement:captcha_required");
    expect(response.body.error.details).toEqual({ reason: "timeout" });

    const events = logs.filter(
      (record) => record.eventName === EnforcementEventNames.CaptchaFailed,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.failureReason).toBe("timeout");
  });

  it("emits quota state changes without rejecting the request", async () => {
    const { app, logs, store } = createHarness();
    store.quotaTransition = { from: "warn", to: "delay" };

    await request(app).post("/api/resume/roast").send({}).expect(202);

    const events = logs.filter(
      (record) => record.eventName === EnforcementEventNames.QuotaStateChanged,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ fromState: "warn", toState: "delay" });
  });

  it("keeps enforcement responses intact when the metrics backend throws", async () => {
    const { app, store, metrics } = createHarness();
    store.rateLimitDecision = { limited: true, policyId: "roast.rate_limit.v1" };

    const internal = metrics as unknown as { triggers: { inc: () => void } };
    internal.triggers.inc = () => {
      throw new Error("metrics backend unavailable");
    };

    const response = await request(app).post("/api/resume/roast").send({}).expect(429);
    expect(response.body.error.code).toBe("enforcement:rate_limited");
  });
});

describe("PII negatives", () => {
  it("never logs resume text, phone, raw IP, CAPTCHA token, or provider payload", async () => {
    const { app, logs } = createHarness();
    const body = {
      resumeText: "John Doe 555-123 203.0.113.10",
      phone: "555-123",
      captchaToken: "captcha-token-xyz",
      providerPayload: "secret-provider-payload",
    };

    await request(app).post("/api/resume/roast").send(body).expect(202);

    const serialized = JSON.stringify(logs);
    for (const forbidden of [
      "John Doe",
      "555-123",
      "203.0.113.10",
      "captcha-token-xyz",
      "secret-provider-payload",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const forbiddenField of ["resumeText", "token", "ip", "providerPayload"]) {
      expect(serialized).not.toContain(`"${forbiddenField}"`);
    }
  });

  it("never logs the raw request body when JSON parsing fails", async () => {
    const { app, logs } = createHarness();
    const rawBody =
      '{"resumeText":"John Doe 555-123 203.0.113.10","captchaToken":"captcha-token-xyz"} BAD';

    const response = await request(app)
      .post("/api/resume/roast")
      .set("Content-Type", "application/json")
      .send(rawBody)
      .expect(500);

    expect(response.body.error.code).toBe("internal:server_error");

    const serialized = JSON.stringify(logs);
    for (const forbidden of [
      "John Doe",
      "555-123",
      "203.0.113.10",
      "captcha-token-xyz",
      "resumeText",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
