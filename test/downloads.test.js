// Guards the download path: the installer must exist, every copy of it must be
// the same build, and every checksum or link we publish must match reality.
//
// These exist because each one has broken in production at least once: a page
// linked an installer filename that no longer existed, a page published the
// checksum of a different build, and the legacy download sat on a stale release
// for months because nothing compared it to the current one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRIMARY_INSTALLER = "FormatFlowStudioInstaller.exe";
// Kept so older download links keep working; must track the primary installer.
const LEGACY_INSTALLER = "downloads/FormatFlow-Studio-2-Day-Trial.exe";

const read = (rel) => readFileSync(path.join(ROOT, rel));
const sha256 = (rel) => createHash("sha256").update(read(rel)).digest("hex").toUpperCase();
const htmlFiles = () => readdirSync(ROOT).filter((f) => f.endsWith(".html"));

// Resolve a site-absolute or page-relative href to a repo path. Pages live at
// the root, so both forms map to the same place.
const hrefToRepoPath = (href) => href.replace(/^https:\/\/formatflow\.ai\//, "").replace(/^\//, "");

test("primary installer exists and is a real Windows executable", () => {
  assert.ok(existsSync(path.join(ROOT, PRIMARY_INSTALLER)), `${PRIMARY_INSTALLER} is missing`);
  const bytes = read(PRIMARY_INSTALLER);
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "MZ", "installer is not a PE executable");
  assert.ok(bytes.includes(Buffer.from("Nullsoft")), "installer is not an NSIS package");
  assert.ok(bytes.length > 1_000_000, "installer is suspiciously small — truncated upload?");
});

test("legacy download is the same build as the primary installer", () => {
  assert.ok(existsSync(path.join(ROOT, LEGACY_INSTALLER)), `${LEGACY_INSTALLER} is missing`);
  assert.equal(
    sha256(LEGACY_INSTALLER),
    sha256(PRIMARY_INSTALLER),
    `${LEGACY_INSTALLER} has drifted from ${PRIMARY_INSTALLER}. Refresh it with a byte copy ` +
      "of the current installer so the legacy link stops serving a stale release.",
  );
});

test("every checksum in checksums.txt matches its file", () => {
  const lines = readFileSync(path.join(ROOT, "checksums.txt"), "utf8").split("\n");
  const entries = lines
    .map((line) => line.match(/^(\S+\.exe)\s+SHA256:\s*([0-9A-Fa-f]{64})/))
    .filter(Boolean)
    .map((m) => ({ file: m[1], published: m[2].toUpperCase() }));

  assert.ok(entries.length >= 2, "expected checksums.txt to cover both download paths");

  for (const { file, published } of entries) {
    assert.ok(existsSync(path.join(ROOT, file)), `checksums.txt lists a missing file: ${file}`);
    assert.equal(sha256(file), published, `checksums.txt is stale for ${file}`);
  }
});

test("every checksum published in HTML matches the shipping installer", () => {
  const expected = sha256(PRIMARY_INSTALLER);
  let found = 0;

  for (const file of htmlFiles()) {
    const html = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of html.matchAll(/\b[0-9a-fA-F]{64}\b/g)) {
      found += 1;
      assert.equal(
        match[0].toUpperCase(),
        expected,
        `${file} publishes a checksum that is not the current installer's`,
      );
    }
  }

  assert.ok(found > 0, "no published checksum found in any page — did the verify block get dropped?");
});

test("every .exe link in HTML points at a file that exists", () => {
  let checked = 0;

  for (const file of htmlFiles()) {
    const html = readFileSync(path.join(ROOT, file), "utf8");
    const hrefs = [...html.matchAll(/href="([^"]+\.exe)"/g)].map((m) => m[1]);
    // JSON-LD downloadUrl / offer urls are advertised to search engines, so a
    // dangling one is published just as loudly as a broken button.
    const jsonLd = [...html.matchAll(/"(https:\/\/formatflow\.ai\/[^"]+\.exe)"/g)].map((m) => m[1]);

    for (const href of [...hrefs, ...jsonLd]) {
      const target = hrefToRepoPath(href);
      checked += 1;
      assert.ok(existsSync(path.join(ROOT, target)), `${file} links to a missing installer: ${href}`);
    }
  }

  assert.ok(checked > 0, "found no installer links to verify");
});
