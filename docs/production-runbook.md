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
3. Deploy Railway first and verify `/healthz` and `/api/docs`.
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

## Non-goals for this public demo

Do not connect sensitive or consequential human-subject research data without
per-project authorization, rate limits, abuse controls, retention jobs, monitoring,
and an appropriate privacy/security review.
