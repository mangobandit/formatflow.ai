import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asArray,
  documentLabel,
  titleCase,
  cleanString,
  rateLimit,
  rateLimitDistributed,
  resolveOrigin,
  requestId,
  enforceBodyLimit,
} from "../api/_shared.js";
import qaReport from "../api/qa-report.js";
import workflowPlan from "../api/workflow-plan.js";
import { MODEL_CHOICES, DEFAULT_MODEL_KEY, resolveModel } from "../api/translate-demo.js";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

function mockReq(method, body, headers = {}) {
  return { method, body, headers };
}

test("asArray splits strings and trims", () => {
  assert.deepEqual(asArray("a, b,\nc"), ["a", "b", "c"]);
  assert.deepEqual(asArray(["x ", " y"]), ["x", "y"]);
  assert.deepEqual(asArray(null), []);
});

test("documentLabel normalises common types", () => {
  assert.equal(documentLabel("pptx"), "PowerPoint Presentation");
  assert.equal(documentLabel("word doc"), "Word Document");
  assert.equal(documentLabel("scan.pdf"), "PDF");
});

test("titleCase tidies separators", () => {
  assert.equal(titleCase("client_proposal-draft"), "Client Proposal Draft");
});

test("cleanString collapses whitespace and caps length", () => {
  assert.equal(cleanString("  a   b  "), "a b");
  assert.equal(cleanString("abcdef", 3), "abc");
  assert.equal(cleanString(42), "");
});

test("resolveOrigin only echoes trusted origins", () => {
  assert.equal(resolveOrigin(mockReq("POST", {}, { origin: "https://formatflow.ai" })), "https://formatflow.ai");
  assert.equal(resolveOrigin(mockReq("POST", {}, { origin: "https://evil.example" })), null);
  assert.equal(resolveOrigin(mockReq("POST", {}, {})), null);
});

test("rateLimit blocks after the configured limit", () => {
  const key = `test-${Math.random()}`;
  const opts = { limit: 2, windowMs: 1000 };
  assert.equal(rateLimit(key, opts).ok, true);
  assert.equal(rateLimit(key, opts).ok, true);
  assert.equal(rateLimit(key, opts).ok, false);
});

test("rateLimitDistributed falls back to in-memory when Upstash is unset", async () => {
  const key = `dist-${Math.random()}`;
  const opts = { limit: 1, windowMs: 1000 };
  assert.equal((await rateLimitDistributed(key, opts)).ok, true);
  assert.equal((await rateLimitDistributed(key, opts)).ok, false);
});

test("requestId echoes a sane incoming id, else generates one", () => {
  assert.equal(requestId(mockReq("POST", {}, { "x-request-id": "abc-123" })), "abc-123");
  const gen = requestId(mockReq("POST", {}, {}));
  assert.ok(typeof gen === "string" && gen.length > 8);
});

test("enforceBodyLimit rejects oversized payloads", () => {
  const small = mockRes();
  assert.equal(enforceBodyLimit(mockReq("POST", {}, { "content-length": "100" }), small, 256), true);
  const big = mockRes();
  assert.equal(enforceBodyLimit(mockReq("POST", {}, { "content-length": "999999" }), big, 256), false);
  assert.equal(big.statusCode, 413);
});

test("qa-report rejects non-POST", async () => {
  const res = mockRes();
  await qaReport(mockReq("GET", {}), res);
  assert.equal(res.statusCode, 405);
});

test("qa-report requires a target language", async () => {
  const res = mockRes();
  await qaReport(mockReq("POST", { documentType: "pptx" }, { origin: "https://formatflow.ai" }), res);
  assert.equal(res.statusCode, 400);
});

test("qa-report returns checklist for a valid request", async () => {
  const res = mockRes();
  await qaReport(
    mockReq("POST", { documentType: "pptx", targetLanguages: ["German"], containsTables: true }, { origin: "https://formatflow.ai" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.qa_checks));
  assert.ok(res.body.qa_checks.some((c) => /slide count/i.test(c)));
  assert.ok(res.body.high_risk_items.some((c) => /expand text length/i.test(c)));
});

test("workflow-plan produces naming examples per language", async () => {
  const res = mockRes();
  await workflowPlan(
    mockReq("POST", { documentType: "word", targetLanguages: ["French", "Spanish"] }, { origin: "https://formatflow.ai" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.output_naming.length, 2);
  assert.ok(res.body.output_naming[0].endsWith(".docx"));
});

test("resolveModel maps menu keys to model ids", () => {
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_MODEL_QUALITY;
  delete process.env.OPENAI_MODEL_LATEST;
  assert.equal(resolveModel("fast"), "gpt-4o-mini");
  assert.equal(resolveModel("quality"), "gpt-4o");
  assert.equal(resolveModel("latest"), "gpt-5.6");
});

test("resolveModel falls back to the default for unknown or hostile input", () => {
  delete process.env.OPENAI_MODEL;
  // A caller must never be able to choose an arbitrary model with our API key.
  for (const value of [undefined, null, "", "  ", "o1-pro", "../../admin", 42, {}, []]) {
    assert.equal(resolveModel(value), "gpt-4o-mini");
  }
});

test("resolveModel accepts keys case-insensitively and trimmed", () => {
  delete process.env.OPENAI_MODEL_LATEST;
  assert.equal(resolveModel(" LATEST "), "gpt-5.6");
  assert.equal(resolveModel("Quality"), "gpt-4o");
});

test("resolveModel honours env overrides for each choice", () => {
  process.env.OPENAI_MODEL_LATEST = "gpt-5.6-preview";
  process.env.OPENAI_MODEL_QUALITY = "gpt-4.1";
  process.env.OPENAI_MODEL = "gpt-4o-mini-2024";
  assert.equal(resolveModel("latest"), "gpt-5.6-preview");
  assert.equal(resolveModel("quality"), "gpt-4.1");
  assert.equal(resolveModel("fast"), "gpt-4o-mini-2024");
  delete process.env.OPENAI_MODEL_LATEST;
  delete process.env.OPENAI_MODEL_QUALITY;
  delete process.env.OPENAI_MODEL;
});

test("every model menu key is exposed with a label", () => {
  assert.deepEqual(Object.keys(MODEL_CHOICES), ["fast", "quality", "latest"]);
  assert.equal(MODEL_CHOICES.latest.label, "ChatGPT 5.6");
  assert.ok(DEFAULT_MODEL_KEY in MODEL_CHOICES);
});
