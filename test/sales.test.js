import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

test("manual paid-beta path has complete policy pages", () => {
  for (const file of ["paid-beta.html", "terms.html", "refund-policy.html", "privacy.html"]) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} is missing`);
  }

  const sales = read("paid-beta.html");
  assert.match(sales, /Request a quote and invoice/);
  assert.match(sales, /mailto:hello@formatflow\.ai/);
  assert.match(sales, /two-day trial/i);
  assert.match(sales, /terms\.html/);
  assert.match(sales, /refund-policy\.html/);
});

test("site does not claim an automated checkout exists", () => {
  const pages = ["index.html", "paid-beta.html", "formatflow-studio.html"].map(read).join("\n");
  assert.doesNotMatch(pages, /checkout\.stripe\.com|buy\.stripe\.com|stripe\.js/i);
  assert.doesNotMatch(pages, /\{\{\s*(price|seller|currency|company)\s*\}\}/i);
  assert.match(pages, /request (?:a )?(?:paid license|quote)/i);
});

test("refund policy preserves mandatory consumer rights", () => {
  const policy = read("refund-policy.html");
  assert.match(policy, /14 calendar days/i);
  assert.match(policy, /mandatory rights/i);
  assert.match(policy, /original payment method/i);
});
