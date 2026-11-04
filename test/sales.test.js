import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

test("planned annual-seat offer has complete policy pages and is distinguished from the current beta", () => {
  for (const file of ["paid-beta.html", "terms.html", "refund-policy.html", "privacy.html"]) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} is missing`);
  }

  const sales = read("paid-beta.html");
  assert.match(sales, /Request an annual seat quote/);
  assert.match(sales, /annual licensing priced per named seat/i);
  assert.match(sales, /business package is not yet available/i);
  assert.match(sales, /current beta terms apply/i);
  assert.match(sales, /mailto:hello@formatflow\.ai/);
  assert.match(sales, /two-day trial/i);
  assert.match(sales, /terms\.html/);
  assert.match(sales, /refund-policy\.html/);
});

test("site does not claim an automated checkout exists", () => {
  const pages = ["index.html", "paid-beta.html", "formatflow-studio.html"].map(read).join("\n");
  assert.doesNotMatch(pages, /checkout\.stripe\.com|buy\.stripe\.com|stripe\.js/i);
  assert.doesNotMatch(pages, /\{\{\s*(price|seller|currency|company)\s*\}\}/i);
  assert.match(pages, /request (?:an? )?(?:annual seat quote|seat quote|quote)/i);
});

test("refund policy preserves mandatory consumer rights", () => {
  const policy = read("refund-policy.html");
  assert.match(policy, /14 calendar days/i);
  assert.match(policy, /mandatory rights/i);
  assert.match(policy, /original payment method/i);
});
