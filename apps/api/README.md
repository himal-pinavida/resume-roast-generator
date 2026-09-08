# Resume Roast API

Standalone Express + TypeScript service for the roast-generation request path. This story implements
the Story 55/56 logging and error-envelope baseline plus PII-safe enforcement observability for Story
89.

## Run

```bash
cd apps/api
cp .env.example .env        # set PII_HASH_KEY for any non-development environment
npm install
npm start                   # tsx src/server.ts
```

- `npm run build` — `tsc --noEmit` typecheck
- `npm test` — Vitest unit + integration suites
- `GET /healthz` — `{ status, version }`
- `GET /readyz` — `{ status: "ok" }`
- `GET /metrics` — Prometheus text (default on; see below)

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `API_PORT` | no | HTTP port, default `4123` (this service uses `API_PORT`, not `PORT`) |
| `NODE_ENV` | no | `development` by default; non-development requires `PII_HASH_KEY` |
| `LOG_LEVEL` | no | Pino level, default `info` |
| `PII_HASH_KEY` | non-dev | HMAC key for hashing stable subjects such as client IPs |
| `METRICS_ENABLED` | no | `true`/`false`, default `true` |

Rotating `PII_HASH_KEY` invalidates historical subject hashes (`h_<hex>`), so old hashes cannot be
joined with new ones after rotation. Rotate deliberately and document the window.

## Enforcement events

Stable event names, exactly seven:

- `enforcement.rate_limit.triggered`
- `enforcement.quota.state_changed`
- `enforcement.captcha.challenged`
- `enforcement.captcha.passed`
- `enforcement.captcha.failed`
- `enforcement.temp_block.triggered`
- `enforcement.kill_switch.active`

Every event includes `eventName`, `correlationId`, `requestId`, `timestamp`, `level`, `actor:
"anonymous"`, `service`, `environment`, and `routeId`. The `requestId` mirrors `correlationId` for
this single-request scope. Identifiers are emitted only as stable HMAC hashes (`subjectHash`).

## Metrics and PII rules

- Counter labels are bounded enums only: `enforcement_triggers_total{type,action,outcome}`,
  `captcha_challenges_total{outcome}`, `quota_state_changes_total{from,to}`.
- Never label by IP, user agent, subject hash, résumé content, or route ID.
- `GET /metrics` has no application-level auth and must be exposed only through Render private
  networking or an IP allowlist.
