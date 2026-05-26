import { handleOptions, requireMethod, sendJson } from "./_shared.js";

export default function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requireMethod(req, res, "GET")) return;

  sendJson(res, 200, {
    status: "ok",
    service: "formatflow-action-api",
    endpoint: "ping",
    note: "This endpoint exists to confirm the latest Vercel deployment includes API functions.",
  });
}
