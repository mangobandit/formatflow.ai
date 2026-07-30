const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function buildUpdateResponse(query = {}, env = process.env) {
  const version = String(env.FORMATFLOW_RELEASE_VERSION || "").trim();
  const url = String(env.FORMATFLOW_RELEASE_URL || "").trim();
  const signature = String(env.FORMATFLOW_RELEASE_SIGNATURE || "").trim();
  const currentVersion = String(query.current_version || query.currentVersion || "").trim();

  if (!SEMVER.test(version) || !isHttpsUrl(url) || signature.length < 32 || signature.length > 4096) {
    return null;
  }

  if (currentVersion && !isNewerVersion(version, currentVersion)) {
    return null;
  }

  const response = {
    version,
    url,
    signature,
    notes: String(env.FORMATFLOW_RELEASE_NOTES || "FormatFlow Studio update").trim().slice(0, 4000)
  };
  const publishDate = String(env.FORMATFLOW_RELEASE_PUB_DATE || "").trim();
  if (publishDate && !Number.isNaN(Date.parse(publishDate))) {
    response.pub_date = new Date(publishDate).toISOString();
  }
  return response;
}

export function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return true;

  for (let index = 0; index < 3; index += 1) {
    if (next.numbers[index] !== installed.numbers[index]) {
      return next.numbers[index] > installed.numbers[index];
    }
  }

  if (next.prerelease === installed.prerelease) return false;
  if (!next.prerelease) return true;
  if (!installed.prerelease) return false;
  return next.prerelease.localeCompare(installed.prerelease, undefined, { numeric: true }) > 0;
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const update = buildUpdateResponse(req.query || {});
  if (!update) {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify(update));
}

function parseVersion(value) {
  const match = String(value || "").trim().match(SEMVER);
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || ""
  };
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
