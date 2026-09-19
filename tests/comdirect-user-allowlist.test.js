const assert = require("assert");

const allowed = new Set(["d475eda6-4f7d-4347-a800-ce33ad9e706f"]);
function assertAllowed(userId) {
  if (!allowed.has(userId)) throw new Error("diagnostic_user_not_allowed");
  return userId;
}

assert.strictEqual(assertAllowed("d475eda6-4f7d-4347-a800-ce33ad9e706f"), "d475eda6-4f7d-4347-a800-ce33ad9e706f");
assert.throws(() => assertAllowed("00000000-0000-0000-0000-000000000000"), /diagnostic_user_not_allowed/);
assert.throws(() => assertAllowed(""), /diagnostic_user_not_allowed/);
assert.strictEqual(allowed.size, 1);
console.log("comdirect DEV user allowlist tests passed");
