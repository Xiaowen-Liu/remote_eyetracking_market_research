import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const assetDirectory = join(process.cwd(), "apps", "web", "dist", "assets");
const budgets = {
  javascript: { extension: ".js", gzipBytes: 155 * 1024 },
  css: { extension: ".css", gzipBytes: 12 * 1024 },
};
const totalBudgetBytes = 170 * 1024;

function kib(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

let filenames;
try {
  filenames = await readdir(assetDirectory);
} catch {
  console.error("Web bundle not found. Run `npm run build:web` before checking its budget.");
  process.exit(1);
}

const measurements = {};
let failed = false;

for (const [name, budget] of Object.entries(budgets)) {
  const matching = filenames.filter((filename) => filename.endsWith(budget.extension));
  const gzipBytes = (
    await Promise.all(
      matching.map(
        async (filename) => gzipSync(await readFile(join(assetDirectory, filename))).byteLength,
      ),
    )
  ).reduce((total, bytes) => total + bytes, 0);
  measurements[name] = gzipBytes;
  const status = gzipBytes <= budget.gzipBytes ? "PASS" : "FAIL";
  console.log(`${status} ${name}: ${kib(gzipBytes)} / ${kib(budget.gzipBytes)} gzip`);
  if (gzipBytes > budget.gzipBytes) failed = true;
}

const totalBytes = Object.values(measurements).reduce((total, bytes) => total + bytes, 0);
const totalStatus = totalBytes <= totalBudgetBytes ? "PASS" : "FAIL";
console.log(`${totalStatus} total: ${kib(totalBytes)} / ${kib(totalBudgetBytes)} gzip`);
if (totalBytes > totalBudgetBytes) failed = true;

if (failed) {
  console.error("Web bundle exceeded its documented performance budget.");
  process.exit(1);
}
