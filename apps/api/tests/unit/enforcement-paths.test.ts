import type { Request, Response } from "express";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  CaptchaRequiredError,
  KillSwitchActiveError,
  RateLimitedError,
  TempBlockedError,
} from "../../src/errors/domain-errors.js";
import {
  EnforcementEventNames,
  EnforcementType,
} from "../../src/observability/enforcement-events.js";
import type {
  EnforcementMetricInput,
  EnforcementMetrics,
} from "../../src/observability/enforcement-metrics.js";
import { createSubjectHasher } from "../../src/observability/pii.js";
import { InMemoryEnforcementStore } from "../../src/store/enforcement-store.js";
import type { EnforcementDeps } from "../../src/middleware/enforcement/deps.js";
import { captchaMiddleware } from "../../src/middleware/enforcement/captcha.js";
import { killSwitchMiddleware } from "../../src/middleware/enforcement/kill-switch.js";
import { quotaMiddleware } from "../../src/middleware/enforcement/quota.js";
import { rateLimitMiddleware } from "../../src/middleware/enforcement/rate-limit.js";
import { tempBlockMiddleware } from "../../src/middleware/enforcement/temp-block.js";
import { RecordingLogger } from "../helpers/recording-logger.js";

class RecordingMetrics implements EnforcementMetrics {
  readonly calls: EnforcementMetricInput[] = [];

  recordEnforcement(input: EnforcementMetricInput): void {
    this.calls.push(input);
  }
}

function makeDeps() {
  const logger = new RecordingLogger();
  const store = new InMemoryEnforcementStore();
  const metrics = new RecordingMetrics();
  const deps: EnforcementDeps = {
    logger: logger as unknown as Logger,
    metrics,
    store,
    subjectHash: createSubjectHasher("test-key"),
    service: "resume-roast-api",
    environment: "test",
    routeId: "api.resume.roast",
  };
  return { deps, logger, store, metrics };
}

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    ip: "203.0.113.10",
    socket: { remoteAddress: "203.0.113.10" },
    id: "req_test-123",
    body: {},
    header: () => undefined,
    ...overrides,
  } as unknown as Request;
}

const res = {} as Response;

describe("rateLimitMiddleware", () => {
  it("emits rate_limit.triggered once and throws 429 with a hashed subject", () => {
    const { deps, logger, metrics, store } = makeDeps();
    store.rateLimitDecision = {
      limited: true,
      policyId: "roast.rate_limit.v1",
      retryAfterSeconds: 60,
    };
    const next = vi.fn();
    const middleware = rateLimitMiddleware(deps);

    expect(() => middleware(makeReq(), res, next)).toThrow(RateLimitedError);
    expect(next).not.toHaveBeenCalled();

    const events = logger.records.filter(
      (record) => record.eventName === EnforcementEventNames.RateLimitTriggered,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.subjectHash).toMatch(/^h_/);
    expect(JSON.stringify(logger.records)).not.toContain("203.0.113.10");
    expect(metrics.calls).toHaveLength(1);
    expect(metrics.calls[0].type).toBe(EnforcementType.RateLimit);
  });
});

describe("quotaMiddleware", () => {
  it("emits only on an actual state change", () => {
    const { deps, logger, metrics, store } = makeDeps();
    const middleware = quotaMiddleware(deps);

    const next = vi.fn();
    store.quotaTransition = { from: "ok", to: "ok" };
    middleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.records).toHaveLength(0);

    const transitionNext = vi.fn();
    store.quotaTransition = { from: "warn", to: "delay" };
    middleware(makeReq(), res, transitionNext);
    expect(transitionNext).toHaveBeenCalledTimes(1);

    const events = logger.records.filter(
      (record) => record.eventName === EnforcementEventNames.QuotaStateChanged,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.fromState).toBe("warn");
    expect(events[0].payload.toState).toBe("delay");
    expect(metrics.calls).toHaveLength(1);
  });
});

describe("captchaMiddleware", () => {
  it("emits captcha.challenged and throws when a challenge is active", () => {
    const { deps, logger, metrics, store } = makeDeps();
    store.captchaChallengeRequired = true;
    const next = vi.fn();
    const middleware = captchaMiddleware(deps);

    expect(() => middleware(makeReq(), res, next)).toThrow(CaptchaRequiredError);
    const events = logger.records.filter(
      (record) => record.eventName === EnforcementEventNames.CaptchaChallenged,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.reason).toBe("quotaTier");
    expect(metrics.calls).toHaveLength(1);
  });

  it("emits captcha.passed without logging the token", () => {
    const { deps, logger, metrics, store } = makeDeps();
    store.captchaDecision = { outcome: "passed" };
    const next = vi.fn();
    const middleware = captchaMiddleware(deps);

    middleware(
      makeReq({ body: { captchaToken: "captcha-token-xyz" } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.records)).not.toContain("captcha-token-xyz");
    expect(
      logger.records.filter(
        (record) => record.eventName === EnforcementEventNames.CaptchaPassed,
      ),
    ).toHaveLength(1);
    expect(metrics.calls).toHaveLength(1);
  });

  it("emits captcha.failed with only the failure reason category", () => {
    const { deps, logger, store } = makeDeps();
    store.captchaDecision = { outcome: "invalid" };
    const next = vi.fn();
    const middleware = captchaMiddleware(deps);

    expect(() =>
      middleware(
        makeReq({ body: { captchaToken: "captcha-token-xyz", providerPayload: "secret" } }),
        res,
        next,
      ),
    ).toThrow(CaptchaRequiredError);
    const events = logger.records.filter(
      (record) => record.eventName === EnforcementEventNames.CaptchaFailed,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.failureReason).toBe("invalid");
    expect(JSON.stringify(logger.records)).not.toContain("captcha-token-xyz");
    expect(JSON.stringify(logger.records)).not.toContain('"providerPayload"');
  });
});

describe("tempBlockMiddleware", () => {
  it("emits temp_block.triggered and throws 429 with a Retry-After TTL", () => {
    const { deps, logger, metrics, store } = makeDeps();
    store.tempBlock = {
      blockTtlSeconds: 600,
      blockReason: "repeated_abuse_signals",
    };
    const next = vi.fn();
    const middleware = tempBlockMiddleware(deps);

    let caught: unknown;
    try {
      middleware(makeReq(), res, next);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TempBlockedError);
    expect((caught as TempBlockedError).retryAfter).toBe(600);
    expect(next).not.toHaveBeenCalled();

    const events = logger.records.filter(
      (record) => record.eventName === EnforcementEventNames.TempBlockTriggered,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.blockReason).toBe("repeated_abuse_signals");
    expect(events[0].payload.blockTtlSeconds).toBe(600);
    expect(metrics.calls).toHaveLength(1);
  });
});

describe("killSwitchMiddleware", () => {
  it("emits kill_switch.active and throws 503 with Retry-After 300", () => {
    const { deps, logger, metrics, store } = makeDeps();
    store.killSwitchState = "ACTIVE";
    const next = vi.fn();
    const middleware = killSwitchMiddleware(deps);

    let caught: unknown;
    try {
      middleware(makeReq(), res, next);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KillSwitchActiveError);
    expect((caught as KillSwitchActiveError).retryAfter).toBe(300);
    expect(next).not.toHaveBeenCalled();

    const events = logger.records.filter(
      (record) => record.eventName === EnforcementEventNames.KillSwitchActive,
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.killSwitchState).toBe("ACTIVE");
    expect(metrics.calls).toHaveLength(1);
  });

  it("passes through and emits nothing when inactive", () => {
    const { deps, logger, metrics, store } = makeDeps();
    store.killSwitchState = "INACTIVE";
    const next = vi.fn();
    killSwitchMiddleware(deps)(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.records).toHaveLength(0);
    expect(metrics.calls).toHaveLength(0);
  });
});
