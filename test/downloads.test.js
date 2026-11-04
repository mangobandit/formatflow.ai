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
import { inflateRawSync } from "node:zlib";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRIMARY_INSTALLER = "FormatFlowStudioInstaller.exe";
// Kept so older download links keep working; must track the primary installer.
const LEGACY_INSTALLER = "downloads/FormatFlow-Studio-2-Day-Trial.exe";
const INDESIGN_PLUGIN = "downloads/FormatFlow-Translate-InDesign-v3.3.4-PREVIEW.zip";

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
    .map((line) => line.match(/^(\S+\.(?:exe|zip|ccx))\s+SHA256:\s*([0-9A-Fa-f]{64})/))
    .filter(Boolean)
    .map((m) => ({ file: m[1], published: m[2].toUpperCase() }));

  assert.ok(entries.length >= 4, "expected checksums.txt to cover Studio and InDesign downloads");

  for (const { file, published } of entries) {
    assert.ok(existsSync(path.join(ROOT, file)), `checksums.txt lists a missing file: ${file}`);
    assert.equal(sha256(file), published, `checksums.txt is stale for ${file}`);
  }
});

test("InDesign page ships a complete 3.3.4 development preview package", () => {
  assert.ok(existsSync(path.join(ROOT, INDESIGN_PLUGIN)), `${INDESIGN_PLUGIN} is missing`);
  const bytes = read(INDESIGN_PLUGIN);
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", "plugin download is not a ZIP package");
  assert.ok(bytes.length > 20_000, "plugin package is suspiciously small");

  const files = zipEntries(bytes);
  const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
  assert.equal(manifest.version, "3.3.4");
  assert.equal(manifest.host.app, "ID");
  const panel = files.get("index.html").toString("utf8");
  for (const match of panel.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)) {
    assert.ok(files.has(match[1]), `plugin panel references missing runtime file: ${match[1]}`);
  }
  for (const [name, content] of files) {
    assert.doesNotMatch(name, /(?:^|\/)(?:\.git|node_modules|\.env)(?:\/|$)/);
    if (name.startsWith("src/") && name.endsWith(".js")) new Function(content.toString("utf8"));
  }

  const html = readFileSync(path.join(ROOT, "indesign-plugin.html"), "utf8");
  assert.match(html, /Version 3\.3\.4 development preview/i);
  assert.match(html, /still needs testing inside Adobe InDesign/i);
  assert.match(html, /Overset Text Fixer/i);
  assert.match(html, /Auto, Dark and Light themes/i);
  assert.match(html, /check\/uncheck all/i);
  assert.ok(html.includes(`/${INDESIGN_PLUGIN}`), "InDesign page does not link the preview package");
  assert.match(html, new RegExp(`<code id="pluginChecksum">${sha256(INDESIGN_PLUGIN)}</code>`));
});

test("every checksum published in HTML matches a download advertised on that page", () => {
  let found = 0;

  for (const file of htmlFiles()) {
    const html = readFileSync(path.join(ROOT, file), "utf8");
    const downloads = [...html.matchAll(/(?:href=|downloadUrl"\s*:\s*)"([^"?#]+\.(?:exe|zip|ccx))"/g)]
      .map((match) => hrefToRepoPath(match[1]));
    const expected = new Set(downloads.map(sha256));
    for (const match of html.matchAll(/\b[0-9a-fA-F]{64}\b/g)) {
      found += 1;
      assert.ok(expected.has(match[0].toUpperCase()), `${file} publishes a checksum that does not match an advertised download`);
    }
  }

  assert.ok(found > 0, "no published checksum found in any page — did the verify block get dropped?");
});

function zipEntries(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50, "ZIP directory is missing");
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const result = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const size = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
    const dataOffset = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    const compressed = bytes.subarray(dataOffset, dataOffset + size);
    assert.ok(method === 0 || method === 8, `unsupported ZIP compression for ${name}`);
    if (!name.endsWith("/")) result.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

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
