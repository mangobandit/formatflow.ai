import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpdateResponse, isNewerVersion } from "../api/studio-update.js";

const release = {
  FORMATFLOW_RELEASE_VERSION: "0.5.0",
  FORMATFLOW_RELEASE_URL: "https://formatflow.ai/downloads/FormatFlow-Studio-0.5.0.exe",
  FORMATFLOW_RELEASE_SIGNATURE: "A".repeat(64),
  FORMATFLOW_RELEASE_NOTES: "Signed paid-beta release.",
  FORMATFLOW_RELEASE_PUB_DATE: "2026-07-30T12:00:00Z"
};

test("updater returns a signed release only when it is newer", () => {
  const update = buildUpdateResponse({ current_version: "0.4.0" }, release);
  assert.equal(update.version, "0.5.0");
  assert.equal(update.url, release.FORMATFLOW_RELEASE_URL);
  assert.equal(update.signature, release.FORMATFLOW_RELEASE_SIGNATURE);
  assert.equal(buildUpdateResponse({ current_version: "0.5.0" }, release), null);
  assert.equal(buildUpdateResponse({ current_version: "0.6.0" }, release), null);
});

test("updater fails closed on incomplete or unsafe release metadata", () => {
  assert.equal(buildUpdateResponse({ current_version: "0.4.0" }, {}), null);
  assert.equal(buildUpdateResponse({ current_version: "0.4.0" }, { ...release, FORMATFLOW_RELEASE_URL: "http://example.com/update.exe" }), null);
  assert.equal(buildUpdateResponse({ current_version: "0.4.0" }, { ...release, FORMATFLOW_RELEASE_SIGNATURE: "short" }), null);
});

test("version comparison handles normal and prerelease versions", () => {
  assert.equal(isNewerVersion("1.0.1", "1.0.0"), true);
  assert.equal(isNewerVersion("1.0.0", "1.0.0-beta.1"), true);
  assert.equal(isNewerVersion("1.0.0-beta.2", "1.0.0-beta.1"), true);
  assert.equal(isNewerVersion("1.0.0-beta.1", "1.0.0"), false);
});
