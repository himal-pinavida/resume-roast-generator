import type { RequestHandler } from "express";
import { CaptchaRequiredError } from "../../errors/domain-errors.js";
import {
  EnforcementAction,
  EnforcementEventNames,
  EnforcementOutcome,
  EnforcementType,
} from "../../observability/enforcement-events.js";
import type { EnforcementDeps } from "./deps.js";
import { emitEnforcementEvent, resolveClientIp } from "./deps.js";

/**
 * Single CAPTCHA decision point. A present token goes through verification (passed/failed); otherwise
 * an active challenge emits `challenged`. The token and any provider payload are never logged.
 */
export function captchaMiddleware(deps: EnforcementDeps): RequestHandler {
  return (req, _res, next) => {
    const subjectHash = deps.subjectHash(resolveClientIp(req));
    const token = readCaptchaToken(req);

    if (token !== undefined) {
      const decision = deps.store.verifyCaptcha(subjectHash, token);
      if (decision.outcome === "passed") {
        emitEnforcementEvent(deps, req, {
          type: EnforcementEventNames.CaptchaPassed,
          enforcementType: EnforcementType.Captcha,
          action: EnforcementAction.Passed,
          outcome: EnforcementOutcome.Passed,
          httpStatus: 200,
          subjectHash,
        });
        deps.metrics.recordEnforcement({
          type: EnforcementType.Captcha,
          action: EnforcementAction.Passed,
          outcome: EnforcementOutcome.Passed,
        });
        next();
        return;
      }

      emitEnforcementEvent(deps, req, {
        type: EnforcementEventNames.CaptchaFailed,
        enforcementType: EnforcementType.Captcha,
        action: EnforcementAction.Failed,
        outcome: EnforcementOutcome.Failed,
        httpStatus: 429,
        failureReason: decision.outcome,
        subjectHash,
      });
      deps.metrics.recordEnforcement({
        type: EnforcementType.Captcha,
        action: EnforcementAction.Failed,
        outcome: EnforcementOutcome.Failed,
      });
      throw new CaptchaRequiredError(undefined, decision.outcome);
    }

    if (deps.store.isCaptchaChallengeRequired(subjectHash)) {
      emitEnforcementEvent(deps, req, {
        type: EnforcementEventNames.CaptchaChallenged,
        enforcementType: EnforcementType.Captcha,
        action: EnforcementAction.Challenged,
        outcome: EnforcementOutcome.Challenged,
        httpStatus: 429,
        reason: "quotaTier",
        subjectHash,
      });
      deps.metrics.recordEnforcement({
        type: EnforcementType.Captcha,
        action: EnforcementAction.Challenged,
        outcome: EnforcementOutcome.Challenged,
      });
      throw new CaptchaRequiredError(undefined, "quotaTier");
    }

    next();
  };
}

function readCaptchaToken(req: Parameters<RequestHandler>[0]): string | undefined {
  const body = (req.body ?? {}) as { captchaToken?: unknown };
  return typeof body.captchaToken === "string" && body.captchaToken.length > 0
    ? body.captchaToken
    : undefined;
}
