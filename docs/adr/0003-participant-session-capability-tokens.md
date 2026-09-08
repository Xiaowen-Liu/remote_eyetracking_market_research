# ADR 0003: Participant sessions use capability tokens

Status: accepted

## Context

Participant endpoints cannot use the temporary researcher identity seam, and a
session UUID alone is not an authorization credential. The browser needs a
short-lived, anonymous way to continue the session it created without collecting
participant accounts or identifying information.

## Decision

Creating a session through an active participant link returns a high-entropy
bearer token once. Only its SHA-256 digest is stored. Subsequent participant
mutations require both the session ID and bearer token, and token comparison is
constant-time. Sessions remain bound to the immutable study version resolved at
creation.

Consent is an explicit server-side transition from `created` to `consented`.
The submitted consent version must match the version in the frozen protocol, so
a stale client cannot silently accept different language.

## Consequences

- Participant flows need no account or personally identifying data.
- A leaked database does not expose usable raw session tokens.
- The client must keep the token in memory or session-scoped storage and must
  never place it in a URL, analytics event, or log.
- Revocation, expiry, rate limiting, and token rotation remain explicit future
  controls rather than being conflated with UUID secrecy.
