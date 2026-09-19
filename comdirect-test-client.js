(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PyBudgetComdirectTest = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const ALLOWED_ACTIONS = new Set(["authenticate", "activate-session", "list-accounts", "list-transactions", "terminate-session"]);

  function requireString(value, name) {
    if (typeof value !== "string" || !value.trim()) throw new Error(name + " is required");
    return value.trim();
  }

  function credentials(input) {
    return {
      client_id: requireString(input.client_id, "client_id"),
      client_secret: requireString(input.client_secret, "client_secret"),
      access_number: requireString(input.access_number, "access_number"),
      pin: requireString(input.pin, "pin")
    };
  }

  function assertAllowedAction(action) {
    if (!ALLOWED_ACTIONS.has(action)) throw new Error("Blocked comdirect test action: " + action);
    return action;
  }

  function sanitizeDiagnostic(value) {
    return {
      ok: Boolean(value && value.ok),
      stage: String(value && value.stage || "unknown"),
      account_count: Number.isInteger(value && value.account_count) ? value.account_count : null,
      transaction_count: Number.isInteger(value && value.transaction_count) ? value.transaction_count : null,
      session_terminated: Boolean(value && value.session_terminated),
      credentials_retained: false,
      transactions_imported: 0,
      error_code: value && value.error_code ? String(value.error_code) : null
    };
  }

  return { ALLOWED_ACTIONS, credentials, assertAllowedAction, sanitizeDiagnostic };
});
