# 0002 - Prometheus Metrics Exposure

**Status:** Accepted

## Context

Admins need low-cardinality counters to detect false positives and tune enforcement thresholds, with
a `captcha_passed / captcha_challenged` ratio proxy. Metrics must never contain PII and must not be
able to take down the request path if the metrics backend fails.

## Decision

Use `prom-client` with a dedicated `Registry` injected through `buildApp`, exposing
`enforcement_triggers_total`, `captcha_challenges_total`, and `quota_state_changes_total` (plus an
optional `enforcement_decision_latency_ms` histogram). `recordEnforcement` is a no-throw wrapper with
throttled failure logging. `GET /metrics` returns Prometheus text and is gated by `METRICS_ENABLED`
(default true), mounted before JSON body parsing.

## Consequences

- Tests get deterministic isolation by constructing a fresh `Registry` per app.
- Label values are bounded enums only; no IP, user agent, subject hash, résumé content, or route ID
  is a label.
- `/metrics` has no application-level auth; it must be exposed only via Render private networking or
  an IP allowlist.
- A throwing counter/backend is swallowed and never changes enforcement responses.
