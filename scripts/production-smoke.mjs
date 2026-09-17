import { pathToFileURL } from "node:url";

export const DEFAULT_WEB_URL = "https://webgaze-research.vercel.app";
export const DEFAULT_API_URL = "https://remoteeyetrackingmarketresearch-production.up.railway.app";

function normalizedUrl(value) {
  return value.replace(/\/$/, "");
}

async function checkedFetch(fetcher, name, url, options = {}) {
  const startedAt = performance.now();
  const response = await fetcher(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
    ...options,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  return { response, durationMs };
}

export async function runProductionSmoke({
  webUrl = DEFAULT_WEB_URL,
  apiUrl = DEFAULT_API_URL,
  fetcher = fetch,
} = {}) {
  const web = normalizedUrl(webUrl);
  const api = normalizedUrl(apiUrl);
  const checks = [];

  const home = await checkedFetch(fetcher, "web app", web);
  const homeBody = await home.response.text();
  if (!homeBody.toLowerCase().includes("webgaze")) {
    throw new Error("web app response did not contain the WebGaze application shell");
  }
  checks.push({ name: "web_app", status: "pass", duration_ms: home.durationMs });

  const health = await checkedFetch(fetcher, "API liveness", `${api}/healthz`);
  const healthBody = await health.response.json();
  if (healthBody.status !== "ok") throw new Error("API liveness payload was not ok");
  checks.push({ name: "api_liveness", status: "pass", duration_ms: health.durationMs });

  const readiness = await checkedFetch(fetcher, "API readiness", `${api}/readyz`);
  const readinessBody = await readiness.response.json();
  if (readinessBody.status !== "ready" || readinessBody.database !== "ok") {
    throw new Error("API readiness did not confirm database connectivity");
  }
  checks.push({ name: "api_readiness", status: "pass", duration_ms: readiness.durationMs });

  const contract = await checkedFetch(fetcher, "OpenAPI contract", `${api}/api/v1/openapi.json`);
  const contractBody = await contract.response.json();
  const requiredPaths = ["/api/v1/projects", "/api/v1/participate/{token}"];
  for (const path of requiredPaths) {
    if (!contractBody.paths?.[path]) throw new Error(`OpenAPI contract is missing ${path}`);
  }
  checks.push({ name: "openapi_contract", status: "pass", duration_ms: contract.durationMs });

  const cors = await checkedFetch(fetcher, "CORS preflight", `${api}/api/v1/projects`, {
    method: "OPTIONS",
    headers: {
      Origin: web,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,x-request-id",
    },
  });
  if (cors.response.headers.get("access-control-allow-origin") !== web) {
    throw new Error("CORS preflight did not allow the production web origin");
  }
  checks.push({ name: "cors_preflight", status: "pass", duration_ms: cors.durationMs });

  return {
    status: "pass",
    checked_at: new Date().toISOString(),
    web_url: web,
    api_url: api,
    checks,
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const result = await runProductionSmoke({
    webUrl: option("--web-url") ?? process.env.WEBGAZE_WEB_URL ?? DEFAULT_WEB_URL,
    apiUrl: option("--api-url") ?? process.env.WEBGAZE_API_URL ?? DEFAULT_API_URL,
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Production smoke passed at ${result.checked_at}`);
  for (const check of result.checks) {
    console.log(`PASS ${check.name} (${check.duration_ms} ms)`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Production smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
