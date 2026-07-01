import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("../assets/vendor/jszip.min.js");

const FIXTURE = fileURLToPath(new URL("../test/fixtures/sample.pptx", import.meta.url));

test.beforeEach(async ({ page }) => {
  // Analytics is irrelevant to these tests and unreachable in CI sandboxes.
  await page.route("https://plausible.io/**", (route) => route.abort());
});

test("analyses a PPTX locally in the browser", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#demoFile", FIXTURE);
  await expect(page.locator("#demoStatusTitle")).toHaveText("File ready");
  await page.click("#runDemo");
  await expect(page.locator("#demoStatusTitle")).toHaveText("File analysis complete");
  await expect(page.locator("#textPreview")).toContainText("Hello world");
  await expect(page.locator("#resultGrid")).toContainText("PowerPoint Presentation");
  await expect(page.locator("#resultGrid")).toContainText("2 slides");
  await expect(page.locator("#translateFile")).toBeEnabled();
  await expect(page.locator("#downloadReport")).toBeEnabled();
});

test("round-trip translate & download rebuilds the PPTX with translations", async ({ page }) => {
  await page.route("**/api/translate-file", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        targetLanguage: body.targetLanguage,
        segmentCount: body.segments.length,
        translations: body.segments.map((segment) => `[ES] ${segment}`),
        notes: [],
      },
    });
  });

  await page.goto("/");
  await page.setInputFiles("#demoFile", FIXTURE);
  await page.click("#runDemo");
  await expect(page.locator("#translateFile")).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await page.click("#translateFile");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sample_SP.pptx");

  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const slide1 = await zip.file("ppt/slides/slide1.xml").async("string");
  expect(slide1).toContain("[ES] Hello world");
  // & must survive the decode → translate → re-encode round trip.
  expect(slide1).toContain("[ES] Quarterly results &amp; outlook");
  expect(slide1).toContain("[ES] Contact: sales@example.com");
  const slide2 = await zip.file("ppt/slides/slide2.xml").async("string");
  expect(slide2).toContain("[ES] Thank you");
  await expect(page.locator("#translateResult")).toContainText("sample_SP.pptx");
});

test("over-cap files are pointed at the Windows app instead of the API", async ({ page }) => {
  let apiCalled = false;
  await page.route("**/api/translate-file", async (route) => {
    apiCalled = true;
    await route.fulfill({ json: { translations: [] } });
  });

  await page.goto("/");
  await page.setInputFiles("#demoFile", {
    name: "big.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: readFileSync(await buildBigPptx()),
  });
  await page.click("#runDemo");
  await expect(page.locator("#translateFile")).toBeEnabled();
  await page.click("#translateFile");
  await expect(page.locator("#translateResult")).toContainText("beyond the free online limit");
  expect(apiCalled).toBe(false);
});

async function buildBigPptx() {
  const { writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const zip = new JSZip();
  const source = await JSZip.loadAsync(readFileSync(FIXTURE));
  for (const [name, entry] of Object.entries(source.files)) {
    if (!entry.dir) zip.file(name, await entry.async("uint8array"));
  }
  const runs = Array.from({ length: 200 }, (_, i) => `<a:p><a:r><a:t>Segment number ${i} with some words</a:t></a:r></a:p>`).join("");
  zip.file("ppt/slides/slide3.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${runs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const path = join(tmpdir(), "formatflow-big.pptx");
  writeFileSync(path, buffer);
  return path;
}
