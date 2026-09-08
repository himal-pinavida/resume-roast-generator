import type {
  BlockReason,
  CaptchaFailureReason,
  KillSwitchState,
  QuotaState,
} from "../observability/enforcement-events.js";

export interface RateLimitDecision {
  limited: boolean;
  retryAfterSeconds?: number;
  policyId: string;
}

export interface QuotaTransition {
  from: QuotaState;
  to: QuotaState;
}

export type CaptchaVerificationOutcome = "passed" | CaptchaFailureReason;

export interface CaptchaVerificationDecision {
  outcome: CaptchaVerificationOutcome;
}

export interface TempBlockDecision {
  blockTtlSeconds: number;
  blockReason: BlockReason;
}

/**
 * The seam between the request path and real enforcement state (a Redis-backed implementation is
 * intentionally out of scope for Story 89). Methods receive an already-hashed subject so raw
 * identifiers never cross this boundary.
 */
export interface EnforcementStore {
  isKillSwitchActive(): boolean;
  getRateLimitDecision(subjectHash: string): RateLimitDecision;
  getQuotaTransition(subjectHash: string): QuotaTransition | null;
  isCaptchaChallengeRequired(subjectHash: string): boolean;
  verifyCaptcha(subjectHash: string, token: string): CaptchaVerificationDecision;
  getTempBlock(subjectHash: string): TempBlockDecision | null;
}

/** Deterministic in-memory implementation for tests and local development. */
export class InMemoryEnforcementStore implements EnforcementStore {
  killSwitchState: KillSwitchState = "INACTIVE";
  rateLimitDecision: RateLimitDecision = {
    limited: false,
    policyId: "roast.rate_limit.v1",
  };
  quotaTransition: QuotaTransition | null = null;
  captchaChallengeRequired = false;
  captchaDecision: CaptchaVerificationDecision = { outcome: "passed" };
  tempBlock: TempBlockDecision | null = null;

  isKillSwitchActive(): boolean {
    return this.killSwitchState === "ACTIVE";
  }

  getRateLimitDecision(_subjectHash: string): RateLimitDecision {
    return this.rateLimitDecision;
  }

  getQuotaTransition(_subjectHash: string): QuotaTransition | null {
    return this.quotaTransition;
  }

  isCaptchaChallengeRequired(_subjectHash: string): boolean {
    return this.captchaChallengeRequired;
  }

  verifyCaptcha(_subjectHash: string, _token: string): CaptchaVerificationDecision {
    return this.captchaDecision;
  }

  getTempBlock(_subjectHash: string): TempBlockDecision | null {
    return this.tempBlock;
  }
}
