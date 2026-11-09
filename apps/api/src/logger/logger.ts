import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import pino, { type Logger } from "pino";
import { pinoHttp } from "pino-http";
import { safeErrorSerializer } from "./error-serializer.js";

/**
 * Structured logging baseline. Pino emits JSON with a stable `service`/`environment` base and a
 * small allow-list request serializer so the HTTP logger can never leak bodies, headers, query
 * strings, or the remote address into logs (Story 55/89 PII contract).
 */
export interface LoggerOptions {
  level?: string;
  environment?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino({
    level: options.level ?? "info",
    base: {
      service: "resume-roast-api",
      environment: options.environment ?? "development",
    },
    redact: {
      paths: [
        "resumeText",
        "token",
        "apiKey",
        "authorization",
        "cookie",
        "secret",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      err: safeErrorSerializer,
    },
  });
}

/**
 * The only request fields pino-http is allowed to serialise. `url` is stripped to its pathname so a
 * query string cannot smuggle PII into logs; `remoteAddress`, `remotePort`, headers, body, and params
 * are intentionally absent.
 */
function minimalRequestSerializer(req: IncomingMessage): Record<string, unknown> {
  const request = req as IncomingMessage & { method?: string; url?: string };
  const url = request.url?.split("?")[0];
  return {
    id: request.id,
    method: request.method,
    url,
  };
}

export function createRequestLoggerMiddleware(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req) => {
      const existing = (req as IncomingMessage & { id?: unknown }).id;
      if (typeof existing === "string" && existing.startsWith("req_")) {
        return existing;
      }
      return `req_${randomUUID()}`;
    },
    serializers: {
      req: minimalRequestSerializer,
      err: safeErrorSerializer,
    },
    customProps: (req) => {
      const id = (req as IncomingMessage & { id?: unknown }).id;
      return {
        correlationId: id,
        requestId: id,
      };
    },
  });
}
