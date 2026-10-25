#!/usr/bin/env node
// Runs the UI suites against the real React app in Chrome, with the Tauri side mocked.
//
//   npm run test:ui                 all suites
//   npm run test:ui -- queue chrome only the named suites (file names without .mjs)
//
// Needs Google Chrome installed (or KAISU_E2E_BROWSER=/path/to/chrome).
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const suites = readdirSync(join(here, "suites"))
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => f.replace(/\.mjs$/, ""))
  .filter((name) => wanted.length === 0 || wanted.includes(name))
  .sort();

if (suites.length === 0) {
  console.error(`No suites match ${wanted.join(", ")}`);
  process.exit(2);
}

const server = await createServer({
  configFile: resolve(here, "vite.config.mjs"),
  server: { port: 0, host: "127.0.0.1" },
});
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error("The test server did not start");

const run = (name) =>
  new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(here, "suites", `${name}.mjs`)], {
      env: { ...process.env, KAISU_E2E_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => {
      const summary = output.match(/(\d+) passed, (\d+) failed/);
      done({ name, code: code === 0 && (!summary || +summary[1] === 0) ? 1 : code, output, seconds: Math.round((Date.now() - started) / 1000), passed: summary ? +summary[1] : 0, failed: summary ? +summary[2] : null });
    });
  });

const results = [];
for (const name of suites) {
  process.stdout.write(`${name.padEnd(12)} `);
  const r = await run(name);
  results.push(r);
  console.log(r.code === 0 ? `ok    ${String(r.passed).padStart(3)} checks (${r.seconds}s)` : `FAILED (${r.seconds}s)`);
  if (r.code !== 0) console.log(r.output.split("\n").map((l) => `    ${l}`).join("\n"));
}

await server.close();
const total = results.reduce((n, r) => n + r.passed, 0);
const bad = results.filter((r) => r.code !== 0);
console.log(`\n${total} checks passed${bad.length ? `, ${bad.length} suite(s) failed: ${bad.map((b) => b.name).join(", ")}` : ""}`);
process.exit(bad.length ? 1 : 0);
