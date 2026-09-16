# Production runbook

## Services

- Vercel hosts the React/Vite application.
- Railway hosts the FastAPI container and a private PostgreSQL service.

## Required configuration

Railway:

```text
WEBGAZE_ENVIRONMENT=production
WEBGAZE_DATABASE_URL=${{Postgres.DATABASE_URL}}
WEBGAZE_CORS_ORIGINS=["https://your-project.vercel.app"]
WEBGAZE_SQL_ECHO=false
WEBGAZE_RESEARCHER_AUTH_REQUIRED=true
WEBGAZE_RESEARCHER_SESSION_HOURS=12
WEBGAZE_RATE_LIMIT_ENABLED=true
WEBGAZE_LOGIN_RATE_LIMIT_PER_MINUTE=10
WEBGAZE_PARTICIPANT_RATE_LIMIT_PER_MINUTE=120
WEBGAZE_TRUST_PROXY_HEADERS=true
WEBGAZE_DEMO_RESEARCHER_EMAIL=your-researcher@example.com
WEBGAZE_DEMO_RESEARCHER_PASSWORD=<unique-secret-at-least-12-characters>
```

Vercel:

```text
VITE_API_URL=https://your-api.up.railway.app
```

## Release checklist

1. Run `npm test`, `npm run build:web`, `npm run generate:contract`, and Ruff.
2. Confirm migrations apply against PostgreSQL.
3. Deploy Railway first and verify `/healthz`, `/readyz`, and `/api/docs`.
4. Set the Vercel API origin, deploy the web app, then lock Railway CORS to the exact Vercel production origin.
5. Smoke-test project creation, publishing, participant-link resolution, synthetic flow, results, and export.
6. Confirm the UI labels synthetic data as synthetic.

## Enabling researcher sign-in

Enable authentication as a staged migration so the deployed workspace is never
locked before an account exists:

1. Deploy the API migration with `WEBGAZE_RESEARCHER_AUTH_REQUIRED=false`.
2. Set a unique researcher email and password in Railway's service variables.
3. Run `npm run db:seed` once against the Railway database. Re-running it rotates
   the seeded researcher's password to the currently configured secret.
4. Set `WEBGAZE_RESEARCHER_AUTH_REQUIRED=true` and redeploy the API.
5. Open the Vercel app in a private browser window, sign in, verify project and
   result access, then sign out and confirm the workspace is locked again.

After the project-membership migration, the seeded account is also backfilled as
Owner of the seeded project. Owners can invite Editor and Viewer email addresses
before those accounts exist; the invitation is claimed when the matching active
researcher signs in. This demo records pending invitation state but does not send
email. Ownership can be transferred to an existing collaborator after explicit
project-name confirmation; verify the target account before confirming.

Do not place the researcher password in Vercel variables or commit it to Git. The
web client sends it only to the API login endpoint and stores only the returned
opaque session token.

## Retention enforcement

Participant sessions receive an immutable `retention_expires_at` deadline from the
published study version. Preview eligible deletions with `npm run retention:preview`,
then execute them with `npm run retention:run`. The job is bounded to 100 sessions
per project per invocation by default and is safe to retry.

Schedule `npm run retention:run` as a daily Railway cron job. Each deletion removes
calibration records, task runs, session events, gaze batches and samples, analysis
jobs, and derived results in one database transaction. It retains only a tombstone
containing opaque resource IDs, the expiration/deletion timestamps, and per-table
row counts. The job and the Owner-only project endpoint both emit a project audit
event; neither tombstone nor audit metadata contains participant aliases or gaze
coordinates.

## Analysis worker

Run `npm run analysis:worker` in a separate Railway worker or scheduled service.
Each invocation processes at most 25 eligible jobs. PostgreSQL row locks prevent
two workers from claiming the same job; a two-minute lease permits recovery after
an interrupted worker. Failed jobs retry with exponential delay and move to a
dead-letter state after three attempts. Inspect `worker_attempts`, `error_code`,
`available_at`, `lease_expires_at`, and `dead_lettered_at` through the analysis-job
API before deciding whether to repair the underlying data or enqueue a new attempt.

## Health, logs, and abuse controls

`/healthz` is a process liveness probe and deliberately performs no database work.
`/readyz` executes a minimal database query and should be used when verifying a
release or diagnosing connectivity. Keep Railway's automatic restart check on
`/healthz` so a temporary database incident does not create a restart loop.

Every API response carries `X-Request-ID`. A valid caller-supplied ID is preserved;
unsafe or malformed values are replaced. The `webgaze.access` logger emits one JSON
record per request with method, path, status, latency, and request ID. Query strings,
authorization tokens, request bodies, participant codes, and coordinates are not
logged. Use request ID to correlate user-visible failures with Railway logs.

The API applies a per-process fixed-window limit to researcher login and participant
write routes. `WEBGAZE_TRUST_PROXY_HEADERS=true` is appropriate only behind Railway's
trusted proxy; leave it false when the API is directly reachable. A rejected request
returns `429`, `Retry-After`, and the normal structured error envelope. These limits
bound accidental and low-volume abuse but do not coordinate across replicas. Before
external recruitment, add a distributed edge/WAF limit without removing the
application guard.

Configure provider alerts for the following initial signals, then tune from observed
traffic:

- readiness failures for 5 consecutive minutes;
- 5xx responses above 2% for 5 minutes;
- p95 API latency above 1 second for 10 minutes;
- any analysis dead-letter event, or oldest queued job older than 10 minutes;
- sustained `429` responses, which may indicate abuse or a limit set too low.

## Non-goals for this public demo

Do not connect sensitive or consequential human-subject research data without
per-project authorization, rate limits, abuse controls, retention jobs, monitoring,
and an appropriate privacy/security review.
