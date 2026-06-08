import { asArray, baseWarnings, documentLabel, guard, sendJson } from "./_shared.js";

function outputExamples(documentType, targetLanguages) {
  const extension = /word/i.test(documentType) ? "docx" : /pdf/i.test(documentType) ? "pdf" : "pptx";
  return targetLanguages.map((language) => `ProjectName_${language.replace(/\s+/g, "")}_ReviewReady.${extension}`);
}

export default async function handler(req, res) {
  if (!(await guard(req, res, { method: "POST", limit: 60, windowMs: 60_000 }))) return;

  const body = req.body || {};
  const documentType = documentLabel(body.document_type || body.documentType || "Unknown");
  const sourceLanguage = body.source_language || body.sourceLanguage || "Source language not specified";
  const targetLanguages = asArray(body.target_languages || body.targetLanguages);
  const fileCount = Number(body.file_count || body.fileCount || 1);
  const pageOrSlideCount = Number(body.page_or_slide_count || body.pageOrSlideCount || 0);
  const audience = body.audience || "Business reviewers";
  const tone = body.tone || "Professional, clear and review-ready";
  const glossaryTerms = asArray(body.glossary_terms || body.glossaryTerms);
  const knownRisks = asArray(body.known_risks || body.knownRisks);

  if (!targetLanguages.length) {
    sendJson(res, 400, { error: "At least one target language is required." }, req);
    return;
  }

  const layoutRisks = [];
  if (/powerpoint/i.test(documentType)) {
    layoutRisks.push("Text expansion may overflow slide text boxes, especially in German, French and Spanish.");
    layoutRisks.push("Charts, speaker notes, grouped shapes and master layouts should be checked after translation.");
  } else if (/word/i.test(documentType)) {
    layoutRisks.push("Tables, headers, footers, page breaks and numbered lists should be checked after translation.");
  } else if (/pdf/i.test(documentType)) {
    layoutRisks.push("PDFs may contain scanned or flattened content that requires OCR before translation.");
    layoutRisks.push("Editable source files are preferred when layout preservation matters.");
  } else {
    layoutRisks.push("Confirm file type and editability before promising a formatted translation workflow.");
  }

  if (pageOrSlideCount > 40) layoutRisks.push("Large files should be reviewed in sections rather than as one final pass.");
  if (knownRisks.length) layoutRisks.push(...knownRisks.map((risk) => `User-noted risk: ${risk}`));

  const glossaryPlan = glossaryTerms.length
    ? glossaryTerms.map((term) => `Protect or review term: ${term}`)
    : [
        "Create a short glossary before translation for brand names, product names, technical terms and phrases that should not be translated.",
        "Ask reviewers to check repeated terms first because consistency errors compound across a batch.",
      ];

  sendJson(res, 200, {
    summary: `${fileCount} ${documentType}${fileCount === 1 ? "" : "s"} from ${sourceLanguage} to ${targetLanguages.join(", ")} for ${audience}.`,
    recommended_workflow: [
      "Confirm the document type, audience, target languages and delivery deadline.",
      "Create or import a glossary for brand, product and technical terms.",
      "Run translation with layout preservation and text-fit awareness enabled.",
      "Check high-risk areas: headings, tables, charts, grouped objects, long text segments and footers.",
      "Export one file per target language with a review-ready naming convention.",
      "Send reviewers the QA checklist and ask them to focus on terminology, layout and client-sensitive wording.",
    ],
    layout_risks: layoutRisks,
    glossary_plan: glossaryPlan,
    output_naming: outputExamples(documentType, targetLanguages),
    reviewer_handoff: [
      `Tone target: ${tone}.`,
      "Review title slides, section headings and final calls to action first.",
      "Check any text that became longer after translation.",
      "Confirm names, dates, prices, legal wording and technical terms manually.",
    ],
    warnings: baseWarnings(),
  }, req);
}
