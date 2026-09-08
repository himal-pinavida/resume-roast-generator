import type { Logger } from "pino";

/**
 * PII-safe enforcement observability contract (ADR 0001). Event names are stable constants — never
 * inline strings at call sites — and every payload is a discriminated union of bounded enums so
 * free-form/untrusted text cannot enter the log object.
 */
export const EnforcementEventNames = {
  RateLimitTriggered: "enforcement.rate_limit.triggered",
  QuotaStateChanged: "enforcement.quota.state_changed",
  CaptchaChallenged: "enforcement.captcha.challenged",
  CaptchaPassed: "enforcement.captcha.passed",
  CaptchaFailed: "enforcement.captcha.failed",
  TempBlockTriggered: "enforcement.temp_block.triggered",
  KillSwitchActive: "enforcement.kill_switch.active",
} as const;

export type EnforcementEventName =
  (typeof EnforcementEventNames)[keyof typeof EnforcementEventNames];

export const EnforcementType = {
  RateLimit: "rate_limit",
  Quota: "quota",
  Captcha: "captcha",
  TempBlock: "temp_block",
  KillSwitch: "kill_switch",
} as const;

export type EnforcementType = (typeof EnforcementType)[keyof typeof EnforcementType];

export const EnforcementAction = {
  Triggered: "triggered",
  StateChanged: "state_changed",
  Challenged: "challenged",
  Passed: "passed",
  Failed: "failed",
  Active: "active",
} as const;

export type EnforcementAction = (typeof EnforcementAction)[keyof typeof EnforcementAction];

export const EnforcementOutcome = {
  Blocked: "blocked",
  StateChanged: "state_changed",
  Challenged: "challenged",
  Passed: "passed",
  Failed: "failed",
  Active: "active",
} as const;

export type EnforcementOutcome =
  (typeof EnforcementOutcome)[keyof typeof EnforcementOutcome];

export const CaptchaFailureReason = {
  Invalid: "invalid",
  Timeout: "timeout",
  ProviderError: "provider_error",
} as const;

export type CaptchaFailureReason =
  (typeof CaptchaFailureReason)[keyof typeof CaptchaFailureReason];

export const QuotaState = {
  Ok: "ok",
  Warn: "warn",
  Delay: "delay",
  CaptchaRequired: "captcha_required",
  TempBlocked: "temp_blocked",
} as const;

export type QuotaState = (typeof QuotaState)[keyof typeof QuotaState];

export const BlockReason = {
  QuotaThreshold: "quota_threshold",
  RepeatedAbuseSignals: "repeated_abuse_signals",
} as const;

export type BlockReason = (typeof BlockReason)[keyof typeof BlockReason];

export const KillSwitchState = {
  Active: "ACTIVE",
  Inactive: "INACTIVE",
} as const;

export type KillSwitchState = (typeof KillSwitchState)[keyof typeof KillSwitchState];

export interface EnforcementLogContext {
  correlationId: string;
  service: string;
  environment: string;
  routeId: string;
}

/**
 * One payload per stable event. The `type` discriminant also becomes `eventName` in the emitted log,
 * so a caller can never provide an eventName that differs from its payload shape.
 */
export type EnforcementEvent =
  | {
      type: typeof EnforcementEventNames.RateLimitTriggered;
      enforcementType: typeof EnforcementType.RateLimit;
      action: typeof EnforcementAction.Triggered;
      outcome: typeof EnforcementOutcome.Blocked;
      httpStatus: 429;
      policyId: string;
      subjectHash: string;
    }
  | {
      type: typeof EnforcementEventNames.QuotaStateChanged;
      enforcementType: typeof EnforcementType.Quota;
      action: typeof EnforcementAction.StateChanged;
      outcome: typeof EnforcementOutcome.StateChanged;
      httpStatus: 200;
      policyId: string;
      fromState: QuotaState;
      toState: QuotaState;
      subjectHash: string;
    }
  | {
      type: typeof EnforcementEventNames.CaptchaChallenged;
      enforcementType: typeof EnforcementType.Captcha;
      action: typeof EnforcementAction.Challenged;
      outcome: typeof EnforcementOutcome.Challenged;
      httpStatus: 429;
      reason: "quotaTier";
      subjectHash: string;
    }
  | {
      type: typeof EnforcementEventNames.CaptchaPassed;
      enforcementType: typeof EnforcementType.Captcha;
      action: typeof EnforcementAction.Passed;
      outcome: typeof EnforcementOutcome.Passed;
      httpStatus: 200;
      subjectHash: string;
    }
  | {
      type: typeof EnforcementEventNames.CaptchaFailed;
      enforcementType: typeof EnforcementType.Captcha;
      action: typeof EnforcementAction.Failed;
      outcome: typeof EnforcementOutcome.Failed;
      httpStatus: 429;
      failureReason: CaptchaFailureReason;
      subjectHash: string;
    }
  | {
      type: typeof EnforcementEventNames.TempBlockTriggered;
      enforcementType: typeof EnforcementType.TempBlock;
      action: typeof EnforcementAction.Triggered;
      outcome: typeof EnforcementOutcome.Blocked;
      httpStatus: 429;
      blockTtlSeconds: number;
      blockReason: BlockReason;
      subjectHash: string;
    }
  | {
      type: typeof EnforcementEventNames.KillSwitchActive;
      enforcementType: typeof EnforcementType.KillSwitch;
      action: typeof EnforcementAction.Active;
      outcome: typeof EnforcementOutcome.Active;
      httpStatus: 503;
      killSwitchState: typeof KillSwitchState.Active;
    };

/**
 * Emit one structured enforcement event. The helper always stamps the common fields and accepts only
 * the typed {@link EnforcementEvent} union above. `requestId` deliberately mirrors `correlationId`
 * because this service has a single request-scoped correlation identifier (Story 89).
 */
export function logEnforcementEvent(
  logger: Logger,
  context: EnforcementLogContext,
  event: EnforcementEvent,
): void {
  const { type: eventName, ...payload } = event;
  logger.info({
    eventName,
    correlationId: context.correlationId,
    requestId: context.correlationId,
    timestamp: new Date().toISOString(),
    level: "info",
    actor: "anonymous",
    service: context.service,
    environment: context.environment,
    routeId: context.routeId,
    ...payload,
  });
}
