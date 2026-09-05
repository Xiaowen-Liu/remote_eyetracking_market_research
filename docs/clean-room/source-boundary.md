# Source boundary and implementation protocol

Date established: 2026-09-04

## Allowed implementation sources

- The public history of this repository.
- Publicly licensed dependencies with preserved notices.
- Public browser, web-platform, FastAPI, PostgreSQL, and algorithm literature.
- New code, tests, synthetic fixtures, and designs created specifically for
  this repository.

## Restricted reference material

A separate, non-public prototype was reviewed once to identify high-level user
needs, product boundaries, data categories, and real-world failure conditions.
It must not be copied into this repository. Its source code, storage layout,
styles, assets, recordings, database, deployment configuration, literal text,
and test data are excluded implementation sources.

After the functional specification, data dictionary, and failure-mode checklist
were recorded, the restricted prototype ceased to be an implementation
reference. Future work should be derived from the documents in this directory,
the public repository baseline, and public technical sources.

## Clean-room rules

1. Implement behavior from the public specifications, not by translating or
   mechanically rewriting restricted code.
2. Do not compare new functions line-by-line against the restricted prototype.
3. Create independent module boundaries, API contracts, database tables, UI,
   copy, fixtures, and tests.
4. Use synthetic participants, URLs, sessions, screenshots, and gaze samples.
5. Record external algorithm sources, dependency versions, and licenses.
6. Keep the repository and its Git history free of employer names, assets,
   internal URLs, credentials, recordings, databases, and participant data.
7. Treat uncertainty about ownership or policy as a reason to seek written
   guidance before publication.

## Product ownership statement

The intended public artifact is an independent eye-tracking research platform
centered on calibration, gaze collection, data quality, task-level analysis,
and explainable research outputs. It does not reproduce a general-purpose
unmoderated research product.
