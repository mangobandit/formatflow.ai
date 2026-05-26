import { asArray, baseWarnings, documentLabel, handleOptions, requireMethod, sendJson } from "./_shared.js";

export default function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;

  const body = req.body || {};
  const documentType = documentLabel(body.document_type || body.documentType || "Unknown");
  const targetLanguages = asArray(body.target_languages || body.targetLanguages);
  const extractedWordCount = Number(body.extracted_word_count || body.extractedWordCount || 0);
  const pageOrSlideCount = Number(body.page_or_slide_count || body.pageOrSlideCount || 0);
  const longTextSegments = Number(body.long_text_segments || body.longTextSegments || 0);
  const containsTables = Boolean(body.contains_tables || body.containsTables);
  const containsImages = Boolean(body.contains_images || body.containsImages);
  const containsBrandTerms = Boolean(body.contains_brand_terms || body.containsBrandTerms);
  const reviewerNotes = body.reviewer_notes || body.reviewerNotes || "";

  if (!targetLanguages.length) {
    sendJson(res, 400, { error: "At least one target language is required." });
    return;
  }

  const qaChecks = [
    "Confirm every exported file opens correctly before delivery.",
    "Check title slides, headings, section dividers and final call-to-action pages first.",
    "Review text boxes, tables, footers, headers and chart labels for overflow or clipping.",
    "Check terminology consistency against the glossary or client-approved wording.",
    "Confirm output file names clearly show project, language and review status.",
  ];

  if (/powerpoint/i.test(documentType)) qaChecks.push("Compare slide count and slide order against the source deck.");
  if (/word/i.test(documentType)) qaChecks.push("Check table of contents, page breaks, headers, footers and numbered lists.");
  if (/pdf/i.test(documentType)) qaChecks.push("Check whether OCR or flattened text affected translation quality.");
  if (containsTables) qaChecks.push("Review tables manually because translated text may change column width and row height.");
  if (containsImages) qaChecks.push("Check image captions, embedded labels and non-editable text inside graphics.");
  if (containsBrandTerms) qaChecks.push("Confirm brand names, product names and protected terms were not translated incorrectly.");

  const highRiskItems = [];
  if (longTextSegments > 0) highRiskItems.push(`${longTextSegments} long text segment${longTextSegments === 1 ? "" : "s"} may need manual fit checks.`);
  if (pageOrSlideCount > 40) highRiskItems.push("Large document: review in sections to avoid missing formatting issues.");
  if (extractedWordCount > 5000) highRiskItems.push("High word count: use a glossary and staged review rather than one final pass.");
  if (targetLanguages.some((lang) => /german|french|spanish|arabic/i.test(lang))) highRiskItems.push("Some selected languages may expand text length or require extra layout review.");
  if (!highRiskItems.length) highRiskItems.push("No major risk flags supplied. Still complete a manual review before delivery.");

  const reviewerQuestions = [
    "Are the key terms translated exactly as the client expects?",
    "Do any translated headings feel too long or visually unbalanced?",
    "Are dates, prices, legal wording, product names and technical terms correct?",
    "Are all target-language files ready to send, or do any need layout repair?",
  ];

  if (reviewerNotes) reviewerQuestions.push(`User note to verify: ${reviewerNotes}`);

  sendJson(res, 200, {
    summary: `${documentType} QA report for ${targetLanguages.join(", ")}. ${pageOrSlideCount ? `${pageOrSlideCount} pages/slides supplied.` : "Page or slide count not supplied."}`,
    qa_checks: qaChecks,
    high_risk_items: highRiskItems,
    reviewer_questions: reviewerQuestions,
    delivery_checklist: [
      "Open every exported file.",
      "Check file names and language labels.",
      "Review layout-sensitive pages or slides.",
      "Confirm glossary and brand terms.",
      "Export final client-ready versions only after reviewer approval.",
    ],
    warnings: baseWarnings(),
  });
}
