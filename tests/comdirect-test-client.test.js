const assert = require("assert");
const api = require("../comdirect-test-client.js");

assert.deepStrictEqual(api.credentials({
  client_id: " client ",
  client_secret: " secret ",
  access_number: " 12345678 ",
  pin: " 123456 "
}), {
  client_id: "client",
  client_secret: "secret",
  access_number: "12345678",
  pin: "123456"
});

assert.throws(() => api.assertAllowedAction("transfer"), /Blocked/);
assert.strictEqual(api.assertAllowedAction("list-transactions"), "list-transactions");

const raw = {
  ok: true,
  stage: "transactions",
  account_count: 2,
  transaction_count: 17,
  access_token: "must-not-leak",
  refresh_token: "must-not-leak",
  pin: "must-not-leak",
  session_tan: "must-not-leak"
};
const diagnostic = api.sanitizeDiagnostic(raw);
assert.deepStrictEqual(diagnostic, {
  ok: true,
  stage: "transactions",
  account_count: 2,
  transaction_count: 17,
  session_terminated: false,
  credentials_retained: false,
  transactions_imported: 0,
  error_code: null
});
assert.ok(!JSON.stringify(diagnostic).includes("must-not-leak"));
console.log("comdirect test client tests passed");
