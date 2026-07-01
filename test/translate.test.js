import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import translateFile, { MAX_SEGMENTS, MAX_TOTAL_CHARS } from "../api/translate-file.js";
import translateDemo from "../api/translate-demo.js";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

// Each request gets a unique client IP so the in-memory rate limiter never trips.
let ipCounter = 0;
function mockReq(body, headers = {}) {
  ipCounter += 1;
  return {
    method: "POST",
    body,
    headers: { "x-forwarded-for": `10.0.0.${ipCounter}`, ...headers },
  };
}

function openAIResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ output_text: JSON.stringify(payload) }),
  };
}

const realFetch = globalThis.fetch;
let fetchCalls;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_TIMEOUT_MS;
});

function stubFetch(impl) {
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return impl(url, options);
  };
}

test("translate-file returns aligned translations", async () => {
  stubFetch(() => openAIResponse({ translations: ["Hola mundo", "Resultados"] }));
  const res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: ["Hello world", "Results"] }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.translations, ["Hola mundo", "Resultados"]);
  assert.equal(res.body.segmentCount, 2);
  assert.deepEqual(res.body.notes, []);
  const sent = JSON.parse(fetchCalls[0].options.body);
  assert.equal(sent.text.format.type, "json_schema");
  assert.equal(sent.text.format.strict, true);
});

test("translate-file pads a short model response with source text and a note", async () => {
  stubFetch(() => openAIResponse({ translations: ["Hola mundo"] }));
  const res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: ["Hello world", "Results"] }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.translations, ["Hola mundo", "Results"]);
  assert.equal(res.body.notes.length, 1);
});

test("translate-file rejects missing language and empty segments", async () => {
  stubFetch(() => { throw new Error("should not call OpenAI"); });
  let res = mockRes();
  await translateFile(mockReq({ segments: ["Hello"] }), res);
  assert.equal(res.statusCode, 400);
  res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: [] }), res);
  assert.equal(res.statusCode, 400);
  res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: ["ok", ""] }), res);
  assert.equal(res.statusCode, 400);
});

test("translate-file enforces segment and character caps", async () => {
  stubFetch(() => { throw new Error("should not call OpenAI"); });
  let res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: Array(MAX_SEGMENTS + 1).fill("hi") }), res);
  assert.equal(res.statusCode, 413);
  res = mockRes();
  const big = "a".repeat(500);
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: Array(Math.ceil(MAX_TOTAL_CHARS / 500) + 1).fill(big) }), res);
  assert.equal(res.statusCode, 413);
});

test("translate-file reports missing OPENAI_API_KEY", async () => {
  delete process.env.OPENAI_API_KEY;
  const res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: ["Hello"] }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /OPENAI_API_KEY/);
});

test("translate-file passes upstream error status through", async () => {
  stubFetch(() => ({ ok: false, status: 429, json: async () => ({ error: { message: "rate limited" } }) }));
  const res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: ["Hello"] }), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.details, "rate limited");
});

test("translate-file returns 504 on upstream timeout", async () => {
  process.env.OPENAI_TIMEOUT_MS = "20";
  stubFetch((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));
  const res = mockRes();
  await translateFile(mockReq({ targetLanguage: "Spanish", segments: ["Hello"] }), res);
  assert.equal(res.statusCode, 504);
});

test("translate-demo returns the structured preview and uses env model config", async () => {
  process.env.OPENAI_MODEL = "test-model";
  const preview = {
    summary: "Preview ready",
    translations: [{ language: "Spanish", translatedPreview: "Hola", notes: [] }],
    qaChecks: ["check"],
    nextSteps: ["step"],
  };
  stubFetch(() => openAIResponse(preview));
  const res = mockRes();
  await translateDemo(mockReq({ sourceText: "Hello world, this is a longer preview text.", targetLanguages: ["Spanish"] }), res);
  delete process.env.OPENAI_MODEL;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, preview);
  const sent = JSON.parse(fetchCalls[0].options.body);
  assert.equal(sent.model, "test-model");
  assert.equal(sent.text.format.name, "translation_preview");
});

test("translate-demo maps unparseable model output to 502", async () => {
  stubFetch(() => ({ ok: true, status: 200, json: async () => ({ output_text: "not json" }) }));
  const res = mockRes();
  await translateDemo(mockReq({ sourceText: "Hello world, this is a longer preview text.", targetLanguages: ["Spanish"] }), res);
  assert.equal(res.statusCode, 502);
});
