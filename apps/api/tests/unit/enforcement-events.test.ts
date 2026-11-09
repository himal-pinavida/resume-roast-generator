import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import {
  EnforcementAction,
  EnforcementEventNames,
  EnforcementOutcome,
  EnforcementType,
  logEnforcementEvent,
} from "../../src/observability/enforcement-events.js";
import { hashSubject } from "../../src/observability/pii.js";
import { RecordingLogger } from "../helpers/recording-logger.js";

describe("EnforcementEventNames", () => {
  it("defines exactly the seven stable names", () => {
    expect(EnforcementEventNames).toEqual({
      RateLimitTriggered: "enforcement.rate_limit.triggered",
      QuotaStateChanged: "enforcement.quota.state_changed",
      CaptchaChallenged: "enforcement.captcha.challenged",
      CaptchaPassed: "enforcement.captcha.passed",
      CaptchaFailed: "enforcement.captcha.failed",
      TempBlockTriggered: "enforcement.temp_block.triggered",
      KillSwitchActive: "enforcement.kill_switch.active",
    });
  });
});

describe("hashSubject", () => {
  it("is deterministic, key-dependent, and never returns the input", () => {
    const secret = "test-key";
    const value = "203.0.113.10";
    const expected = `h_${createHmac("sha256", secret).update(value, "utf8").digest("hex")}`;

    expect(hashSubject(value, secret)).toBe(expected);
    expect(hashSubject(value, secret)).toBe(hashSubject(value, secret));
    expect(hashSubject(value, secret)).not.toContain(value);
    expect(hashSubject("John Doe", secret)).not.toContain("John Doe");
    expect(hashSubject(value, "other-key")).not.toBe(expected);
  });
});

describe("logEnforcementEvent", () => {
  it("always includes the typed event name and correlationId", () => {
    const logger = new RecordingLogger();
    const context = {
      correlationId: "req_test-123",
      service: "resume-roast-api",
      environment: "test",
      routeId: "api.resume.roast",
    };

    logEnforcementEvent(logger as unknown as Logger, context, {
      type: EnforcementEventNames.RateLimitTriggered,
      enforcementType: EnforcementType.RateLimit,
      action: EnforcementAction.Triggered,
      outcome: EnforcementOutcome.Blocked,
      httpStatus: 429,
      policyId: "roast.rate_limit.v1",
      subjectHash: "h_abc",
    });

    expect(logger.records).toHaveLength(1);
    const record = logger.records[0];
    expect(record.eventName).toBe(EnforcementEventNames.RateLimitTriggered);
    expect(record.payload.correlationId).toBe(context.correlationId);
    expect(record.payload.requestId).toBe(context.correlationId);
    expect(record.level).toBe("info");
    expect(record.payload.actor).toBe("anonymous");
    expect(record.payload.service).toBe(context.service);
    expect(record.payload.environment).toBe(context.environment);
    expect(record.payload.routeId).toBe(context.routeId);
    expect(typeof record.payload.timestamp).toBe("string");
    expect(record.payload.type).toBeUndefined();
  });
});
