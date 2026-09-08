/**
 * Strict Pino `err` serializer and error-summary helper. Pino's default serializer copies every
 * enumerable own property onto the emitted record, which means body-parser's `SyntaxError.body` (the
 * raw malformed request) would otherwise be written to logs. These helpers emit only the controlled
 * `type`/`message`/`stack`/`code` fields, so request bodies and other non-standard error properties
 * can never leak into structured logs.
 */
export interface SafeError {
  type: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export function safeErrorSerializer(value: unknown): SafeError {
  if (value instanceof Error) {
    return toSafeError(
      value.name || "Error",
      value.message,
      value.stack,
      (value as Error & { code?: unknown }).code,
    );
  }

  // pino-http wraps custom serializers with pino-std-serializers' default serializer, so a serializer
  // can also receive its already-reduced plain object. Read the same safe fields and discard `body`,
  // `raw`, and any other non-standard props.
  if (value !== null && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    return toSafeError(
      typeof candidate.type === "string" ? candidate.type : "Error",
      typeof candidate.message === "string" ? candidate.message : String(value),
      typeof candidate.stack === "string" ? candidate.stack : undefined,
      candidate.code,
    );
  }

  return toSafeError("Error", String(value), undefined, undefined);
}

/** Alias for callers that want an explicit controlled summary before logging. */
export function summarizeError(value: unknown): SafeError {
  return safeErrorSerializer(value);
}

function toSafeError(
  type: string,
  message: string,
  stack: string | undefined,
  code: unknown,
): SafeError {
  const summary: SafeError = { type, message };
  if (stack !== undefined) {
    summary.stack = stack;
  }
  if (typeof code === "string" || typeof code === "number") {
    summary.code = code;
  }
  return summary;
}
