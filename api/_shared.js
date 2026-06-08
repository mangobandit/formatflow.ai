// Shared helpers for all FormatFlow serverless functions.
const DEFAULT_ORIGINS = [
  "https://formatflow.ai",
  "https://www.formatflow.ai",
  "https://formatflow-ai.vercel.app",
];

function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}

export function resolveOrigin(req) {
  const origin = req.headers?.origin || "";
  if (!origin) return null;
  return allowedOrigins().includes(origin) ? origin : null;
}

export function requestId(req) {
  const incoming = req?.headers?.["x-request-id"];
  if (typeof incoming === "string" && incoming.length && incoming.length <= 200) return incoming;
  try {
    return globalThis.crypto?.randomUUID?.() || `ff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return `ff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function sendJson(res, statusCode, payload, req) {
  const origin = req ? resolveOrigin(req) : null;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req) res.setHeader("X-Request-Id", requestId(req));
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
  res.statusCode = statusCode;
  if (typeof res.json === "function") {
    res.json(payload);
  } else {
    res.end(JSON.stringify(payload));
  }
}

export function enforceBodyLimit(req, res, maxBytes = 256 * 1024) {
  const len = Number(req.headers?.["content-length"] || 0);
  if (len > maxBytes) {
    sendJson(res, 413, { error: `Payload too large. Max ${Math.floor(maxBytes / 1024)} KB.` }, req);
    return false;
  }
  return true;
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true }, req);
    return true;
  }
  return false;
}

export function requireMethod(req, res, method) {
  if (req.method !== method) {
    sendJson(res, 405, { error: `Method ${req.method} not allowed. Use ${method}.` }, req);
    return false;
  }
  return true;
}

const buckets = new Map();

export function clientKey(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export function rateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (entry.count >= limit) {
    return { ok: false, retryAfterMs: entry.reset - now };
  }
  entry.count += 1;
  return { ok: true, remaining: limit - entry.count };
}

function upstashConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function rateLimitUpstash(key, { limit, windowMs }) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/pipeline`;
  const redisKey = `ratelimit:${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(windowMs), "NX"],
      ["PTTL", redisKey],
    ]),
  });
  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
  const results = await res.json();
  const count = Number(results?.[0]?.result ?? 0);
  const ttl = Number(results?.[2]?.result ?? windowMs);
  if (count > limit) {
    return { ok: false, retryAfterMs: ttl > 0 ? ttl : windowMs };
  }
  return { ok: true, remaining: Math.max(0, limit - count) };
}

export async function rateLimitDistributed(key, opts) {
  if (upstashConfigured()) {
    try {
      return await rateLimitUpstash(key, opts);
    } catch {
      return rateLimit(key, opts);
    }
  }
  return rateLimit(key, opts);
}

export async function guard(req, res, { method = "POST", limit = 30, windowMs = 60_000, requireKnownOrigin = false, maxBytes = 0 } = {}) {
  if (handleOptions(req, res)) return false;
  if (!requireMethod(req, res, method)) return false;
  if (maxBytes && !enforceBodyLimit(req, res, maxBytes)) return false;
  if (requireKnownOrigin && req.headers?.origin && !resolveOrigin(req)) {
    sendJson(res, 403, { error: "Origin not allowed." }, req);
    return false;
  }
  const rl = await rateLimitDistributed(clientKey(req), { limit, windowMs });
  if (!rl.ok) {
    res.setHeader("Retry-After", Math.ceil((rl.retryAfterMs || windowMs) / 1000));
    sendJson(res, 429, { error: "Too many requests. Please slow down and try again shortly." }, req);
    return false;
  }
  return true;
}

export function cleanString(value, maxLength = 8000) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
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
