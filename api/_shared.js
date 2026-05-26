export function sendJson(res, statusCode, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.status(statusCode).json(payload);
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return true;
  }
  return false;
}

export function requireMethod(req, res, method) {
  if (req.method !== method) {
    sendJson(res, 405, { error: `Method ${req.method} not allowed. Use ${method}.` });
    return false;
  }
  return true;
}

export function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(/,|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function titleCase(value) {
  return String(value || "")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function documentLabel(documentType) {
  const value = titleCase(documentType || "Unknown");
  if (/ppt|powerpoint/i.test(value)) return "PowerPoint Presentation";
  if (/doc|word/i.test(value)) return "Word Document";
  if (/pdf/i.test(value)) return "PDF";
  if (/mixed/i.test(value)) return "Mixed Batch";
  return value || "Unknown Document";
}

export function baseWarnings() {
  return [
    "FormatFlow is decision-support for translation workflow and document QA. Review the final translated file before delivery.",
    "Verify legal, regulated, technical and brand-sensitive wording with a qualified reviewer.",
    "Layout risk checks are planning signals, not a guarantee that every slide, page or text box will remain perfect.",
  ];
}
