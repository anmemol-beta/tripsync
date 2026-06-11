#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const FEATURE_PATH_RE = /^(apps|packages|test)\//;
const COORDINATION_PATH_RE = /^coordination\/decisions\.md$/;

const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const featureFiles = staged.filter((file) => FEATURE_PATH_RE.test(file));
const hasCoordinationDecision = staged.some((file) => COORDINATION_PATH_RE.test(file));

if (featureFiles.length > 0 && !hasCoordinationDecision) {
  console.error("Coordination guard failed.");
  console.error("Feature changes under apps/, packages/, or test/ require a staged update to coordination/decisions.md.");
  console.error("");
  console.error("Feature files:");
  for (const file of featureFiles) console.error(`  - ${file}`);
  console.error("");
  console.error("Record the screen-agent feedback and PM decision, then stage coordination/decisions.md.");
  console.error("Temporary bypass: SKIP_COORDINATION_CHECK=1 git commit ...");
  process.exit(1);
}

console.log("Coordination guard passed.");

