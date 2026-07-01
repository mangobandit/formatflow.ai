// Shared OpenAI Responses API client for FormatFlow serverless functions.
const OPENAI_URL = "https://api.openai.com/v1/responses";

export function openAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function openAIModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export function openAITimeoutMs() {
  const value = Number(process.env.OPENAI_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 25_000;
}

export function openAIMaxOutputTokens(fallback = 3000) {
  const value = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function extractText(output) {
  if (typeof output.output_text === "string") return output.output_text;
  const parts = [];
  for (const item of output.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n");
}

// Calls the Responses API with a strict JSON schema, so a successful reply is
// guaranteed to be valid JSON matching `schema` — no regex extraction needed.
// Throws AbortError on timeout; callers map that to a 504.
export async function openAIJson({ prompt, schemaName, schema, maxOutputTokens, temperature = 0.2 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), openAITimeoutMs());
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: openAIModel(),
        input: prompt,
        temperature,
        max_output_tokens: maxOutputTokens || openAIMaxOutputTokens(),
        text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json();
  if (!response.ok) {
    return { ok: false, status: response.status, error: data.error?.message || "Unknown API error." };
  }
  try {
    return { ok: true, json: JSON.parse(extractText(data)) };
  } catch {
    return { ok: false, status: 502, error: "The model returned output that was not valid JSON." };
  }
}
