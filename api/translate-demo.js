const OPENAI_URL = "https://api.openai.com/v1/responses";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function cleanString(value, maxLength = 8000) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed. Use POST." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 500, {
      error: "OPENAI_API_KEY is not configured.",
      nextStep: "Add OPENAI_API_KEY in Vercel Project Settings > Environment Variables, then redeploy.",
    });
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
      return sendJson(res, 400, { error: "Not enough extracted text to translate. Try a file with selectable text." });
    }

    if (!targetLanguages.length) {
      return sendJson(res, 400, { error: "Select at least one target language." });
    }

    const prompt = `You are FormatFlow, a careful document translation preview assistant. Use only the supplied document text. Do not invent missing sections. Return only valid JSON matching this structure: {"summary":"...","translations":[{"language":"...","translatedPreview":"...","notes":["..."]}],"qaChecks":["..."],"nextSteps":["..."]}.

File name: ${fileName}
Document type: ${documentType}
Target languages: ${targetLanguages.join(", ")}
Tone and glossary notes: ${toneNotes}

Source text preview:
${sourceText}`;

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        input: prompt,
        temperature: 0.2,
        max_output_tokens: 3000,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return sendJson(res, response.status, {
        error: "OpenAI translation preview failed.",
        details: data.error?.message || "Unknown API error.",
      });
    }

    const text = extractText(data);
    const parsed = safeJsonParse(text);

    if (!parsed) {
      return sendJson(res, 200, {
        summary: "Translation preview generated, but the response was not structured JSON.",
        translations: targetLanguages.map((language) => ({ language, translatedPreview: text.slice(0, 1200), notes: ["Review the preview before using it in a client document."] })),
        qaChecks: ["Preview generated from extracted text", "Verify terminology and formatting before final use"],
        nextSteps: ["Use the Windows app for full DOCX/PPTX export", "Review formatting after translation"],
      });
    }

    return sendJson(res, 200, parsed);
  } catch (error) {
    return sendJson(res, 500, {
      error: "Translation preview failed.",
      details: error.message || "Unknown server error.",
    });
  }
};
