import type { BlockReason, CaptchaFailureReason } from "../observability/enforcement-events.js";

/**
 * Typed/domain errors for the enforcement layer. Only these classes (and future {@link DomainError}
 * subclasses) are mapped to HTTP responses; the error middleware never exposes unexpected internals.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  retryAfter?: number;
  details?: Record<string, unknown>;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 429 — the request exceeded the roast rate-limit policy. */
export class RateLimitedError extends DomainError {
  readonly status = 429;
  readonly code = "enforcement:rate_limited";

  constructor(
    message = "The roast rate limit has been exceeded. Please try again later.",
    policyId?: string,
  ) {
    super(message);
    if (policyId !== undefined) {
      this.details = { policyId };
    }
  }
}

/** 429 — CAPTCHA escalation is required before the roast can be generated. */
export class CaptchaRequiredError extends DomainError {
  readonly status = 429;
  readonly code = "enforcement:captcha_required";

  constructor(
    message = "CAPTCHA verification is required before a roast can be generated.",
    reason?: "quotaTier" | CaptchaFailureReason,
  ) {
    super(message);
    if (reason !== undefined) {
      this.details = { reason };
    }
  }
}

/** 429 — the client has been temporarily blocked after repeated abuse signals. */
export class TempBlockedError extends DomainError {
  readonly status = 429;
  readonly code = "enforcement:temp_blocked";

  constructor(
    message = "Temporarily blocked due to repeated abuse signals.",
    blockReason?: BlockReason,
    blockTtlSeconds?: number,
  ) {
    super(message);
    if (blockReason !== undefined || blockTtlSeconds !== undefined) {
      this.details = {
        ...(blockReason === undefined ? {} : { blockReason }),
        ...(blockTtlSeconds === undefined ? {} : { blockTtlSeconds }),
      };
    }
  }
}

/** 503 — the admin kill switch has disabled roast generation. */
export class KillSwitchActiveError extends DomainError {
  readonly status = 503;
  readonly code = "enforcement:kill_switch_active";

  constructor(message = "Roast generation is temporarily disabled.") {
    super(message);
  }
}
