#!/usr/bin/env node
// @ts-check
/**
 * Frontend coverage baseline gate — Plan 1 §9.5 / acceptance A2.
 *
 * This is a REGRESSION GUARD, not an aspirational threshold. The floors are
 * pinned to the CURRENT measured coverage baseline (rounded DOWN, minus a small
 * 2-point safety margin) so the gate is GREEN today and only trips when coverage
 * genuinely regresses below the baseline.
 *
 * ── Measured baseline ──────────────────────────────────────────────────────
 * Source : Vitest v8 coverage via `ng test --watch=false --coverage`
 *          (@angular/build:unit-test builder), Node 24.
 * Date   : 2026-07-02
 *   lines      = 43.63 %   -> floor 41
 *   statements = 45.05 %   -> floor 43
 *   functions  = 22.31 %   -> floor 20
 *   branches   = 31.05 %   -> floor 29
 * Formula: floor(metric) = max(0, Math.floor(baseline_pct) - 2)
 *
 * Ratchet policy (§9.5): when coverage rises, RAISE these floors to lock in the
 * gain. P0 areas (services/interceptor/guards/helpers) target >= 85% lines.
 *
 * Any floor may be overridden at runtime via env vars (COV_MIN_LINES,
 * COV_MIN_STATEMENTS, COV_MIN_FUNCTIONS, COV_MIN_BRANCHES) for local ratcheting
 * experiments without editing this file.
 *
 * Runtime: Node ESM, `node:` stdlib only. No external dependencies.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// ── Floors: measured baseline (2026-07-02) rounded down, minus 2-pt margin ──
const FLOORS = {
  lines: Number(process.env.COV_MIN_LINES ?? 41), // baseline 43.63%
  statements: Number(process.env.COV_MIN_STATEMENTS ?? 43), // baseline 45.05%
  functions: Number(process.env.COV_MIN_FUNCTIONS ?? 20), // baseline 22.31%
  branches: Number(process.env.COV_MIN_BRANCHES ?? 29), // baseline 31.05%
};

/** Metrics checked, in display order. */
const METRICS = /** @type {const} */ (['lines', 'statements', 'functions', 'branches']);

/**
 * Locate coverage-summary.json. The documented path is
 * `coverage/coverage-summary.json`, but the @angular/build:unit-test (Vitest)
 * builder writes reports to `coverage/<projectName>/`. Search both, plus an
 * optional COVERAGE_SUMMARY env override, and use the first that exists.
 * @returns {string | undefined}
 */
function resolveSummaryPath() {
  /** @type {string[]} */
  const candidates = [];
  if (process.env.COVERAGE_SUMMARY) candidates.push(process.env.COVERAGE_SUMMARY);
  candidates.push(join('coverage', 'coverage-summary.json'));
  const coverageDir = 'coverage';
  if (existsSync(coverageDir)) {
    for (const entry of readdirSync(coverageDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(join(coverageDir, entry.name, 'coverage-summary.json'));
      }
    }
  }
  return candidates.find((p) => existsSync(p));
}

/**
 * @param {number} n
 * @returns {string}
 */
const fmtPct = (n) => `${n.toFixed(2)}%`;

/** @param {string} s @param {number} w */
const pad = (s, w) => String(s).padEnd(w);
/** @param {string} s @param {number} w */
const padStart = (s, w) => String(s).padStart(w);

function main() {
  const summaryPath = resolveSummaryPath();
  if (!summaryPath) {
    console.error(
      '[check-coverage] ERROR: coverage-summary.json not found.\n' +
        '  Looked for coverage/coverage-summary.json and coverage/<project>/coverage-summary.json.\n' +
        "  Run `npx ng test --watch=false --coverage` first (json-summary reporter is enabled in angular.json).",
    );
    process.exit(1);
  }

  /** @type {any} */
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  } catch (err) {
    console.error(`[check-coverage] ERROR: failed to parse ${summaryPath}: ${/** @type {Error} */ (err).message}`);
    process.exit(1);
  }

  const total = summary && summary.total;
  if (!total) {
    console.error(`[check-coverage] ERROR: no "total" object in ${summaryPath}.`);
    process.exit(1);
  }

  // Build rows and evaluate pass/fail per metric.
  const rows = METRICS.map((metric) => {
    const actual = Number(total?.[metric]?.pct);
    const floor = FLOORS[metric];
    const ok = Number.isFinite(actual) && actual >= floor;
    return { metric, actual, floor, ok };
  });

  const failed = rows.filter((r) => !r.ok);

  // ── Print a clear table ──────────────────────────────────────────────────
  const header =
    `${pad('Metric', 12)}| ${padStart('Actual', 9)} | ${padStart('Floor', 7)} | Status`;
  const rule = `${'-'.repeat(12)}|${'-'.repeat(11)}|${'-'.repeat(9)}|${'-'.repeat(8)}`;
  console.log('Coverage baseline gate (regression guard) — Plan 1 §9.5 / A2');
  console.log(`Summary: ${summaryPath}`);
  console.log('');
  console.log(header);
  console.log(rule);
  for (const r of rows) {
    const actualStr = Number.isFinite(r.actual) ? fmtPct(r.actual) : 'n/a';
    const status = r.ok ? 'PASS' : 'FAIL';
    console.log(
      `${pad(r.metric, 12)}| ${padStart(actualStr, 9)} | ${padStart(String(r.floor), 7)} | ${status}`,
    );
  }
  console.log('');

  if (failed.length > 0) {
    for (const r of failed) {
      const actualStr = Number.isFinite(r.actual) ? fmtPct(r.actual) : 'n/a';
      console.error(
        `[check-coverage] REGRESSION: ${r.metric} ${actualStr} is below floor ${r.floor}%.`,
      );
    }
    console.error(
      `RESULT: FAIL — ${failed.length} metric(s) below baseline floor. Coverage regressed.`,
    );
    process.exit(1);
  }

  console.log('RESULT: PASS — all metrics at or above baseline floors.');
  process.exit(0);
}

main();
