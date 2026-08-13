/**
 * 358BoardAI - BOAT RACE Official Data Relay
 * Cloudflare Worker
 * Version 1.0.0
 */

const ALLOWED_ORIGINS = new Set([
  "https://tripleseven1026-cell.github.io"
]);

const BOATRACE_ORIGIN = "https://www.boatrace.jp";
const ALLOWED_KINDS = new Set(["racelist", "beforeinfo"]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://tripleseven1026-cell.github.io";

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin)
    }
  });
}

function validateParams(url) {
  const kind = url.searchParams.get("kind") || "";
  const hd = url.searchParams.get("hd") || "";
  const jcd = url.searchParams.get("jcd") || "";
  const rno = url.searchParams.get("rno") || "";

  if (!ALLOWED_KINDS.has(kind)) {
    return { ok: false, error: "kind must be racelist or beforeinfo." };
  }

  if (!/^\d{8}$/.test(hd)) {
    return { ok: false, error: "hd must be YYYYMMDD." };
  }

  if (!/^\d{2}$/.test(jcd)) {
    return { ok: false, error: "jcd must be 01-24." };
  }

  const venueCode = Number(jcd);
  if (!Number.isInteger(venueCode) || venueCode < 1 || venueCode > 24) {
    return { ok: false, error: "jcd must be 01-24." };
  }

  const raceNumber = Number(rno);
  if (!Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 12) {
    return { ok: false, error: "rno must be 1-12." };
  }

  return {
    ok: true,
    kind,
    hd,
    jcd,
    rno: String(raceNumber)
  };
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        { ok: false, error: "Method not allowed." },
        405,
        origin
      );
    }

    if (requestUrl.pathname === "/" || requestUrl.pathname === "/health") {
      return jsonResponse(
        {
          ok: true,
          service: "358BoardAI BOAT RACE relay",
          version: "1.0.0"
        },
        200,
        origin
      );
    }

    if (requestUrl.pathname !== "/race") {
      return jsonResponse(
        { ok: false, error: "Not found." },
        404,
        origin
      );
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse(
        { ok: false, error: "Origin not allowed." },
        403,
        origin
      );
    }

    const params = validateParams(requestUrl);

    if (!params.ok) {
      return jsonResponse(
        { ok: false, error: params.error },
        400,
        origin
      );
    }

    const officialUrl =
      `${BOATRACE_ORIGIN}/owpc/pc/race/${params.kind}` +
      `?hd=${params.hd}&jcd=${params.jcd}&rno=${params.rno}`;

    try {
      const ttl = params.kind === "beforeinfo" ? 30 : 300;

      const upstream = await fetch(officialUrl, {
        method: "GET",
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "358BoardAI/1.0"
        },
        cf: {
          cacheEverything: true,
          cacheTtl: ttl
        }
      });

      if (!upstream.ok) {
        return jsonResponse(
          {
            ok: false,
            error: `BOAT RACE returned HTTP ${upstream.status}.`,
            upstreamStatus: upstream.status
          },
          502,
          origin
        );
      }

      const html = await upstream.text();

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control":
            params.kind === "beforeinfo"
              ? "public, max-age=30"
              : "public, max-age=300",
          "X-358BoardAI-Source": "boatrace.jp",
          ...corsHeaders(origin)
        }
      });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: "Failed to fetch BOAT RACE official data."
        },
        502,
        origin
      );
    }
  }
};
