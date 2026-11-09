/**
 * Captures structured log records so tests can assert typed enforcement events and PII negatives
 * without touching stdout.
 */
export interface RecordedLog {
  level: string;
  eventName?: string;
  payload: Record<string, unknown>;
}

export class RecordingLogger {
  readonly records: RecordedLog[] = [];
  level = "info";

  info(obj: unknown, ..._args: unknown[]): void {
    this.record("info", obj);
  }

  warn(obj: unknown, ..._args: unknown[]): void {
    this.record("warn", obj);
  }

  error(obj: unknown, ..._args: unknown[]): void {
    this.record("error", obj);
  }

  debug(obj: unknown, ..._args: unknown[]): void {
    this.record("debug", obj);
  }

  trace(obj: unknown, ..._args: unknown[]): void {
    this.record("trace", obj);
  }

  fatal(obj: unknown, ..._args: unknown[]): void {
    this.record("fatal", obj);
  }

  child(): RecordingLogger {
    return this;
  }

  isLevelEnabled(): boolean {
    return true;
  }

  private record(level: string, obj: unknown): void {
    if (typeof obj === "string") {
      this.records.push({ level, payload: { message: obj } });
      return;
    }
    if (obj !== null && typeof obj === "object") {
      const payload = obj as Record<string, unknown>;
      this.records.push({
        level,
        eventName: typeof payload.eventName === "string" ? payload.eventName : undefined,
        payload,
      });
      return;
    }
    this.records.push({ level, payload: {} });
  }
}

import { Writable } from "node:stream";
import pino, { type Logger } from "pino";

export interface CapturedLog {
  level: string | number;
  eventName?: string;
  payload: Record<string, unknown>;
}

export interface CapturingPinoLogger {
  logger: Logger;
  records: CapturedLog[];
}

/**
 * A real Pino logger that writes JSON lines to an in-memory stream. Useful for integration tests
 * where `pino-http` requires a full Pino logger (its internal proxy reads Pino symbols).
 */
export function createCapturingPinoLogger(): CapturingPinoLogger {
  const records: CapturedLog[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const line = chunk.toString().trim();
      if (line) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          records.push({
            level: (parsed.level as string | number) ?? "unknown",
            eventName: typeof parsed.eventName === "string" ? parsed.eventName : undefined,
            payload: parsed,
          });
        } catch {
          // Ignore non-JSON lines; Pino's destination only emits JSON here.
        }
      }
      callback();
    },
  });
  const logger = pino({ level: "info", base: {} }, stream) as Logger;
  return { logger, records };
}
