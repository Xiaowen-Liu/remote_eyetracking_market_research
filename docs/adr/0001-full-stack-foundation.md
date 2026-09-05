# ADR 0001: Full-stack foundation and contract ownership

- Status: accepted
- Date: 2026-09-04

## Context

The original public prototype is a local-only Chrome extension. The portfolio
goal requires evidence of REST API design, relational modeling, schema
migrations, failure handling, automated testing, and frontend/backend contract
management while preserving a useful offline collection path.

## Decision

- Use FastAPI and Pydantic for the versioned REST API and OpenAPI source of truth.
- Use SQLAlchemy 2 with PostgreSQL in development and production.
- Use Alembic for reviewed, reversible database migrations.
- Use SQLite only as an isolated API-test adapter, not as the production design.
- Generate TypeScript definitions from committed OpenAPI rather than maintaining
  duplicate handwritten frontend interfaces.
- Keep eye-tracking acquisition in the Chrome extension and move durable project,
  protocol, ingestion, and analysis resources behind the API over later milestones.
- Expose a temporary demo-owner header in M1 as an explicit authentication seam.
  It is not production authentication and will be replaced before deployment.

## Consequences

The domain model and API evolve together, contract drift is detectable in CI,
and frontend code receives typed operations. The project accepts the overhead of
Python and TypeScript toolchains because the boundary itself is a key engineering
signal. PostgreSQL-specific behavior must be covered by migration CI, while fast
request tests remain database-isolated.
