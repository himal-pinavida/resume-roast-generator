# 0001 - Enforcement Observability Contract

**Status:** Accepted

## Context

Abuse and cost enforcement (rate limits, quotas, CAPTCHA, temporary blocks, and the admin kill
switch) needs machine-parseable logs and counters for investigation and tuning. Those logs must be
PII-safe: no résumé content, raw IPs, CAPTCHA tokens, or provider payloads may be emitted. Story 89
fixes seven stable event names, and tests must be able to prove that free-form text cannot enter the
log object.

## Decision

Use a typed, discriminated-union schema in `apps/api/src/observability/enforcement-events.ts` with
the seven stable event names as `as const` constants, bounded literal enums for every reason/state
field, and a `logEnforcementEvent(logger, context, event)` helper that always stamps `eventName`,
`correlationId`, `requestId` (mirroring `correlationId`), `timestamp`, `level`, and `actor:
"anonymous"`. Identifiers such as client IPs are hashed with an HMAC-SHA256 key from `PII_HASH_KEY`
and emitted only as `h_<hex>` via `apps/api/src/observability/pii.ts`.

## Consequences

- Free-form or untrusted strings cannot enter enforcement log events at compile time.
- Every enforcement event carries a request-scoped correlation ID shared with the Story 56 error
  envelope and `x-request-id`.
- Raw subject identifiers remain unavailable for direct joins; rotating `PII_HASH_KEY` invalidates
  historical subject hashes and must be treated as an operational event.
- Résumé content is never hashed or logged; only stable identifiers use `hashSubject`.
