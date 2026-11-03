import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import handler, { requestOptions } from "../api/translate-demo.js";

const validPreview = () => ({ summary: "Ready for review", translations: [
  { language: "Spanish", translatedPreview: "Texto en español", notes: [] },
  { language: "French", translatedPreview: "Texte en français", notes: [] },
], qaChecks: ["Review terminology"], nextSteps: ["Export in Studio"] });

async function requestPreview(output, { body, model = "latest" } = {}) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  let payload;
  process.env.OPENAI_API_KEY = "test-placeholder";
  globalThis.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => output };
  };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = JSON.parse(value); } };
  try {
    await handler({ method: "POST", headers: { origin: "https://formatflow.ai", "x-forwarded-for": `test-${Math.random()}` },
      body: body ?? { sourceText: "This is the source text for our document translation preview.", targetLanguages: ["Spanish", "French"], model } }, res);
    return { res, payload };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
}

test("AI preview uses structured output and compatible current reasoning settings", async () => {
  const { res, payload } = await requestPreview({ status: "completed", output_text: JSON.stringify(validPreview()) });
  assert.equal(res.statusCode, 200);
  assert.equal(payload.model, "gpt-6.1-sol");
  assert.deepEqual(payload.reasoning, { effort: "low" });
  assert.equal(payload.temperature, undefined);
  assert.equal(payload.store, false);
  assert.equal(payload.text.format.type, "json_schema");
  assert.equal(payload.text.format.strict, true);
  assert.deepEqual(payload.text.format.schema.properties.translations.items.properties.language.enum, ["Spanish", "French"]);
  assert.deepEqual(requestOptions("gpt-6-luna"), { reasoning: { effort: "none" } });
  assert.deepEqual(requestOptions("gpt-6.1-terra"), { reasoning: { effort: "none" } });
  assert.deepEqual(requestOptions("gpt-4.1"), {});
});

test("AI preview rejects missing, duplicate, empty and unknown language output", async () => {
  for (const mutate of [
    (p) => { p.translations.pop(); },
    (p) => { p.translations[1].language = "Spanish"; },
    (p) => { p.translations[1].translatedPreview = " "; },
    (p) => { p.translations[1].language = "German"; },
  ]) {
    const output = validPreview(); mutate(output);
    const { res } = await requestPreview({ status: "completed", output_text: JSON.stringify(output) });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.translations, undefined);
  }
});

test("AI preview never labels unstructured or incomplete output as valid translations", async () => {
  for (const output of [
    { output_text: "One unstructured text must never be repeated under every language." },
    { status: "incomplete", output_text: JSON.stringify(validPreview()) },
  ]) {
    const { res } = await requestPreview(output);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.translations, undefined);
  }
});

test("invalid preview request JSON produces a client error", async () => {
  const { res, payload } = await requestPreview({}, { body: "{broken" });
  assert.equal(res.statusCode, 400);
  assert.equal(payload, undefined);
});

function pageHarness() {
  class Element {
    constructor() { this.listeners = {}; this.style = {}; this.dataset = {}; this.textContent = ""; this.innerHTML = ""; this.value = ""; this.checked = false; this.disabled = false; this.classes = new Set(); this.attributes = {};
      this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name), toggle: (name, yes) => yes ? this.classes.add(name) : this.classes.delete(name) }; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    async emit(name, event = {}) { for (const fn of this.listeners[name] || []) await fn(event); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() {}
  }
  const nodes = Object.fromEntries(["demoFile", "dropZone", "fileList", "sampleDeck", "runDemo", "progressBar", "demoStatusTitle", "demoStatusText", "resultGrid", "qaList", "textPreview", "downloadReport", "translatePreview", "translateResult", "selectAllLangs", "clearAllLangs", "langCount", "previewConsent", "docType", "toneNotes", "translateModel"].map((id) => [id, new Element()]));
  nodes.docType.value = "Auto-detect"; nodes.translateModel.value = "fast";
  const languages = ["Spanish", "French", "German", "Arabic"].map((language, index) => Object.assign(new Element(), { value: language, checked: index < 2 }));
  const scripts = [];
  const window = { addEventListener() {}, setTimeout, clearTimeout };
  const context = vm.createContext({ window, navigator: {}, location: { hostname: "formatflow.ai" }, console,
    document: { querySelector: (selector) => nodes[selector.slice(1)] || null,
      querySelectorAll: (selector) => selector.includes("language-grid") ? languages : [],
      addEventListener() {}, createElement: () => new Element(), head: { appendChild: (script) => scripts.push(script) }, body: new Element() },
    AbortController, fetch: async () => { throw new Error("Unexpected network request"); }, Blob, URL,
  });
  vm.runInContext(fs.readFileSync(new URL("../assets/site.js", import.meta.url), "utf8"), context);
  return { nodes, languages, scripts, context, evaluate: (code) => vm.runInContext(code, context) };
}

test("file replacement during extraction cannot render an old document under the new file name", async () => {
  const page = pageHarness();
  let finishOld;
  page.context.window.JSZip = { loadAsync: () => new Promise((resolve) => { finishOld = resolve; }) };
  page.evaluate('selectFile({ name: "old.pptx", size: 200 })');
  const run = page.nodes.runDemo.emit("click");
  await Promise.resolve(); await Promise.resolve();
  page.evaluate('selectFile({ name: "new.docx", size: 100 })');
  finishOld({ files: { "ppt/slides/slide1.xml": {} }, file: () => ({ async: async () => "<a:t>Old text</a:t>" }) });
  await run;
  assert.equal(page.evaluate("lastReport"), null);
  assert.equal(page.evaluate("selectedFile.name"), "new.docx");
  assert.equal(page.nodes.downloadReport.disabled, true);
  assert.equal(page.nodes.demoStatusTitle.textContent, "File ready");
});

test("translation requires consent, uses same-origin API, and discards stale replies", async () => {
  const page = pageHarness();
  page.evaluate('lastReport = { fileName: "one.docx", kind: "Word Document", languages: ["Spanish"], preview: "A".repeat(4500) }; syncPreviewControl()');
  assert.equal(page.nodes.translatePreview.disabled, true);
  await page.nodes.translatePreview.emit("click");
  let request, finish;
  page.context.fetch = async (url, options) => { request = { url, options }; return new Promise((resolve) => { finish = resolve; }); };
  page.nodes.previewConsent.checked = true;
  await page.nodes.previewConsent.emit("change");
  assert.equal(page.nodes.translatePreview.disabled, false);
  const run = page.nodes.translatePreview.emit("click");
  assert.equal(request.url, "/api/translate-demo");
  assert.equal(JSON.parse(request.options.body).sourceText.length, 4000);
  page.evaluate('selectFile({ name: "new.docx", size: 100 })');
  assert.equal(request.options.signal.aborted, true);
  finish({ ok: true, status: 200, json: async () => validPreview() });
  await run;
  assert.equal(page.nodes.translateResult.innerHTML, "");
  assert.equal(page.nodes.previewConsent.checked, false);
  assert.equal(page.nodes.translatePreview.disabled, true);
});

test("changing languages clears the previous report and translation result", async () => {
  const page = pageHarness();
  page.evaluate('lastReport = { preview: "old" };');
  page.nodes.translateResult.innerHTML = "old translation";
  await page.languages[2].emit("change");
  assert.equal(page.evaluate("lastReport"), null);
  assert.equal(page.nodes.translateResult.innerHTML, "");
  assert.equal(page.nodes.downloadReport.disabled, true);
});

test("Office extraction keeps literal XML-like text and decodes numeric entities once", () => {
  const page = pageHarness();
  const result = page.evaluate('xmlToTexts("<a:t>Use &lt;/a:t&gt; &amp;lt; &#xE9; &#233;</a:t><w:tabs>ignored</w:tabs>")');
  assert.deepEqual(Array.from(result), ["Use </a:t> &lt; é é"]);
  assert.deepEqual(Array.from(page.evaluate('makeOutputs("deck.pptx", ["German", "French", "Spanish", "Arabic"])')), ["deck_DE.pptx", "deck_FR.pptx", "deck_ES.pptx", "deck_AR.pptx"]);
});

test("a failed reader load can be retried without refreshing the page", async () => {
  const page = pageHarness();
  const first = page.evaluate("loadJSZip()");
  page.scripts[0].onerror();
  await assert.rejects(first, /could not load/);
  const second = page.evaluate("loadJSZip()");
  assert.equal(page.scripts.length, 2);
  page.context.window.JSZip = { reader: true };
  page.scripts[1].onload();
  assert.equal((await second).reader, true);
});

test("service worker skips release archives and preserves unrelated caches", async () => {
  const handlers = {}, deleted = [];
  const context = vm.createContext({ URL, self: { location: { origin: "https://formatflow.ai" }, addEventListener: (event, callback) => { handlers[event] = callback; }, clients: { claim: async () => {} } },
    caches: { keys: async () => ["other-app", "ff-v6-redesign-static", "ff-v7-preview-integrity-static"], delete: async (name) => { deleted.push(name); } },
  });
  vm.runInContext(fs.readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"), context);
  for (const file of ["plugin.zip", "plugin.ccx", "app.exe"]) {
    handlers.fetch({ request: { method: "GET", url: `https://formatflow.ai/downloads/${file}` }, respondWith() { assert.fail("release must not be cached"); } });
  }
  let activation;
  handlers.activate({ waitUntil(value) { activation = value; } });
  await activation;
  assert.deepEqual(deleted, ["ff-v6-redesign-static"]);
});
