import { cleanString, guard, sendJson } from "./_shared.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";

// The client sends a menu KEY, never a raw model string, so a caller cannot
// point our API key at an arbitrary model. Each key resolves to an id here.
//
// "latest" is overridable via OPENAI_MODEL_LATEST: set it in Vercel to correct
// the id without a code change if the published name differs from the default.
export const MODEL_CHOICES = {
  fast: { label: "GPT-4o mini", id: () => process.env.OPENAI_MODEL || "gpt-4o-mini" },
  quality: { label: "GPT-4o", id: () => process.env.OPENAI_MODEL_QUALITY || "gpt-4o" },
  latest: { label: "ChatGPT 5.6", id: () => process.env.OPENAI_MODEL_LATEST || "gpt-5.6" },
};

export const DEFAULT_MODEL_KEY = "fast";

export function resolveModel(key) {
  const choice = MODEL_CHOICES[typeof key === "string" ? key.trim().toLowerCase() : ""];
  return (choice || MODEL_CHOICES[DEFAULT_MODEL_KEY]).id();
}

function extractText(output) {
  if (typeof output.output_text === "string") return output.output_text;
  const parts = [];
  for (const item of output.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }
}

export default async function handler(req, res) {
  if (!(await guard(req, res, { method: "POST", limit: 8, windowMs: 10 * 60_000, requireKnownOrigin: true, maxBytes: 64 * 1024 }))) {
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
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

    const prompt = `You are FormatFlow, a careful document translation preview assistant. Use only the supplied document text. Do not invent missing sections. Return only valid JSON matching this structure: {"summary":"...","translations":[{"language":"...","translatedPreview":"...","notes":["..."]}],"qaChecks":["..."],"nextSteps":["..."]}.

File name: ${fileName}
Document type: ${documentType}
Target languages: ${targetLanguages.join(", ")}
Tone and glossary notes: ${toneNotes}

Source text preview:
${sourceText}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    let response;
    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: resolveModel(body.model),
          input: prompt,
          temperature: 0.2,
          max_output_tokens: 3000,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json();

    if (!response.ok) {
      // An unknown model is a configuration problem, not a bad document, so say
      // which override fixes it rather than surfacing a generic API failure.
      if (data.error?.code === "model_not_found" || /does not exist|do not have access/i.test(data.error?.message || "")) {
        return sendJson(res, 502, {
          error: "That translation model is not available on this account.",
          details: data.error?.message || "The configured model id was rejected by OpenAI.",
          nextStep: "Set OPENAI_MODEL_LATEST (or OPENAI_MODEL / OPENAI_MODEL_QUALITY) in Vercel to a model id your account can use, then redeploy.",
        }, req);
      }
      return sendJson(res, response.status, {
        error: "OpenAI translation preview failed.",
        details: data.error?.message || "Unknown API error.",
      }, req);
    }

    const text = extractText(data);
    const parsed = safeJsonParse(text);

    if (!parsed) {
      return sendJson(res, 200, {
        summary: "Translation preview generated, but the response was not structured JSON.",
        translations: targetLanguages.map((language) => ({ language, translatedPreview: text.slice(0, 1200), notes: ["Review the preview before using it in a client document."] })),
        qaChecks: ["Preview generated from extracted text", "Verify terminology and formatting before final use"],
        nextSteps: ["Use the Windows app for full DOCX/PPTX export", "Review formatting after translation"],
      }, req);
    }

    return sendJson(res, 200, parsed, req);
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
