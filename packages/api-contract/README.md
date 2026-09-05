# API contract

`openapi.json` is generated from the FastAPI application. `src/schema.d.ts` is
then generated from that document for browser clients. Do not edit either file
by hand.

From the repository root:

```bash
npm run generate:contract
```

CI checks that regeneration produces no Git diff, preventing the API and
TypeScript clients from drifting apart.
