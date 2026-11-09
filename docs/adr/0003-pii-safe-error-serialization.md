# 0003 - PII-Safe Error Serialization

**Status:** Accepted

## Context

`body-parser` attaches the raw request body to the `SyntaxError` it throws for malformed JSON as an
enumerable `body` property. Pino's default `err` serializer copies enumerable own properties onto the
emitted record, so the unhandled-error path (`req.log.error({ err }, ...)`) could write résumé text,
phone numbers, CAPTCHA tokens, or other request PII directly into logs — violating the PII-safe
logging contract from ADR 0001 and Story 89.

## Decision

Introduce a strict Pino `err` serializer in `apps/api/src/logger/error-serializer.ts` that emits only
`type`, `message`, `stack`, and an optional `code`. Wire it into both `createLogger` and the
`pino-http` request logger, and have the unhandled-error middleware log a controlled summary via the
same helper.

## Consequences

- Enumerable non-standard error properties (notably `body`) can no longer reach structured logs.
- Error diagnostics remain available through type/message/stack without leaking request payloads.
- Any future error field that should be observable must be added to the allow-list deliberately.
- The console fallback path also emits only the controlled summary.
