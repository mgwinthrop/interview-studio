#!/usr/bin/env node
// Fails if a build's client bundle contains the test seam (FQ-108 S0, app/session/testSeams.ts).
// Run after a normal `npm run build`: `npm run check:no-test-seams` (scans .next), or pass another
// build directory as the first argument. It also fails when the directory has no client bundle,
// so a missing or wrong build can never pass by finding nothing.
import fs from "node:fs";
import path from "node:path";

const MARKER = "__testSeams";
const distDir = path.resolve(process.argv[2] ?? ".next");
const staticDir = path.join(distDir, "static");

if (!fs.existsSync(staticDir)) {
  console.error(`check:no-test-seams: no client bundle at ${staticDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

let scanned = 0;
const hits = [];
for (const entry of fs.readdirSync(staticDir, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  const file = path.join(entry.parentPath ?? entry.path, entry.name);
  scanned++;
  if (fs.readFileSync(file, "utf8").includes(MARKER)) hits.push(path.relative(distDir, file));
}

if (scanned === 0) {
  console.error(`check:no-test-seams: no JavaScript found under ${staticDir}.`);
  process.exit(1);
}
if (hits.length > 0) {
  console.error(`check:no-test-seams: the test seam (${MARKER}) is in ${hits.length} client file(s):`);
  for (const h of hits) console.error(`  ${h}`);
  console.error("This build was made with NEXT_PUBLIC_TEST_SEAMS=1 and must not be served to people.");
  process.exit(1);
}
console.log(`check:no-test-seams: OK, ${scanned} client files in ${path.relative(process.cwd(), distDir) || "."} have no test seam.`);
