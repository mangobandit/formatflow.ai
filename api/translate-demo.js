import { cleanString, guard, sendJson } from "./_shared.js";
import { openAIConfigured, openAIJson } from "./_openai.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          language: { type: "string" },
          translatedPreview: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
        required: ["language", "translatedPreview", "notes"],
      },
    },
    qaChecks: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "translations", "qaChecks", "nextSteps"],
};

export default async function handler(req, res) {
  if (!(await guard(req, res, { method: "POST", limit: 8, windowMs: 10 * 60_000, requireKnownOrigin: true, maxBytes: 64 * 1024 }))) {
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
    const sourceText = cleanString(body.sourceText, 4000);
    const targetLanguages = Array.isArray(body.targetLanguages)
      ? body.targetLanguages.map((value) => cleanString(value, 40)).filter(Boolean).slice(0, 5)
      : [];

    if (!sourceText || sourceText.length < 20) {
      return sendJson(res, 400, { error: "Not enough extracted text to translate. Try a file with selectable text." }, req);
    }

    if (!targetLanguages.length) {
      return sendJson(res, 400, { error: "Select at least one target language." }, req);
    }

    const prompt = `You are FormatFlow, a careful document translation preview assistant. Use only the supplied document text. Do not invent missing sections. Produce one translation entry per target language, practical QA checks and next steps.

File name: ${fileName}
Document type: ${documentType}
Target languages: ${targetLanguages.join(", ")}
Tone and glossary notes: ${toneNotes}

Source text preview:
${sourceText}`;

    const result = await openAIJson({ prompt, schemaName: "translation_preview", schema: SCHEMA });

    if (!result.ok) {
      const status = result.status >= 400 && result.status < 600 ? result.status : 502;
      return sendJson(res, status, { error: "OpenAI translation preview failed.", details: result.error }, req);
    }

    return sendJson(res, 200, result.json, req);
  } catch (error) {
    if (error.name === "AbortError") {
      return sendJson(res, 504, { error: "Translation preview timed out. Try a shorter document." }, req);
    }
    return sendJson(res, 500, {
      error: "Translation preview failed.",
      details: error.message || "Unknown server error.",
    }, req);
  }
}
