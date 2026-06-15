#!/usr/bin/env node
// Dependency-free secret scanner for CI: fail if a tracked file looks like it
// contains a real secret, or if a non-example `.env` is committed. Patterns are
// deliberately NARROW (PEM keys, provider tokens) — this is a crypto-heavy repo
// full of public keys, signatures, and hex test vectors, so broad "looks like a
// key" heuristics would false-positive. For deep coverage, run gitleaks in CI
// too (documented in docs/operators/); this is the always-on backstop.

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  { name: "PEM private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "private key in JSON", re: /"private_key"\s*:\s*"-----BEGIN/ },
];

// Files we never scan (own patterns / docs that legitimately mention secrets).
const SKIP = [/^scripts\/secret-scan\.mjs$/, /^pnpm-lock\.yaml$/];

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const findings = [];

for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;

  // A committed real .env (anything but *.example / *.sample) is a finding.
  const base = file.split("/").pop() ?? "";
  if (/^\.env($|\.)/.test(base) && !/\.(example|sample|template)$/.test(base)) {
    findings.push({ file, name: "committed .env file" });
    continue;
  }

  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue;
  }
  if (size > 2_000_000) continue; // skip large/binary blobs

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) findings.push({ file, name });
  }
}

if (findings.length > 0) {
  console.error("❌ secret scan found potential secrets:");
  for (const f of findings) console.error(`  - ${f.file}: ${f.name}`);
  process.exit(1);
}
console.log(`✓ secret scan clean (${files.length} tracked files)`);
