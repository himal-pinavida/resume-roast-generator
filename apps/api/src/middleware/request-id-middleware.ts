import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

/**
 * Source of truth for the request correlation ID. The value is generated server-side (client input
 * is never trusted), set on both `req.id` and the `x-request-id` response header, and carried on the
 * request child logger as both `correlationId` and `requestId` to satisfy Story 55 and Story 89.
 */
export function requestIdMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = `req_${randomUUID()}`;
    req.id = id;
    req.log = logger.child({ correlationId: id, requestId: id });
    res.setHeader("x-request-id", id);
    next();
  };
}
