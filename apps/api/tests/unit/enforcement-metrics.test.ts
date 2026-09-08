import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import { Registry } from "prom-client";
import {
  createEnforcementMetrics,
  type EnforcementMetrics,
} from "../../src/observability/enforcement-metrics.js";
import {
  EnforcementAction,
  EnforcementOutcome,
  EnforcementType,
} from "../../src/observability/enforcement-events.js";
import { RecordingLogger } from "../helpers/recording-logger.js";

async function samplesNamed(registry: Registry, name: string) {
  const metrics = await registry.getMetricsAsJSON();
  const metric = metrics.find((item) => item.name === name);
  return metric?.values ?? [];
}

describe("PromEnforcementMetrics", () => {
  it("increments all three counter families with bounded, PII-free labels", async () => {
    const registry = new Registry();
    const metrics = createEnforcementMetrics(registry);

    metrics.recordEnforcement({
      type: EnforcementType.RateLimit,
      action: EnforcementAction.Triggered,
      outcome: EnforcementOutcome.Blocked,
    });
    metrics.recordEnforcement({
      type: EnforcementType.Captcha,
      action: EnforcementAction.Challenged,
      outcome: EnforcementOutcome.Challenged,
    });
    metrics.recordEnforcement({
      type: EnforcementType.Captcha,
      action: EnforcementAction.Passed,
      outcome: EnforcementOutcome.Passed,
    });
    metrics.recordEnforcement({
      type: EnforcementType.Quota,
      action: EnforcementAction.StateChanged,
      outcome: EnforcementOutcome.StateChanged,
      from: "warn",
      to: "delay",
    });

    const triggerSamples = await samplesNamed(registry, "enforcement_triggers_total");
    expect(triggerSamples).toContainEqual(
      expect.objectContaining({
        labels: { type: "rate_limit", action: "triggered", outcome: "blocked" },
        value: 1,
      }),
    );
    expect(triggerSamples).toContainEqual(
      expect.objectContaining({
        labels: { type: "captcha", action: "challenged", outcome: "challenged" },
        value: 1,
      }),
    );

    const captchaSamples = await samplesNamed(registry, "captcha_challenges_total");
    expect(captchaSamples).toContainEqual(
      expect.objectContaining({ labels: { outcome: "passed" }, value: 1 }),
    );

    const quotaSamples = await samplesNamed(registry, "quota_state_changes_total");
    expect(quotaSamples).toContainEqual(
      expect.objectContaining({ labels: { from: "warn", to: "delay" }, value: 1 }),
    );

    const text = await registry.metrics();
    expect(text).toContain("enforcement_triggers_total");
    expect(text).toContain("captcha_challenges_total");
    expect(text).toContain("quota_state_changes_total");
  });

  it("never propagates a throwing metrics backend, throttles failure logs, and strips PII from failures", () => {
    const registry = new Registry();
    const logger = new RecordingLogger();
    const metrics = createEnforcementMetrics(registry, logger as unknown as Logger);

    const internal = metrics as unknown as { triggers: { inc: () => void } };
    const backendError = Object.assign(new Error("metrics backend unavailable"), {
      token: "captcha-token-xyz",
      body: '{"resumeText":"John Doe 555-123"}',
    });
    internal.triggers.inc = () => {
      throw backendError;
    };

    expect(() =>
      metrics.recordEnforcement({
        type: EnforcementType.RateLimit,
        action: EnforcementAction.Triggered,
        outcome: EnforcementOutcome.Blocked,
      }),
    ).not.toThrow();
    expect(() =>
      metrics.recordEnforcement({
        type: EnforcementType.RateLimit,
        action: EnforcementAction.Triggered,
        outcome: EnforcementOutcome.Blocked,
      }),
    ).not.toThrow();

    const failures = logger.records.filter((record) => record.level === "error");
    expect(failures).toHaveLength(1);
    expect(failures[0].payload.error).toBeUndefined();
    expect(failures[0].payload.err).toEqual({
      type: "Error",
      message: "metrics backend unavailable",
      stack: backendError.stack,
    });
    expect(JSON.stringify(failures[0].payload)).not.toContain("captcha-token-xyz");
    expect(JSON.stringify(failures[0].payload)).not.toContain("John Doe");
    expect(JSON.stringify(failures[0].payload)).not.toContain("resumeText");
  });

  it("supports the optional enforcement decision latency histogram", async () => {
    const registry = new Registry();
    const metrics: EnforcementMetrics = createEnforcementMetrics(registry);

    metrics.recordEnforcement({
      type: EnforcementType.KillSwitch,
      action: EnforcementAction.Active,
      outcome: EnforcementOutcome.Active,
      durationMs: 12,
    });

    const samples = await samplesNamed(registry, "enforcement_decision_latency_ms");
    expect(samples).toContainEqual(
      expect.objectContaining({ labels: { type: "kill_switch" }, value: 12 }),
    );
  });
});
