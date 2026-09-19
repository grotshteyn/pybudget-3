const assert = require("assert");

const API = "https://api.comdirect.de";
const allowed = [
  ["POST", /^\/oauth\/token$/],
  ["GET", /^\/api\/session\/clients\/user\/v1\/sessions$/],
  ["POST", /^\/api\/session\/clients\/user\/v1\/sessions\/[^/]+\/validate$/],
  ["PATCH", /^\/api\/session\/clients\/user\/v1\/sessions\/[^/]+$/],
  ["GET", /^\/api\/banking\/v1\/accounts$/]
];
function assertAllowed(url, method) {
  const parsed = new URL(url);
  if (parsed.origin !== API || !allowed.some(([m, p]) => m === method && p.test(parsed.pathname))) throw new Error("blocked");
}
function mockFetch(sequence) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    assertAllowed(String(url), method);
    calls.push({ url: String(url), method, headers: init.headers || {}, body: init.body ? String(init.body) : "" });
    const next = sequence.shift();
    if (!next) throw new Error("unexpected mock request");
    return new Response(JSON.stringify(next.body || {}), { status: next.status || 200, headers: next.headers || { "content-type": "application/json" } });
  };
  return { fetcher, calls };
}

(async () => {
  assert.doesNotThrow(() => assertAllowed(API + "/oauth/token", "POST"));
  assert.throws(() => assertAllowed(API + "/api/banking/v1/accounts/a/transactions", "GET"), /blocked/);
  assert.throws(() => assertAllowed(API + "/api/session/clients/user/v1/sessions/session-1", "DELETE"), /blocked/);
  assert.throws(() => assertAllowed(API + "/api/banking/v1/accounts/a/transfers", "POST"), /blocked/);
  assert.throws(() => assertAllowed(API + "/api/brokerage/v3/orders", "POST"), /blocked/);
  assert.throws(() => assertAllowed("https://evil.example/oauth/token", "POST"), /blocked/);

  const mock = mockFetch([
    { body: { access_token: "first-token", refresh_token: "refresh-secret" } },
    { body: [{ identifier: "session-1", sessionTanActive: false }] },
    { body: {}, headers: { "content-type": "application/json", "x-once-authentication-info": JSON.stringify({ id: "tan-id", typ: "P_TAN_PUSH" }) } },
    { body: { identifier: "session-1", sessionTanActive: true } },
    { body: { access_token: "secondary-token", refresh_token: "secondary-refresh" } },
    { body: { values: [{ accountId: "account-1" }, { accountId: "account-2" }] } }
  ]);

  const credentials = { client_id: "client", client_secret: "secret", access_number: "12345678", pin: "123456" };
  const form = new URLSearchParams({ client_id: credentials.client_id, client_secret: credentials.client_secret,
    grant_type: "password", username: credentials.access_number, password: credentials.pin });
  await mock.fetcher(API + "/oauth/token", { method: "POST", body: form });
  await mock.fetcher(API + "/api/session/clients/user/v1/sessions", { method: "GET" });
  await mock.fetcher(API + "/api/session/clients/user/v1/sessions/session-1/validate", { method: "POST" });
  await mock.fetcher(API + "/api/session/clients/user/v1/sessions/session-1", { method: "PATCH" });
  await mock.fetcher(API + "/oauth/token", { method: "POST" });
  await mock.fetcher(API + "/api/banking/v1/accounts", { method: "GET" });

  assert.strictEqual(mock.calls.length, 6);
  assert.ok(mock.calls[0].body.includes("client_id=client"));
  assert.ok(mock.calls[0].body.includes("username=12345678"));
  assert.ok(mock.calls[0].body.includes("password=123456"));
  assert.ok(mock.calls.every((call) => !call.url.includes("secret") && !call.url.includes("123456")));

  const diagnostic = { ok: true, stage: "accounts", account_count: 2, transaction_count: null,
    session_terminated: false, credentials_retained: false, transactions_imported: 0, error_code: null };
  const serialized = JSON.stringify(diagnostic);
  for (const secret of ["client", "secret", "12345678", "123456", "first-token", "refresh-secret", "tan-id"]) {
    assert.ok(!serialized.includes(secret), "diagnostic leaked " + secret);
  }
  console.log("comdirect auth state-machine tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
