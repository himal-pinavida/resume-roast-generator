import type { RequestHandler } from "express";
import { KillSwitchActiveError } from "../../errors/domain-errors.js";
import {
  EnforcementAction,
  EnforcementEventNames,
  EnforcementOutcome,
  EnforcementType,
  KillSwitchState,
} from "../../observability/enforcement-events.js";
import type { EnforcementDeps } from "./deps.js";
import { emitEnforcementEvent } from "./deps.js";

/** Emits exactly one kill-switch event and metrics record when the admin kill switch is active. */
export function killSwitchMiddleware(deps: EnforcementDeps): RequestHandler {
  return (req, _res, next) => {
    if (!deps.store.isKillSwitchActive()) {
      next();
      return;
    }

    emitEnforcementEvent(deps, req, {
      type: EnforcementEventNames.KillSwitchActive,
      enforcementType: EnforcementType.KillSwitch,
      action: EnforcementAction.Active,
      outcome: EnforcementOutcome.Active,
      httpStatus: 503,
      killSwitchState: KillSwitchState.Active,
    });
    deps.metrics.recordEnforcement({
      type: EnforcementType.KillSwitch,
      action: EnforcementAction.Active,
      outcome: EnforcementOutcome.Active,
    });

    const error = new KillSwitchActiveError();
    error.retryAfter = 300;
    throw error;
  };
}
