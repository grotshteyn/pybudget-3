export const COMDIRECT_API = "https://api.comdirect.de";

const ALLOWED_PROVIDER_ROUTES = Object.freeze([
  ["POST", /^\/oauth\/token$/],
  ["GET", /^\/api\/session\/clients\/user\/v1\/sessions$/],
  ["POST", /^\/api\/session\/clients\/user\/v1\/sessions\/[^/]+\/validate$/],
  ["PATCH", /^\/api\/session\/clients\/user\/v1\/sessions\/[^/]+$/],
  ["GET", /^\/api\/banking\/v1\/accounts$/],
]);

const SAFE_ERROR_EXACT = new Set([
  "unexpected_error", "provider_origin_blocked", "provider_endpoint_blocked",
  "session_identifier_missing", "two_factor_info_missing", "two_factor_id_missing",
  "oauth_access_token_missing", "oauth_secondary_token_missing", "two_factor_timeout",
  "diagnostic_allowlist_not_configured", "diagnostic_user_not_allowed",
  "pybudget_auth_required", "supabase_auth_not_configured", "pybudget_auth_invalid",
  "unsupported_action", "invalid_json", "origin_not_allowed", "diagnostic_live_disabled",
]);

const SAFE_ERROR_PREFIXES = Object.freeze([
  "missing_client_id", "missing_client_secret", "missing_access_number", "missing_pin",
  "oauth_password_failed_", "session_status_failed_", "two_factor_start_failed_",
  "two_factor_activation_failed_", "oauth_secondary_failed_", "accounts_failed_",
]);

export function assertProviderAllowed(url, method) {
  if (url.origin !== COMDIRECT_API) throw new Error("provider_origin_blocked");
  const verb = String(method || "GET").toUpperCase();
  if (!ALLOWED_PROVIDER_ROUTES.some(([allowedMethod, path]) => allowedMethod === verb && path.test(url.pathname))) {
    throw new Error("provider_endpoint_blocked");
  }
}

export function sanitizeErrorCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (SAFE_ERROR_EXACT.has(message)) return message;
  if (SAFE_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix) && /^\d{3}$/.test(message.slice(prefix.length)))) return message;
  return "unexpected_error";
}

export function parseCsvSet(value) {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function assertConfiguredMember(value, configured, emptyCode, deniedCode) {
  const allowed = parseCsvSet(configured);
  if (!allowed.size) throw new Error(emptyCode);
  if (!allowed.has(value)) throw new Error(deniedCode);
  return value;
}
