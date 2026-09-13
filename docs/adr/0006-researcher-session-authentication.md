# ADR 0006: Researcher session authentication

## Status

Accepted

## Context

Researcher endpoints originally used one fixed demo owner and accepted an optional
`X-Demo-Owner-ID` header. That seam made local demos convenient, but it is not an
identity or authorization boundary and must not protect production study data.
Participant capability tokens have a different purpose and must never become
researcher credentials.

## Decision

- Researcher accounts use normalized email addresses and PBKDF2-SHA256 password
  hashes with unique salts. Raw passwords are never stored.
- Unknown-account logins still run password verification against a dummy hash so
  the failure path does not trivially reveal account existence through timing.
- A successful login issues a high-entropy opaque token. The database stores only
  its SHA-256 digest, expiry, revocation state, and researcher relationship.
- Owner-scoped API requests resolve their owner exclusively from a valid researcher
  bearer session when `WEBGAZE_RESEARCHER_AUTH_REQUIRED=true`.
- The fixed demo owner remains available only while authentication is explicitly
  optional. Production rejects caller-supplied demo-owner overrides.
- The browser stores the researcher token locally and attaches it only to researcher
  endpoints. Participant protocol and collection requests never receive it.
- Account creation is operator-controlled for this portfolio deployment; there is no
  public registration surface.

## Consequences

This creates a real authentication boundary without making an existing public demo
unavailable during migration. Deployment must seed an account before enabling
required authentication. Per-project roles and access auditing remain the next
authorization slice; an authenticated identity alone is not the final multi-user
authorization model.
