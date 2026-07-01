import { cleanString, guard, sendJson } from "./_shared.js";
import { openAIConfigured, openAIJson } from "./_openai.js";

// Free round-trip caps — the Windows app handles anything bigger.
export const MAX_SEGMENTS = 150;
export const MAX_TOTAL_CHARS = 9000;
export const MAX_SEGMENT_CHARS = 600;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    translations: { type: "array", items: { type: "string" } },
  },
  required: ["translations"],
};

export default async function handler(req, res) {
  if (!(await guard(req, res, { method: "POST", limit: 6, windowMs: 10 * 60_000, requireKnownOrigin: true, maxBytes: 128 * 1024 }))) {
    return;
  }

  if (!openAIConfigured()) {
    return sendJson(res, 500, {
      error: "OPENAI_API_KEY is not configured.",
      nextStep: "Add OPENAI_API_KEY in Vercel Project Settings > Environment Variables, then redeploy.",
    }, req);
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const fileName = cleanString(body.fileName, 240) || "Uploaded document";
    const documentType = cleanString(body.documentType, 120) || "Business document";
    const toneNotes = cleanString(body.toneNotes, 1200) || "Use a clear business tone.";
    const targetLanguage = cleanString(body.targetLanguage, 40);

    if (!targetLanguage) {
      return sendJson(res, 400, { error: "Select a target language." }, req);
    }

    const rawSegments = Array.isArray(body.segments) ? body.segments : [];
    if (!rawSegments.length) {
      return sendJson(res, 400, { error: "No text segments supplied." }, req);
    }
    if (rawSegments.length > MAX_SEGMENTS) {
      return sendJson(res, 413, { error: `Too many text segments for the free online translation (max ${MAX_SEGMENTS}). Use FormatFlow Studio for Windows for full files.` }, req);
    }

    const segments = rawSegments.map((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""));
    if (segments.some((segment) => !segment || segment.length > MAX_SEGMENT_CHARS)) {
      return sendJson(res, 400, { error: `Each segment must be non-empty text of at most ${MAX_SEGMENT_CHARS} characters.` }, req);
    }
    const totalChars = segments.reduce((sum, segment) => sum + segment.length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return sendJson(res, 413, { error: `Too much text for the free online translation (max ${MAX_TOTAL_CHARS} characters). Use FormatFlow Studio for Windows for full files.` }, req);
    }

    const prompt = `You are FormatFlow, a careful document translation engine. Translate every segment in the JSON array below from its source language into ${targetLanguage}.

Rules:
- Return the same number of segments, in the same order — segment i of the output is the translation of segment i of the input.
- Never merge, split, drop or reorder segments. A segment may be a fragment of a sentence that continues in the next segment; translate it so the sequence still reads naturally.
- Keep numbers, URLs, email addresses, product names, brand names and placeholders unchanged.
- Prefer concise phrasing: the translation must fit the same layout space as the source.
- Do not add commentary or quotation marks that are not in the source.

File name: ${fileName}
Document type: ${documentType}
Tone and glossary notes: ${toneNotes}

Segments:
${JSON.stringify(segments)}`;

    const result = await openAIJson({
      prompt,
      schemaName: "segment_translations",
      schema: SCHEMA,
      maxOutputTokens: 8000,
    });

    if (!result.ok) {
      const status = result.status >= 400 && result.status < 600 ? result.status : 502;
      return sendJson(res, status, { error: "File translation failed.", details: result.error }, req);
    }

    let translations = (result.json.translations || []).map((value) => (typeof value === "string" ? value : ""));
    const notes = [];
    if (translations.length !== segments.length) {
      // Keep the client able to rebuild: unaligned runs fall back to source text.
      translations = translations.slice(0, segments.length);
      while (translations.length < segments.length) translations.push(segments[translations.length]);
      notes.push("Some segments could not be aligned by the model and were left in the source language.");
    }
    translations = translations.map((value, index) => (value.trim() ? value : segments[index]));

    return sendJson(res, 200, { targetLanguage, segmentCount: segments.length, translations, notes }, req);
  } catch (error) {
    if (error.name === "AbortError") {
      return sendJson(res, 504, { error: "File translation timed out. Try a smaller file." }, req);
    }
    return sendJson(res, 500, { error: "File translation failed.", details: error.message || "Unknown server error." }, req);
  }
}
