#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const failures = [];
const warnings = [];
const requiredFiles = [
  "docs/productization/PRODUCTIZATION_PLAN.md",
  "docs/productization/PRODUCTIZATION_PLAN.html",
  "docs/governance/PDCA_GOVERNANCE.md",
  "docs/governance/RCA_CAPA_TEMPLATE.md",
  "task_plan.md",
  "DEV_LOG.md",
];

function read(path) {
  return readFileSync(path, "utf8");
}

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push("Missing required PDCA file: " + file);
}

if (existsSync("docs/productization/PRODUCTIZATION_PLAN.md")) {
  const plan = read("docs/productization/PRODUCTIZATION_PLAN.md");
  for (const term of [
    "Phase 0",
    "Phase 1",
    "Phase 2",
    "Phase 3",
    "Phase 4",
    "Phase 5",
    "Phase 6",
    ".3dbpart",
    "RCA/CAPA",
    "npm run pdca:check",
  ]) {
    if (!plan.includes(term))
      failures.push("Plan is missing required term: " + term);
  }
}

if (existsSync("docs/productization/PRODUCTIZATION_PLAN.html")) {
  const html = read("docs/productization/PRODUCTIZATION_PLAN.html");
  for (const term of [
    "<!doctype html>",
    "產品化開發藍圖",
    "PDCA",
    ".3dbpart",
  ]) {
    if (!html.includes(term))
      failures.push("HTML plan is missing required term: " + term);
  }
}

if (existsSync("package.json")) {
  const pkg = JSON.parse(read("package.json"));
  if (
    !pkg.scripts ||
    pkg.scripts["pdca:check"] !== "node tools/pdca-check.mjs"
  ) {
    failures.push("package.json must define scripts.pdca:check");
  }
  if (!pkg.scripts || !pkg.scripts["pdca:full"]) {
    failures.push("package.json must define scripts.pdca:full");
  }
}

const stagedNames = git(["diff", "--cached", "--name-only"])
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const stagedDiff = git(["diff", "--cached", "--unified=0"]);
const highRiskPatterns = [
  /\+.*\.sldprt/i,
  /\+.*\.sldasm/i,
  /\+.*SolidWorks Part/i,
  /\+.*handleSaveSldprt/i,
  /\+.*sketchPoints/i,
];
const highRiskHit = highRiskPatterns.some((pattern) =>
  pattern.test(stagedDiff),
);

if (highRiskHit) {
  const hasGovernanceUpdate = stagedNames.some(
    (name) =>
      name === "DEV_LOG.md" ||
      name === "task_plan.md" ||
      name.startsWith("docs/productization/") ||
      name.startsWith("docs/governance/"),
  );
  if (!hasGovernanceUpdate) {
    failures.push(
      "High-risk Plan-sensitive staged changes require DEV_LOG/task_plan/Plan/Governance update.",
    );
  }
}

const trackedRiskSnapshot = [
  ["package.json", new RegExp("sldprt|SolidWorks Part", "i")],
  [
    "src/app/page.tsx",
    new RegExp("handleSaveSldprt|儲存 SLDPRT|SolidWorks 參數化零件", "i"),
  ],
];

for (const [file, pattern] of trackedRiskSnapshot) {
  if (existsSync(file) && pattern.test(read(file))) {
    warnings.push(
      "Known Phase 0 Plan debt remains in " +
        file +
        ": native save/file association still implies SolidWorks native compatibility.",
    );
  }
}

if (failures.length > 0) {
  console.error("\nPDCA Check failed. Output is not aligned with Plan.");
  for (const failure of failures) console.error("- " + failure);
  console.error(
    "\nAct required: add RCA/CAPA to DEV_LOG.md, correct the output, then rerun npm run pdca:check.",
  );
  process.exit(1);
}

console.log(
  "PDCA Check passed: required Plan/Governance files and hook registration are present.",
);
if (warnings.length > 0) {
  console.warn("\nPDCA warnings / tracked Plan debt:");
  for (const warning of warnings) console.warn("- " + warning);
}
