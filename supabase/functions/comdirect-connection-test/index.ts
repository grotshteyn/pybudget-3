// Issue #41 pre-deployment diagnostic only.
// Intentionally NOT wired into the frontend and NOT deployed.
// No database writes. No transaction ingestion. No durable credential storage.

const COMDIRECT_API = "https://api.comdirect.de";
const ALLOWED_PATHS = [
  /^\/oauth\/token$/,
  /^\/api\/session\/clients\/user\/v1\/sessions$/,
  /^\/api\/banking\/v1\/accounts$/,
  /^\/api\/banking\/v1\/accounts\/[^/]+\/transactions$/
];

type Credentials = {
  client_id: string;
  client_secret: string;
  access_number: string;
  pin: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function assertAllowed(url: URL, method: string) {
  if (url.origin !== COMDIRECT_API) throw new Error("provider_origin_blocked");
  if (!["GET", "POST", "DELETE"].includes(method)) throw new Error("provider_method_blocked");
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(url.pathname))) throw new Error("provider_endpoint_blocked");
}

function requireCredentials(body: Record<string, unknown>): Credentials {
  const names = ["client_id", "client_secret", "access_number", "pin"] as const;
  const out = {} as Credentials;
  for (const name of names) {
    const value = body[name];
    if (typeof value !== "string" || !value.trim()) throw new Error("missing_" + name);
    out[name] = value.trim();
  }
  return out;
}

function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  return { ok: false, stage: "preflight", error_code: message, credentials_retained: false, transactions_imported: 0 };
}

export { assertAllowed, requireCredentials, safeFailure };

// Deliberately disabled until the current comdirect auth/session request contract
// has been verified against official specification and reviewed before deployment.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error_code: "method_not_allowed" }, 405);
  try {
    const body = await req.json();
    requireCredentials(body);
    return json({
      ok: false,
      stage: "prepared_not_enabled",
      error_code: "real_comdirect_calls_not_enabled",
      credentials_retained: false,
      transactions_imported: 0
    }, 501);
  } catch (error) {
    return json(safeFailure(error), 400);
  }
});
