import type { Request } from "express";
import type { Logger } from "pino";
import type { EnforcementMetrics } from "../../observability/enforcement-metrics.js";
import type {
  EnforcementEvent,
  EnforcementLogContext,
} from "../../observability/enforcement-events.js";
import { logEnforcementEvent } from "../../observability/enforcement-events.js";
import type { SubjectHasher } from "../../observability/pii.js";
import type { EnforcementStore } from "../../store/enforcement-store.js";

export interface EnforcementDeps {
  logger: Logger;
  metrics: EnforcementMetrics;
  store: EnforcementStore;
  subjectHash: SubjectHasher;
  service: string;
  environment: string;
  routeId: string;
}

/** Resolve the stable client IP for hashing. It is never logged in raw form. */
export function resolveClientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

export function enforcementContext(deps: EnforcementDeps, req: Request): EnforcementLogContext {
  return {
    correlationId: correlationIdFrom(req),
    service: deps.service,
    environment: deps.environment,
    routeId: deps.routeId,
  };
}

export function emitEnforcementEvent(
  deps: EnforcementDeps,
  req: Request,
  event: EnforcementEvent,
): void {
  logEnforcementEvent(deps.logger, enforcementContext(deps, req), event);
}

function correlationIdFrom(req: Request): string {
  if (typeof req.id === "string" && req.id.length > 0) {
    return req.id;
  }
  return req.header("x-request-id") ?? "unknown";
}
