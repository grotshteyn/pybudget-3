(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PyBudgetComdirectFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const STATES = Object.freeze({
    IDLE: "idle", AUTHENTICATING: "authenticating", AWAITING_2FA: "awaiting_2fa",
    ACTIVATING_2FA: "activating_2fa", DISCOVERING: "discovering", COMPLETE: "complete", FAILED: "failed"
  });

  function createFlow(transport) {
    if (!transport || typeof transport.start !== "function" || typeof transport.confirm !== "function") {
      throw new Error("A comdirect test transport is required");
    }
    let state = STATES.IDLE;
    let challenge = null;
    let diagnostic = null;

    async function start(credentials) {
      if (state !== STATES.IDLE && state !== STATES.FAILED) throw new Error("flow_already_started");
      state = STATES.AUTHENTICATING;
      try {
        const result = await transport.start(credentials);
        if (result.status !== "awaiting_2fa" || !result.challenge_id) throw new Error("invalid_start_response");
        challenge = { id: result.challenge_id, type: result.challenge_type || null, text: result.challenge_text || null };
        state = STATES.AWAITING_2FA;
        return snapshot();
      } catch (error) {
        state = STATES.FAILED;
        diagnostic = { ok: false, error_code: error.message || "authentication_failed" };
        return snapshot();
      }
    }

    async function confirm(input) {
      if (state !== STATES.AWAITING_2FA || !challenge) throw new Error("flow_not_awaiting_2fa");
      state = STATES.ACTIVATING_2FA;
      try {
        const result = await transport.confirm({ challenge_id: challenge.id, tan: input && input.tan ? input.tan : null });
        if (result.status !== "complete") throw new Error("invalid_confirm_response");
        state = STATES.DISCOVERING;
        diagnostic = result.diagnostic || null;
        if (!diagnostic || diagnostic.transactions_imported !== 0 || diagnostic.credentials_retained !== false) {
          throw new Error("unsafe_diagnostic_response");
        }
        state = STATES.COMPLETE;
        challenge = null;
        return snapshot();
      } catch (error) {
        state = STATES.FAILED;
        diagnostic = { ok: false, error_code: error.message || "two_factor_failed" };
        challenge = null;
        return snapshot();
      }
    }

    function reset() {
      state = STATES.IDLE; challenge = null; diagnostic = null; return snapshot();
    }
    function snapshot() {
      return { state, challenge: challenge ? { ...challenge } : null, diagnostic: diagnostic ? { ...diagnostic } : null };
    }
    return { start, confirm, reset, snapshot };
  }

  function createMockTransport(options = {}) {
    const delay = Number(options.delay || 0);
    const wait = () => new Promise((resolve) => setTimeout(resolve, delay));
    return {
      async start(credentials) {
        await wait();
        if (!credentials || !credentials.client_id || !credentials.client_secret || !credentials.access_number || !credentials.pin) {
          throw new Error("missing_credentials");
        }
        return { status: "awaiting_2fa", challenge_id: "mock-challenge", challenge_type: "P_TAN_PUSH",
          challenge_text: "Mock only: approve the simulated photoTAN request." };
      },
      async confirm() {
        await wait();
        return { status: "complete", diagnostic: { ok: true, stage: "accounts", account_count: 2,
          transaction_count: null, session_terminated: true, credentials_retained: false,
          transactions_imported: 0, error_code: null } };
      }
    };
  }

  return { STATES, createFlow, createMockTransport };
});
