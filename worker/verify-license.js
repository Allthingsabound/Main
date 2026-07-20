// Cloudflare Worker: verifies a Gumroad license key for the assessment unlock.
// The browser can't call Gumroad's verify endpoint directly (no CORS), so this
// Worker sits in the middle: page -> Worker -> Gumroad -> Worker -> page.

const GUMROAD_PRODUCT_ID = "nsQGuvUxFddQzBDCUBdYog==";

const ALLOWED_ORIGINS = [
  "https://allthingsabound.com",
  "https://www.allthingsabound.com",
  // Local development preview
  "http://localhost:4599",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const headers = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return json({ valid: false, error: "method_not_allowed" }, 405, headers);
    }

    let licenseKey = "";
    try {
      const body = await request.json();
      licenseKey = String(body.license_key || "").trim();
    } catch (e) {
      return json({ valid: false, error: "bad_request" }, 400, headers);
    }
    if (!licenseKey || licenseKey.length > 100) {
      return json({ valid: false, error: "missing_key" }, 400, headers);
    }

    const params = new URLSearchParams();
    params.set("product_id", GUMROAD_PRODUCT_ID);
    params.set("license_key", licenseKey);
    // Verification checks shouldn't consume the key's use count — buyers may
    // unlock on several devices.
    params.set("increment_uses_count", "false");

    let data;
    try {
      const res = await fetch("https://api.gumroad.com/v2/licenses/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      data = await res.json();
    } catch (e) {
      return json({ valid: false, error: "gumroad_unreachable" }, 502, headers);
    }

    const purchase = data.purchase || {};
    const valid = data.success === true && !purchase.refunded && !purchase.chargebacked;
    return json({ valid }, 200, headers);
  },
};
