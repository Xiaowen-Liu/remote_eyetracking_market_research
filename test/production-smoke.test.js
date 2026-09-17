import assert from "node:assert/strict";
import test from "node:test";

import { runProductionSmoke } from "../scripts/production-smoke.mjs";

function response(body, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("validates the deployed web, API, contract, database, and CORS boundary", async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push({ url, method: options.method ?? "GET" });
    if (url === "https://web.example") return response("<title>WebGaze Research</title>");
    if (url.endsWith("/healthz")) return response({ status: "ok" });
    if (url.endsWith("/readyz")) return response({ status: "ready", database: "ok" });
    if (url.endsWith("/openapi.json")) {
      return response({
        paths: {
          "/api/v1/projects": {},
          "/api/v1/participate/{token}": {},
        },
      });
    }
    return response("", { "access-control-allow-origin": "https://web.example" });
  };

  const result = await runProductionSmoke({
    webUrl: "https://web.example/",
    apiUrl: "https://api.example/",
    fetcher,
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.checks.map((check) => check.name), [
    "web_app",
    "api_liveness",
    "api_readiness",
    "openapi_contract",
    "cors_preflight",
  ]);
  assert.equal(seen.at(-1).method, "OPTIONS");
});

test("fails when readiness cannot confirm the database", async () => {
  const fetcher = async (url) => {
    if (url === "https://web.example") return response("WebGaze");
    if (url.endsWith("/healthz")) return response({ status: "ok" });
    return response({ status: "not_ready", database: "unavailable" });
  };

  await assert.rejects(
    runProductionSmoke({
      webUrl: "https://web.example",
      apiUrl: "https://api.example",
      fetcher,
    }),
    /database connectivity/,
  );
});
