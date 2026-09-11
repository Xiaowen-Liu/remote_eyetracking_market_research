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

## Non-goals for this public demo

Do not connect real participant, camera, or sensitive study data without implementing researcher authentication, rate limits, abuse controls, retention jobs, monitoring, and an appropriate privacy/security review.
