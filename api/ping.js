import { guard, sendJson } from "./_shared.js";

export default async function handler(req, res) {
  if (!(await guard(req, res, { method: "GET", limit: 120, windowMs: 60_000 }))) return;

  sendJson(res, 200, {
    status: "ok",
    service: "formatflow-action-api",
    endpoint: "ping",
    note: "This endpoint exists to confirm the latest Vercel deployment includes API functions.",
  }, req);
}
