const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const security = await import(pathToFileURL(path.resolve(__dirname,
    "../supabase/functions/comdirect-connection-test/security.mjs")).href);

  const allowed = [
    ["POST", "/oauth/token"],
    ["GET", "/api/session/clients/user/v1/sessions"],
    ["POST", "/api/session/clients/user/v1/sessions/session-1/validate"],
    ["PATCH", "/api/session/clients/user/v1/sessions/session-1"],
    ["GET", "/api/banking/v1/accounts"],
  ];
  for (const [method, pathname] of allowed) {
    assert.doesNotThrow(() => security.assertProviderAllowed(new URL(pathname, security.COMDIRECT_API), method));
  }

  const blocked = [
    ["GET", "/api/banking/v1/accounts/account-1/transactions"],
    ["DELETE", "/api/session/clients/user/v1/sessions/session-1"],
    ["POST", "/api/banking/v1/transfers"],
    ["GET", "/api/brokerage/v3/depots"],
  ];
  for (const [method, pathname] of blocked) {
    assert.throws(() => security.assertProviderAllowed(new URL(pathname, security.COMDIRECT_API), method),
      /provider_endpoint_blocked/);
  }
  assert.throws(() => security.assertProviderAllowed(new URL("https://evil.invalid/oauth/token"), "POST"),
    /provider_origin_blocked/);

  assert.equal(security.sanitizeErrorCode(new Error("accounts_failed_401")), "accounts_failed_401");
  assert.equal(security.sanitizeErrorCode(new Error("oauth_password_failed_500")), "oauth_password_failed_500");
  assert.equal(security.sanitizeErrorCode(new Error("provider said token=super-secret")), "unexpected_error");
  assert.equal(security.sanitizeErrorCode({ message: "pin=123456" }), "unexpected_error");
  assert.equal(security.sanitizeErrorCode(new Error("accounts_failed_secret")), "unexpected_error");

  assert.deepEqual([...security.parseCsvSet(" a, b ,,a ")], ["a", "b"]);
  assert.equal(security.assertConfiguredMember("user-1", "user-1,user-2", "empty", "denied"), "user-1");
  assert.throws(() => security.assertConfiguredMember("user-3", "user-1", "empty", "denied"), /denied/);
  assert.throws(() => security.assertConfiguredMember("user-1", "", "empty", "denied"), /empty/);

  console.log("comdirect security policy tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
