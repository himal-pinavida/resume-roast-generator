import { Counter, Histogram, Registry } from "prom-client";
import type { Logger } from "pino";
import type {
  EnforcementAction,
  EnforcementOutcome,
  EnforcementType,
  QuotaState,
} from "./enforcement-events.js";
import { EnforcementType as EnforcementTypeValue } from "./enforcement-events.js";
import { summarizeError } from "../logger/error-serializer.js";

/**
 * Enforcement counter families (ADR 0002). Label values are constrained to the bounded enums from
 * `enforcement-events.ts`; no IP, user agent, subject hash, résumé content, or route ID is ever a
 * label. The histogram is optional and is populated only when a caller supplies `durationMs`.
 */
export interface EnforcementMetricInput {
  type: EnforcementType;
  action: EnforcementAction;
  outcome: EnforcementOutcome;
  from?: QuotaState;
  to?: QuotaState;
  durationMs?: number;
}

export interface EnforcementMetrics {
  recordEnforcement(input: EnforcementMetricInput): void;
}

export class PromEnforcementMetrics implements EnforcementMetrics {
  private readonly triggers: Counter<"type" | "action" | "outcome">;
  private readonly captchaChallenges: Counter<"outcome">;
  private readonly quotaStateChanges: Counter<"from" | "to">;
  private readonly decisionLatency: Histogram<"type">;
  private lastFailureLogAt = 0;

  constructor(
    registry: Registry,
    private readonly logger?: Logger,
  ) {
    this.triggers = new Counter({
      name: "enforcement_triggers_total",
      help: "Total enforcement decisions, labelled by bounded type/action/outcome enums.",
      labelNames: ["type", "action", "outcome"],
      registers: [registry],
    });
    this.captchaChallenges = new Counter({
      name: "captcha_challenges_total",
      help: "Total CAPTCHA challenge outcomes (challenged, passed, failed).",
      labelNames: ["outcome"],
      registers: [registry],
    });
    this.quotaStateChanges = new Counter({
      name: "quota_state_changes_total",
      help: "Total quota state transitions, labelled by from/to state enums.",
      labelNames: ["from", "to"],
      registers: [registry],
    });
    this.decisionLatency = new Histogram({
      name: "enforcement_decision_latency_ms",
      help: "Latency of enforcement decisions in milliseconds.",
      labelNames: ["type"],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [registry],
    });
  }

  /**
   * No-throw wrapper: a metrics backend failure is logged (throttled to about once per minute) and
   * never propagates into the request path, so observability outages cannot cause product outages.
   */
  recordEnforcement(input: EnforcementMetricInput): void {
    try {
      this.triggers.inc({
        type: input.type,
        action: input.action,
        outcome: input.outcome,
      });

      if (input.type === EnforcementTypeValue.Captcha) {
        this.captchaChallenges.inc({ outcome: input.outcome });
      }

      if (input.type === EnforcementTypeValue.Quota && input.from && input.to) {
        this.quotaStateChanges.inc({ from: input.from, to: input.to });
      }

      if (input.durationMs !== undefined) {
        this.decisionLatency.observe({ type: input.type }, input.durationMs);
      }
    } catch (error) {
      this.logFailure(error);
    }
  }

  private logFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLogAt < 60_000) {
      return;
    }
    this.lastFailureLogAt = now;
    const message = "Failed to record enforcement metrics";
    if (this.logger) {
      this.logger.error({ err: summarizeError(error) }, message);
    } else {
      console.error(message, summarizeError(error));
    }
  }
}

export function createEnforcementMetrics(
  registry: Registry,
  logger?: Logger,
): EnforcementMetrics {
  return new PromEnforcementMetrics(registry, logger);
}
