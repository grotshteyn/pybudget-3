// Issue #41 pre-deployment diagnostic only.
// Intentionally NOT wired into the frontend and NOT deployed.
// No database writes. No transaction ingestion. No durable credential storage.

const COMDIRECT_API = "https://api.comdirect.de";
const ALLOWED = [
  { method: "POST", path: /^\/oauth\/token$/ },
  { method: "GET", path: /^\/api\/session\/clients\/user\/v1\/sessions$/ },
  { method: "POST", path: /^\/api\/session\/clients\/user\/v1\/sessions\/[^/]+\/validate$/ },
  { method: "PATCH", path: /^\/api\/session\/clients\/user\/v1\/sessions\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/session\/clients\/user\/v1\/sessions\/[^/]+$/ },
  { method: "GET", path: /^\/api\/banking\/v1\/accounts$/ },
  { method: "GET", path: /^\/api\/banking\/v1\/accounts\/[^/]+\/transactions$/ }
];

type Credentials = { client_id: string; client_secret: string; access_number: string; pin: string };
type TokenSet = { access_token: string; refresh_token?: string; token_type?: string };
type Diagnostic = {
  ok: boolean; stage: string; account_count: number | null; transaction_count: number | null;
  session_terminated: boolean; credentials_retained: false; transactions_imported: 0; error_code: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function assertAllowed(url: URL, method: string) {
  if (url.origin !== COMDIRECT_API) throw new Error("provider_origin_blocked");
  if (!ALLOWED.some((entry) => entry.method === method && entry.path.test(url.pathname))) throw new Error("provider_endpoint_blocked");
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
  assertAllowed(url, method);
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
async function terminateSession(fetcher: typeof fetch, token: string, sessionId: string, identifier: string) {
  // Kept behind the allowlist but not assumed to be supported until the live API confirms termination semantics.
  const response = await providerFetch(fetcher, "/api/session/clients/user/v1/sessions/" + encodeURIComponent(identifier),
    { method: "DELETE", headers: providerHeaders(token, sessionId) });
  return response.ok;
}
function diagnostic(stage: string, values: Partial<Diagnostic> = {}): Diagnostic {
  return { ok: false, stage, account_count: null, transaction_count: null, session_terminated: false,
    credentials_retained: false, transactions_imported: 0, error_code: null, ...values };
}
function safeFailure(error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : "unexpected_error";
  return diagnostic("failed", { error_code: message });
}

export { assertAllowed, requireCredentials, requestInfo, providerFetch, passwordToken, sessionStatus, beginTwoFactor,
  activateTwoFactor, secondaryToken, listAccounts, terminateSession, diagnostic, safeFailure };

// The HTTP entrypoint remains deliberately disabled. The state-machine functions above are testable with mocked fetch.
// We will enable a real multi-step browser protocol only after reviewing current provider behavior and explicit deployment approval.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error_code: "method_not_allowed" }, 405);
  try {
    const body = await req.json();
    requireCredentials(body);
    return json(diagnostic("prepared_not_enabled", { error_code: "real_comdirect_calls_not_enabled" }), 501);
  } catch (error) {
    return json(safeFailure(error), 400);
  }
});
