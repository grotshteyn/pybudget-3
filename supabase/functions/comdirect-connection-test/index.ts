import { COMDIRECT_API, assertProviderAllowed, sanitizeErrorCode, parseCsvSet, assertConfiguredMember } from "./security.mjs";

// Issue #41 pre-deployment diagnostic only.
// Intentionally NOT wired into the frontend and NOT deployed.
// No database writes. No transaction ingestion. No durable credential storage.

type Credentials = { client_id: string; client_secret: string; access_number: string; pin: string };
type TokenSet = { access_token: string; refresh_token?: string; token_type?: string };
type Diagnostic = {
  ok: boolean; stage: string; account_count: number | null; transaction_count: number | null;
  session_terminated: boolean; credentials_retained: false; transactions_imported: 0; error_code: string | null;
};

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "vary": "Origin",
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  return headers;
}
function allowedBrowserOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  return assertConfiguredMember(origin, Deno.env.get("COMDIRECT_DIAGNOSTIC_ALLOWED_ORIGINS"),
    "origin_not_allowed", "origin_not_allowed");
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
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
function requestInfo(sessionId: string, requestId: string) {
  return JSON.stringify({ clientRequestId: { sessionId, requestId } });
}
function randomId(bytes = 16) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (x) => x.toString(16).padStart(2, "0")).join("");
}
function providerHeaders(token: string, sessionId: string) {
  return { accept: "application/json", authorization: "Bearer " + token, "content-type": "application/json",
    "x-http-request-info": requestInfo(sessionId, randomId(8)) };
}
async function providerFetch(fetcher: typeof fetch, path: string, init: RequestInit) {
  const url = new URL(path, COMDIRECT_API);
  const method = String(init.method || "GET").toUpperCase();
  assertProviderAllowed(url, method);
  const response = await fetcher(url, { ...init, redirect: "error" });
  return response;
}
async function expectJson(response: Response, code: string) {
  if (!response.ok) throw new Error(code + "_" + response.status);
  return await response.json();
}
async function passwordToken(fetcher: typeof fetch, c: Credentials): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, grant_type: "password",
    username: c.access_number, password: c.pin });
  const response = await providerFetch(fetcher, "/oauth/token", { method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body });
  return await expectJson(response, "oauth_password_failed");
}
async function sessionStatus(fetcher: typeof fetch, token: string, sessionId: string) {
  const response = await providerFetch(fetcher, "/api/session/clients/user/v1/sessions",
    { method: "GET", headers: providerHeaders(token, sessionId) });
  const data = await expectJson(response, "session_status_failed");
  const session = Array.isArray(data) ? data[0] : data;
  if (!session?.identifier) throw new Error("session_identifier_missing");
  return session;
}
async function beginTwoFactor(fetcher: typeof fetch, token: string, sessionId: string, identifier: string) {
  const response = await providerFetch(fetcher, "/api/session/clients/user/v1/sessions/" + encodeURIComponent(identifier) + "/validate", {
    method: "POST", headers: providerHeaders(token, sessionId),
    body: JSON.stringify({ identifier, sessionTanActive: true, activated2FA: true })
  });
  if (!response.ok) throw new Error("two_factor_start_failed_" + response.status);
  const raw = response.headers.get("x-once-authentication-info");
  if (!raw) throw new Error("two_factor_info_missing");
  const info = JSON.parse(raw);
  if (!info?.id) throw new Error("two_factor_id_missing");
  return { id: String(info.id), challenge: info.challenge || null, typ: info.typ || null };
}
async function activateTwoFactor(fetcher: typeof fetch, token: string, sessionId: string, identifier: string, tanId: string, tan?: string) {
  const headers: Record<string, string> = { ...providerHeaders(token, sessionId), "x-once-authentication-info": JSON.stringify({ id: tanId }) };
  if (tan) headers["x-once-authentication"] = tan;
  const response = await providerFetch(fetcher, "/api/session/clients/user/v1/sessions/" + encodeURIComponent(identifier), {
    method: "PATCH", headers, body: JSON.stringify({ identifier, sessionTanActive: true, activated2FA: true })
  });
  await expectJson(response, "two_factor_activation_failed");
}
async function secondaryToken(fetcher: typeof fetch, c: Credentials, firstToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, grant_type: "cd_secondary", token: firstToken });
  const response = await providerFetch(fetcher, "/oauth/token", { method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body });
  return await expectJson(response, "oauth_secondary_failed");
}
async function listAccounts(fetcher: typeof fetch, token: string, sessionId: string) {
  const response = await providerFetch(fetcher, "/api/banking/v1/accounts", { method: "GET", headers: providerHeaders(token, sessionId) });
  const data = await expectJson(response, "accounts_failed");
  return Array.isArray(data?.values) ? data.values : Array.isArray(data) ? data : [];
}
function diagnostic(stage: string, values: Partial<Diagnostic> = {}): Diagnostic {
  return { ok: false, stage, account_count: null, transaction_count: null, session_terminated: false,
    credentials_retained: false, transactions_imported: 0, error_code: null, ...values };
}
function safeFailure(error: unknown): Diagnostic {
  return diagnostic("failed", { error_code: sanitizeErrorCode(error) });
}

export { assertProviderAllowed, requireCredentials, requestInfo, providerFetch, passwordToken, sessionStatus, beginTwoFactor,
  activateTwoFactor, secondaryToken, listAccounts, diagnostic, safeFailure };

function diagnosticAllowedUserIds() {
  return parseCsvSet(Deno.env.get("COMDIRECT_DIAGNOSTIC_ALLOWED_USER_IDS"));
}

function assertDiagnosticUserAllowed(userId: string) {
  return assertConfiguredMember(userId, Deno.env.get("COMDIRECT_DIAGNOSTIC_ALLOWED_USER_IDS"),
    "diagnostic_allowlist_not_configured", "diagnostic_user_not_allowed");
}

async function requirePyBudgetUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("pybudget_auth_required");
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!base || !key) throw new Error("supabase_auth_not_configured");
  const response = await fetch(base + "/auth/v1/user", {
    headers: { authorization, apikey: key, accept: "application/json" }
  });
  if (!response.ok) throw new Error("pybudget_auth_invalid");
  const user = await response.json();
  if (!user?.id) throw new Error("pybudget_auth_invalid");
  return assertDiagnosticUserAllowed(user.id as string);
}

async function runAccountDiagnostic(fetcher: typeof fetch, credentials: Credentials, wait: (ms: number) => Promise<void>) {
  const clientSessionId = randomId(16);
  let first: TokenSet | null = null;
  let secondary: TokenSet | null = null;
  let providerSession: string | null = null;
  // No provider session-termination request is sent yet: its exact semantics are intentionally
  // left for the first controlled DEV verification rather than guessing a potentially destructive call.
  try {
    first = await passwordToken(fetcher, credentials);
    if (!first?.access_token) throw new Error("oauth_access_token_missing");
    const status = await sessionStatus(fetcher, first.access_token, clientSessionId);
    providerSession = String(status.identifier);
    const challenge = await beginTwoFactor(fetcher, first.access_token, clientSessionId, providerSession);

    // Push/photoTAN approval happens out-of-band in the comdirect app. Keeping the whole
    // diagnostic in one invocation prevents OAuth/session credentials from entering the browser
    // or a database. Retry activation for a bounded period while the user approves the challenge.
    let activated = false;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 12 && !activated; attempt += 1) {
      if (attempt) await wait(5000);
      try {
        await activateTwoFactor(fetcher, first.access_token, clientSessionId, providerSession, challenge.id);
        activated = true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!activated) throw lastError || new Error("two_factor_timeout");

    secondary = await secondaryToken(fetcher, credentials, first.access_token);
    if (!secondary?.access_token) throw new Error("oauth_secondary_token_missing");
    const accounts = await listAccounts(fetcher, secondary.access_token, clientSessionId);
    return diagnostic("accounts", { ok: true, account_count: accounts.length });
  } finally {
    first = null;
    secondary = null;
    providerSession = null;
    credentials.client_secret = "";
    credentials.pin = "";
    // Deliberately no logging of provider responses or credential-bearing state.
  }
}

export { diagnosticAllowedUserIds, assertDiagnosticUserAllowed, requirePyBudgetUser, runAccountDiagnostic };

Deno.serve(async (req) => {
  let origin: string | null = null;
  try {
    origin = allowedBrowserOrigin(req);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        ...corsHeaders(origin),
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
        "access-control-max-age": "600",
      } });
    }
    if (req.method !== "POST") return json({ ok: false, error_code: "method_not_allowed" }, 405, origin);
    await requirePyBudgetUser(req);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { throw new Error("invalid_json"); }
    if (body?.action !== "account-diagnostic") throw new Error("unsupported_action");
    const credentials = requireCredentials(body);
    const result = await runAccountDiagnostic(fetch, credentials, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    return json(result, 200, origin);
  } catch (error) {
    return json(safeFailure(error), 400, origin);
  }
});
