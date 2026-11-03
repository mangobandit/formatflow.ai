const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) =>
  scope ? Array.from(scope.querySelectorAll(selector)) : [];

const menuToggle = $("#menuToggle");
const mobileNav = $("#mobileNav");

function closeMenu() {
  if (!menuToggle || !mobileNav) return;
  menuToggle.setAttribute("aria-expanded", "false");
  mobileNav.classList.remove("is-open");
  document.body.classList.remove("menu-open");
}

menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!open));
  mobileNav.classList.toggle("is-open", !open);
  document.body.classList.toggle("menu-open", !open);
});

$$("a", mobileNav).forEach((link) => link.addEventListener("click", closeMenu));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

function track(event, props) {
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    // Analytics must never interrupt the product flow.
  }
}

$$('[data-track="download"]').forEach((element) => {
  element.addEventListener("click", () => {
    track("Download", { location: element.dataset.loc || "unknown" });
  });
});

const checksum = $("#checksum");
const copyChecksum = $("#copyChecksum");

copyChecksum?.addEventListener("click", async () => {
  const value = checksum?.dataset.full || checksum?.textContent?.trim();
  if (!value) return;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch {
    // Fall through to the selection-based copy path below.
  }

  if (!copied) {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    copied = document.execCommand("copy");
    field.remove();
  }

  if (copied) {
    copyChecksum.querySelector("span").textContent = "Copied";
    window.setTimeout(() => {
      copyChecksum.querySelector("span").textContent = "Copy checksum";
    }, 1800);
  } else {
    checksum.textContent = value;
    checksum.removeAttribute("title");
  }
});

const demoFile = $("#demoFile");
const dropZone = $("#dropZone");
const fileList = $("#fileList");
const sampleDeck = $("#sampleDeck");
const runDemo = $("#runDemo");
const progressBar = $("#progressBar");
const demoStatusTitle = $("#demoStatusTitle");
const demoStatusText = $("#demoStatusText");
const resultGrid = $("#resultGrid");
const qaList = $("#qaList");
const textPreview = $("#textPreview");
const downloadReport = $("#downloadReport");
const translatePreview = $("#translatePreview");
const translateResult = $("#translateResult");
const selectAllLangs = $("#selectAllLangs");
const clearAllLangs = $("#clearAllLangs");
const langCount = $("#langCount");
const progressSteps = $$(".progress-step");
const previewConsent = $("#previewConsent");
const initialResultGrid = resultGrid?.innerHTML || "";

let selectedFile = null;
let lastReport = null;
let operationVersion = 0;
let previewController = null;
// Production and preview deployments serve their own API. Cross-origin calls
// to the protected Vercel alias fail both CSP and deployment authentication.
const API_BASE = "";

function clearReport() {
  operationVersion += 1;
  previewController?.abort();
  previewController = null;
  lastReport = null;
  if (downloadReport) downloadReport.disabled = true;
  if (translatePreview) { translatePreview.disabled = true; translatePreview.textContent = "Translate preview"; }
  if (previewConsent) previewConsent.checked = false;
  if (translateResult) translateResult.innerHTML = "";
  if (resultGrid) resultGrid.innerHTML = initialResultGrid;
  if (qaList) qaList.innerHTML = "";
  if (textPreview) textPreview.textContent = "Analyse the selected file to refresh its report.";
  if (demoStatusTitle) demoStatusTitle.textContent = "Ready to analyse";
  if (demoStatusText) demoStatusText.textContent = "Choose target languages, then analyse the file locally.";
  if (runDemo) runDemo.disabled = false;
  setProgress(0);
}

function syncPreviewControl() {
  if (translatePreview) translatePreview.disabled = !lastReport?.preview || !previewConsent?.checked || !!previewController;
}

previewConsent?.addEventListener("change", syncPreviewControl);

let jsZipPromise = null;
let pdfJsPromise = null;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

function readableSize(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function normaliseText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function setProgress(value) {
  if (progressBar) progressBar.style.width = `${value}%`;

  progressSteps.forEach((step, index) => {
    const threshold = [20, 60, 100][index];
    step.classList.toggle("is-active", value > [0, 20, 60][index] && value < threshold);
    step.classList.toggle("is-complete", value >= threshold);
  });
}

function languageInputs() {
  return $$('.language-grid input[type="checkbox"]');
}

function selectedLanguages() {
  return languageInputs()
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function syncLangControls() {
  const inputs = languageInputs();
  const chosen = inputs.filter((input) => input.checked).length;
  if (langCount) langCount.textContent = `${chosen} of ${inputs.length} selected`;
  if (selectAllLangs) selectAllLangs.disabled = chosen === inputs.length;
  if (clearAllLangs) clearAllLangs.disabled = chosen === 0;
}

function setAllLanguages(checked) {
  languageInputs().forEach((input) => {
    input.checked = checked;
  });
  syncLangControls();
  clearReport();
  track(checked ? "Languages Select All" : "Languages Clear All");
}

selectAllLangs?.addEventListener("click", () => setAllLanguages(true));
clearAllLangs?.addEventListener("click", () => setAllLanguages(false));
languageInputs().forEach((input) =>
  input.addEventListener("change", () => { syncLangControls(); clearReport(); }),
);
syncLangControls();

function showFile(file, type) {
  if (!fileList) return;
  fileList.innerHTML = `
    <div class="file-item">
      <span>${escapeHtml(file.name)}</span>
      <span>${escapeHtml(type)} · ${readableSize(file.size)}</span>
    </div>`;
}

function selectFile(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  const type = lower.endsWith(".pptx")
    ? "PPTX"
    : lower.endsWith(".docx")
      ? "DOCX"
      : lower.endsWith(".pdf")
        ? "PDF"
        : "";

  clearReport();
  selectedFile = null;
  textPreview.textContent = "Choose a supported file to analyse.";

  if (!type) {
    showFile(file, "Unsupported");
    demoStatusTitle.textContent = "Unsupported file type";
    demoStatusText.textContent =
      "Choose a PPTX, DOCX or PDF file for the FormatFlow tester.";
    setProgress(0);
    track("Tester Unsupported", {
      extension: lower.includes(".") ? lower.split(".").pop() : "none",
    });
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showFile(file, "Too large");
    demoStatusTitle.textContent = "File exceeds the browser limit";
    demoStatusText.textContent = "Choose a file under 50 MB, or use FormatFlow Studio for larger documents.";
    return;
  }

  selectedFile = file;

  showFile(file, type);
  demoStatusTitle.textContent = "File ready";
  demoStatusText.textContent =
    "Choose target languages, then analyse the file locally.";
  textPreview.textContent = "Ready to analyse.";
  setProgress(12);
}

demoFile?.addEventListener("change", (event) => {
  selectFile(event.target.files?.[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});

dropZone?.addEventListener("drop", (event) => {
  selectFile(event.dataTransfer?.files?.[0]);
});

sampleDeck?.addEventListener("click", () => {
  clearReport();
  selectedFile = {
    name: "FormatFlow_Sample_Deck.pptx",
    size: 1843200,
    sample: true,
  };
  showFile(selectedFile, "PPTX sample");
  demoStatusTitle.textContent = "Sample deck ready";
  demoStatusText.textContent =
    "Analyse the sample to preview the complete review flow.";
  textPreview.textContent = "Sample deck ready to analyse.";
  setProgress(12);
  runDemo.focus();
  track("Tester Sample Selected");
});

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jsZipPromise) {
    jsZipPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      script.onload = () =>
        window.JSZip
          ? resolve(window.JSZip)
          : reject(new Error("The Office document reader did not initialise."));
      script.onerror = () =>
        reject(
          new Error(
            "The Office document reader could not load. Check your connection and retry.",
          ),
        );
      document.head.appendChild(script);
    }).catch((error) => { jsZipPromise = null; throw error; });
  }
  return jsZipPromise;
}

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfJsPromise) {
    pdfJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
      script.onload = () => {
        if (!window.pdfjsLib) {
          reject(new Error("The PDF reader did not initialise."));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      script.onerror = () =>
        reject(
          new Error(
            "The PDF reader could not load. Check your connection and retry.",
          ),
        );
      document.head.appendChild(script);
    }).catch((error) => { pdfJsPromise = null; throw error; });
  }
  return pdfJsPromise;
}

function xmlToTexts(xml) {
  // Decode entities only after identifying XML text nodes. Decoding the whole
  // XML first lets a literal </a:t> in document text truncate extraction.
  const decode = (value) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name) => {
    if (name[0] === "#") {
      const point = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "\uFFFD";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name.toLowerCase()];
  });
  return [...xml.matchAll(/<(?:a|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|w):t>/g)]
    .map((match) => normaliseText(decode(match[1])))
    .filter(Boolean);
}

async function extractDocx(zip) {
  const files = Object.keys(zip.files).filter((name) =>
    /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name),
  );
  let texts = [];
  for (const name of files) {
    const xml = await zip.file(name).async("string");
    texts = texts.concat(xmlToTexts(xml));
  }
  return {
    kind: "Word Document",
    units: files.length,
    unitLabel: "document sections",
    texts,
  };
}

async function extractPptx(zip) {
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(
      (first, second) =>
        Number(first.match(/slide(\d+)/)?.[1] || 0) -
        Number(second.match(/slide(\d+)/)?.[1] || 0),
    );

  const texts = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async("string");
    const slideTexts = xmlToTexts(xml);
    if (slideTexts.length) {
      texts.push(
        `Slide ${name.match(/slide(\d+)/)?.[1] || ""}: ${slideTexts.join(" | ")}`,
      );
    }
  }
  return {
    kind: "PowerPoint Presentation",
    units: slideNames.length,
    unitLabel: "slides",
    texts,
  };
}

async function extractPdf(file) {
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pageCap = Math.min(document.numPages, 40);
  const texts = [];

  for (let index = 1; index <= pageCap; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const line = normaliseText(content.items.map((item) => item.str).join(" "));
    if (line) texts.push(`Page ${index}: ${line}`);
  }

  const result = {
    kind: "PDF Document",
    units: document.numPages,
    unitLabel: "pages",
    texts,
    pdfTruncated: document.numPages > pageCap,
    pdfScanned: texts.join("").length < document.numPages * 8,
  };
  await document.destroy();
  return result;
}

function buildChecks({ file, kind, units, texts, languages }) {
  const words = texts.join(" ").split(/\s+/).filter(Boolean).length;
  const longSegments = texts.filter((text) => text.length > 160).length;
  const checks = [
    "File type recognised",
    `${kind} structure detected`,
    `${units} ${kind === "PowerPoint Presentation" ? "slides" : kind === "PDF Document" ? "pages" : "sections"} scanned`,
    `${languages.length} target language${languages.length === 1 ? "" : "s"} selected`,
  ];

  if (kind !== "PDF Document") {
    checks.push("Review-ready output names prepared");
  }
  if (longSegments) {
    checks.push(
      `${longSegments} long text segment${longSegments === 1 ? "" : "s"} may need fit review`,
    );
  }
  if (words > 1200) {
    checks.push("Large document: review in sections for a cleaner QA pass");
  }
  if (file.size > 20 * 1024 * 1024) {
    checks.push("Large file: browser analysis may take longer");
  }
  return { words, checks };
}

function makeOutputs(fileName, languages) {
  if (/\.pdf$/i.test(fileName)) return [];
  const base = fileName.replace(/\.(pptx|docx)$/i, "");
  const extension = fileName.toLowerCase().endsWith(".docx") ? "docx" : "pptx";
  return languages.map(
    (language) => `${base}_${({ Spanish: "ES", French: "FR", German: "DE", Arabic: "AR" })[language] || language.replace(/[^a-z0-9-]/gi, "_")}.${extension}`,
  );
}

function sampleReport(languages) {
  return {
    fileName: "FormatFlow_Sample_Deck.pptx",
    fileSize: "1.76 MB",
    kind: "PowerPoint Presentation",
    docType: "PowerPoint Presentation",
    units: 18,
    unitLabel: "slides",
    words: 946,
    languages,
    outputs: makeOutputs("FormatFlow_Sample_Deck.pptx", languages),
    checks: [
      "Slide structure and reading order detected",
      "Two dense text boxes need fit review",
      "Master styles are used consistently",
      "Review-ready output names prepared",
    ],
    preview:
      "Slide 1: FormatFlow Studio | Product overview\n\nSlide 2: Translate the document. Keep the design.\n\nSlide 3: Local processing, glossary controls and review-first overflow.\n\nSlide 4: Three steps from source to signed-off.",
  };
}

function renderAnalysis(report) {
  resultGrid.innerHTML = `
    <div class="result-card">
      <h4>Detected file</h4>
      <p>${escapeHtml(report.fileName)}<br>${escapeHtml(report.fileSize)}</p>
    </div>
    <div class="result-card">
      <h4>Structure</h4>
      <p>${escapeHtml(report.kind)}<br>${report.units} ${escapeHtml(report.unitLabel)} · ${report.words} words</p>
    </div>
    <div class="result-card">
      <h4>Layout risks</h4>
      <p>${report.checks.filter((check) => /fit|large|dense|risk/i.test(check)).length || 0} items flagged for review</p>
    </div>
    <div class="result-card">
      <h4>Planned outputs</h4>
      <p>${report.outputs.length ? `${report.outputs.map(escapeHtml).join("<br>")}<br>Export files in FormatFlow Studio.` : "PDF analysis and QA report only"}</p>
    </div>`;

  qaList.innerHTML = report.checks
    .map((item) => `<div>${escapeHtml(item)}</div>`)
    .join("");
  textPreview.textContent =
    report.preview ||
    "No extractable text was found. The file may contain scanned content or unsupported objects.";
  downloadReport.disabled = false;
  syncPreviewControl();
  setProgress(100);
}

function downloadHtmlReport(report) {
  const html = `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>FormatFlow review report</title>
        <style>
          body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.55;color:#111}
          h1{font-size:32px}.card{border:1px solid #ddd;border-radius:16px;padding:18px;margin:14px 0}
          pre{white-space:pre-wrap;background:#f6f8fa;padding:16px;border-radius:12px}
        </style>
      </head>
      <body>
        <h1>FormatFlow review report</h1>
        <div class="card">
          <strong>File:</strong> ${escapeHtml(report.fileName)}<br>
          <strong>Type:</strong> ${escapeHtml(report.kind)}<br>
          <strong>Size:</strong> ${escapeHtml(report.fileSize)}<br>
          <strong>Structure:</strong> ${report.units} ${escapeHtml(report.unitLabel)}<br>
          <strong>Words extracted:</strong> ${report.words}
        </div>
        <div class="card">
          <h2>Target languages</h2>
          <p>${escapeHtml(report.languages.join(", "))}</p>
          <h2>Planned outputs</h2>
          <ul>${report.outputs.length ? report.outputs.map((output) => `<li>${escapeHtml(output)}</li>`).join("") : "<li>PDF analysis and QA only today.</li>"}</ul>
        </div>
        <div class="card">
          <h2>QA checks</h2>
          <ul>${report.checks.map((check) => `<li>${escapeHtml(check)}</li>`).join("")}</ul>
        </div>
        <div class="card">
          <h2>Extracted text preview</h2>
          <pre>${escapeHtml(report.preview)}</pre>
        </div>
        <p>Generated locally in the browser by the FormatFlow online file tester.</p>
      </body>
    </html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.fileName.replace(/\.(pptx|docx|pdf)$/i, "")}_FormatFlow_Report.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

runDemo?.addEventListener("click", async () => {
  let version;
  try {
    if (!selectedFile) {
      demoStatusTitle.textContent = "Choose a file first";
      demoStatusText.textContent =
        "Drop in a PPTX, DOCX or PDF file, or use the sample deck.";
      return;
    }

    const languages = selectedLanguages();
    if (!languages.length) {
      demoStatusTitle.textContent = "Choose at least one language";
      demoStatusText.textContent =
        "Select a target language before analysing the file.";
      return;
    }

    const file = selectedFile;
    clearReport();
    version = operationVersion;

    runDemo.disabled = true;
    downloadReport.disabled = true;
    translatePreview.disabled = true;
    setProgress(24);
    demoStatusTitle.textContent = "Reading the file locally";
    demoStatusText.textContent =
      "FormatFlow is opening the document in this browser.";

    if (file.sample) {
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      if (version !== operationVersion) return;
      setProgress(64);
      demoStatusTitle.textContent = "Checking structure and layout";
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      if (version !== operationVersion) return;
      lastReport = sampleReport(languages);
      demoStatusTitle.textContent = "Sample analysis complete";
      demoStatusText.textContent =
        "The review report is ready to inspect or download.";
      renderAnalysis(lastReport);
      track("Tester Sample Analysed");
      return;
    }

    const lower = file.name.toLowerCase();
    let extracted;

    if (lower.endsWith(".pdf")) {
      setProgress(44);
      demoStatusTitle.textContent = "Extracting PDF text and structure";
      extracted = await extractPdf(file);
    } else {
      const JSZip = await loadJSZip();
      if (version !== operationVersion) return;
      const zip = await JSZip.loadAsync(file);
      if (version !== operationVersion) return;
      setProgress(48);
      demoStatusTitle.textContent = "Extracting document structure";
      extracted = lower.endsWith(".docx")
        ? await extractDocx(zip)
        : await extractPptx(zip);
    }
    if (version !== operationVersion) return;
    if (!extracted.units) throw new Error("This file does not contain the expected document structure. Check its format and try again.");

    setProgress(76);
    demoStatusTitle.textContent = "Running layout and QA checks";
    const docType = $("#docType").value;
    const finalDocType =
      docType === "Auto-detect" ? extracted.kind : docType;
    const checkResult = buildChecks({
      file,
      kind: extracted.kind,
      units: extracted.units,
      texts: extracted.texts,
      languages,
    });

    if (lower.endsWith(".pdf")) {
      if (extracted.pdfScanned && checkResult.words < 20) {
        checkResult.checks.push(
          "Low text layer: this PDF may be scanned; OCR is not supported yet",
        );
      }
      if (extracted.pdfTruncated) {
        checkResult.checks.push(
          "Large PDF: this preview analysed the first 40 pages",
        );
      }
      checkResult.checks.push(
        "PDF translation is on the roadmap; this report covers analysis and QA",
      );
    }

    const outputs = makeOutputs(file.name, languages);
    const preview = extracted.texts
      .slice(0, 30)
      .join("\n\n")
      .slice(0, 4500);

    lastReport = {
      fileName: file.name,
      fileSize: readableSize(file.size),
      kind: extracted.kind,
      docType: finalDocType,
      units: extracted.units,
      unitLabel: extracted.unitLabel,
      words: checkResult.words,
      languages,
      outputs,
      checks: checkResult.checks,
      preview,
    };

    demoStatusTitle.textContent = "File analysis complete";
    demoStatusText.textContent =
      "The document structure, layout risks and review pack are ready.";
    renderAnalysis(lastReport);
    track("Tester Analyse", { type: extracted.kind });
  } catch (error) {
    if (version !== operationVersion) return;
    console.error(error);
    demoStatusTitle.textContent = "Analysis could not finish";
    demoStatusText.textContent =
      error.message || "The file could not be analysed in this browser.";
    setProgress(0);
  } finally {
    if (version === operationVersion) runDemo.disabled = false;
  }
});

downloadReport?.addEventListener("click", () => {
  if (!lastReport) return;
  downloadHtmlReport(lastReport);
  track("Report Download");
});

function renderTranslations(data) {
  const translations = (data.translations || [])
    .map(
      (translation) => `
        <div class="result-card">
          <h4>${escapeHtml(translation.language || "Translation")}</h4>
          <p>${escapeHtml(translation.translatedPreview || "").slice(0, 1200)}</p>
        </div>`,
    )
    .join("");
  translateResult.innerHTML = `
    <p class="privacy-note">${escapeHtml(data.summary || "Translation preview generated. Review it before client use.")}</p>
    <div class="result-grid">${translations}</div>`;
}

translatePreview?.addEventListener("click", async () => {
  if (!lastReport?.preview || !previewConsent?.checked || previewController) return;

  const report = lastReport;
  const version = operationVersion;
  const controller = new AbortController();
  previewController = controller;
  const timeout = window.setTimeout(() => controller.abort(), 35_000);

  const originalLabel = translatePreview.textContent;
  translatePreview.disabled = true;
  translatePreview.textContent = "Translating…";
  translateResult.innerHTML =
    '<p class="privacy-note">Contacting the FormatFlow translation preview service…</p>';

  try {
    const response = await fetch(`${API_BASE}/api/translate-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: report.fileName,
        documentType: report.docType || report.kind,
        toneNotes: $("#toneNotes").value,
        sourceText: report.preview.slice(0, 4000),
        targetLanguages: report.languages,
        model: $("#translateModel").value,
      }),
      signal: controller.signal,
    });

    const data = await response
      .json()
      .catch(() => ({ error: "Unexpected server response." }));
    if (version !== operationVersion) return;

    if (
      response.status === 503 || (response.status === 500 && /OPENAI_API_KEY/i.test(data.error || ""))
    ) {
      translateResult.innerHTML =
        '<p class="privacy-note">Online translation preview is not enabled on this deployment. The full workflow is available in FormatFlow Studio for Windows.</p>';
    } else if (response.status === 429) {
      translateResult.innerHTML =
        '<p class="privacy-note">The preview rate limit has been reached. Try again later, or use the Windows app.</p>';
    } else if (!response.ok) {
      translateResult.innerHTML = `<p class="privacy-note">Preview failed: ${escapeHtml(data.error || `HTTP ${response.status}`)}.</p>`;
    } else {
      renderTranslations(data);
    }
  } catch (error) {
    if (version !== operationVersion) return;
    translateResult.innerHTML = error.name === "AbortError"
      ? '<p class="privacy-note">The preview timed out. Try again with a shorter document.</p>'
      : `<p class="privacy-note">Could not reach the preview service: ${escapeHtml(error.message || "network error")}.</p>`;
  } finally {
    window.clearTimeout(timeout);
    if (previewController === controller) {
      translatePreview.textContent = originalLabel;
      previewController = null;
    }
    syncPreviewControl();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

