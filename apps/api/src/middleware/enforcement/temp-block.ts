import type { RequestHandler } from "express";
import { TempBlockedError } from "../../errors/domain-errors.js";
import {
  EnforcementAction,
  EnforcementEventNames,
  EnforcementOutcome,
  EnforcementType,
} from "../../observability/enforcement-events.js";
import type { EnforcementDeps } from "./deps.js";
import { emitEnforcementEvent, resolveClientIp } from "./deps.js";

/** Emits exactly one temp-block event and metrics record when a block is applied. */
export function tempBlockMiddleware(deps: EnforcementDeps): RequestHandler {
  return (req, _res, next) => {
    const subjectHash = deps.subjectHash(resolveClientIp(req));
    const block = deps.store.getTempBlock(subjectHash);

    if (!block) {
      next();
      return;
    }

    emitEnforcementEvent(deps, req, {
      type: EnforcementEventNames.TempBlockTriggered,
      enforcementType: EnforcementType.TempBlock,
      action: EnforcementAction.Triggered,
      outcome: EnforcementOutcome.Blocked,
      httpStatus: 429,
      blockTtlSeconds: block.blockTtlSeconds,
      blockReason: block.blockReason,
      subjectHash,
    });
    deps.metrics.recordEnforcement({
      type: EnforcementType.TempBlock,
      action: EnforcementAction.Triggered,
      outcome: EnforcementOutcome.Blocked,
    });

    const error = new TempBlockedError(
      undefined,
      block.blockReason,
      block.blockTtlSeconds,
    );
    error.retryAfter = block.blockTtlSeconds;
    throw error;
  };
}
