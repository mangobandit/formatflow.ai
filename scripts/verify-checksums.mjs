// Verifies that checksums.txt matches the committed installer binaries and
// that the checksums shown on the site match checksums.txt. Run by CI.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const failures = [];
const checksums = readFileSync("checksums.txt", "utf8");
const entries = [...checksums.matchAll(/^(\S+)\s+SHA256:\s*([0-9A-Fa-f]{64})$/gm)]
  .map(([, file, hash]) => ({ file, hash: hash.toUpperCase() }));

if (!entries.length) {
  console.error("No checksum entries found in checksums.txt");
  process.exit(1);
}

for (const { file, hash } of entries) {
  let actual;
  try {
    actual = createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
  } catch (error) {
    failures.push(`${file}: cannot read file (${error.message})`);
    continue;
  }
  if (actual !== hash) {
    failures.push(`${file}: checksums.txt says ${hash} but the file hashes to ${actual}`);
  } else {
    console.log(`ok  ${file}  ${hash}`);
  }
}

// The main installer hash is quoted on these pages — keep them in sync.
const mainEntry = entries.find((entry) => entry.file === "FormatFlowStudioInstaller.exe");
if (!mainEntry) {
  failures.push("checksums.txt has no entry for FormatFlowStudioInstaller.exe");
} else {
  for (const page of ["index.html", "formatflow-studio.html"]) {
    const html = readFileSync(page, "utf8");
    if (!html.toUpperCase().includes(mainEntry.hash)) {
      failures.push(`${page}: does not contain the FormatFlowStudioInstaller.exe checksum from checksums.txt`);
    } else {
      console.log(`ok  ${page} quotes the installer checksum`);
    }
  }
}

if (failures.length) {
  console.error("\nChecksum verification failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\nAll checksums verified.");
