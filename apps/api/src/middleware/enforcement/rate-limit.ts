import type { RequestHandler } from "express";
import { RateLimitedError } from "../../errors/domain-errors.js";
import {
  EnforcementAction,
  EnforcementEventNames,
  EnforcementOutcome,
  EnforcementType,
} from "../../observability/enforcement-events.js";
import type { EnforcementDeps } from "./deps.js";
import { emitEnforcementEvent, resolveClientIp } from "./deps.js";

/** Emits exactly one rate-limit event and one metrics record at the decision point. */
export function rateLimitMiddleware(deps: EnforcementDeps): RequestHandler {
  return (req, _res, next) => {
    const subjectHash = deps.subjectHash(resolveClientIp(req));
    const decision = deps.store.getRateLimitDecision(subjectHash);

    if (!decision.limited) {
      next();
      return;
    }

    emitEnforcementEvent(deps, req, {
      type: EnforcementEventNames.RateLimitTriggered,
      enforcementType: EnforcementType.RateLimit,
      action: EnforcementAction.Triggered,
      outcome: EnforcementOutcome.Blocked,
      httpStatus: 429,
      policyId: decision.policyId,
      subjectHash,
    });
    deps.metrics.recordEnforcement({
      type: EnforcementType.RateLimit,
      action: EnforcementAction.Triggered,
      outcome: EnforcementOutcome.Blocked,
    });

    const error = new RateLimitedError(undefined, decision.policyId);
    if (decision.retryAfterSeconds !== undefined) {
      error.retryAfter = decision.retryAfterSeconds;
    }
    throw error;
  };
}
