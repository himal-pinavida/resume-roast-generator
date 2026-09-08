import type { NextFunction, Request, Response } from "express";
import { DomainError } from "../errors/domain-errors.js";

/**
 * The ONE place typed domain errors map to HTTP responses. The Story 56 envelope is
 * `{ error: { code, message, correlationId, details? } }`, and any `retryAfter` attached to a domain
 * error becomes a `Retry-After` response header. Unexpected faults are logged once and returned as an
 * opaque 500 — internals are never leaked.
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const correlationId = correlationIdFrom(req) ?? null;

  if (err instanceof DomainError) {
    const errorBody: Record<string, unknown> = {
      code: err.code,
      message: err.message,
      correlationId,
    };
    if (err.details !== undefined) {
      errorBody.details = err.details;
    }
    if (err.retryAfter !== undefined) {
      res.setHeader("Retry-After", String(err.retryAfter));
    }
    res.status(err.status).json({ error: errorBody });
    return;
  }

  if (req.log) {
    req.log.error({ err }, `Unhandled error for ${req.method} ${req.path}`);
  } else {
    console.error(`Unhandled error for ${req.method} ${req.path}:`, err);
  }

  res.status(500).json({
    error: {
      code: "internal:server_error",
      message: "An unexpected error occurred.",
      correlationId,
    },
  });
}

function correlationIdFrom(req: Request): string | undefined {
  if (typeof req.id === "string" && req.id.length > 0) {
    return req.id;
  }
  const header = req.header("x-request-id");
  return header ?? undefined;
}
