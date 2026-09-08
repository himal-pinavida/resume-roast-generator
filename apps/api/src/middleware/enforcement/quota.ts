import type { RequestHandler } from "express";
import {
  EnforcementAction,
  EnforcementEventNames,
  EnforcementOutcome,
  EnforcementType,
} from "../../observability/enforcement-events.js";
import type { EnforcementDeps } from "./deps.js";
import { emitEnforcementEvent, resolveClientIp } from "./deps.js";

/**
 * Logs quota transitions only when the state actually changes. Quota itself does not reject the
 * request here — the downstream CAPTCHA/temp-block decision points enforce any escalated state.
 */
export function quotaMiddleware(deps: EnforcementDeps): RequestHandler {
  return (req, _res, next) => {
    const subjectHash = deps.subjectHash(resolveClientIp(req));
    const transition = deps.store.getQuotaTransition(subjectHash);

    if (!transition || transition.from === transition.to) {
      next();
      return;
    }

    emitEnforcementEvent(deps, req, {
      type: EnforcementEventNames.QuotaStateChanged,
      enforcementType: EnforcementType.Quota,
      action: EnforcementAction.StateChanged,
      outcome: EnforcementOutcome.StateChanged,
      httpStatus: 200,
      policyId: "roast.quota.v1",
      fromState: transition.from,
      toState: transition.to,
      subjectHash,
    });
    deps.metrics.recordEnforcement({
      type: EnforcementType.Quota,
      action: EnforcementAction.StateChanged,
      outcome: EnforcementOutcome.StateChanged,
      from: transition.from,
      to: transition.to,
    });

    next();
  };
}
