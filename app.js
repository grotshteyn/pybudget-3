const config = window.PYBUDGET_CONFIG || {};
const configured = Boolean(
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  !config.supabaseUrl.startsWith("YOUR_") &&
  !config.supabaseAnonKey.startsWith("YOUR_")
);

const client = configured
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

const elements = {
  setupWarning: document.querySelector("#setup-warning"),
  authView: document.querySelector("#auth-view"),
  dashboardView: document.querySelector("#dashboard-view"),
  authForm: document.querySelector("#auth-form"),
  loginTab: document.querySelector("#login-tab"),
  signupTab: document.querySelector("#signup-tab"),
  formTitle: document.querySelector("#form-title"),
  formSubtitle: document.querySelector("#form-subtitle"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  submitButton: document.querySelector("#submit-button"),
  resetButton: document.querySelector("#reset-button"),
  authMessage: document.querySelector("#auth-message"),
  userEmail: document.querySelector("#user-email"),
  logoutButton: document.querySelector("#logout-button")
};

let mode = "login";

function showMessage(text, type = "error") {
  elements.authMessage.textContent = text;
  elements.authMessage.className = `notice ${type}`;
  elements.authMessage.hidden = false;
}

function clearMessage() {
  elements.authMessage.hidden = true;
  elements.authMessage.textContent = "";
}

function setMode(nextMode) {
  mode = nextMode;
  const login = mode === "login";
  elements.loginTab.classList.toggle("active", login);
  elements.signupTab.classList.toggle("active", !login);
  elements.loginTab.setAttribute("aria-selected", String(login));
  elements.signupTab.setAttribute("aria-selected", String(!login));
  elements.formTitle.textContent = login ? "Welcome back" : "Create your account";
  elements.formSubtitle.textContent = login
    ? "Log in to continue to PyBudget."
    : "Start with a secure PyBudget account.";
  elements.submitButton.textContent = login ? "Log in" : "Create account";
  elements.password.autocomplete = login ? "current-password" : "new-password";
  elements.resetButton.hidden = !login;
  clearMessage();
}

function renderSession(session) {
  const signedIn = Boolean(session?.user);
  elements.authView.hidden = signedIn;
  elements.dashboardView.hidden = !signedIn;
  elements.userEmail.textContent = session?.user?.email || "";
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();

  if (!client) {
    showMessage("Supabase is not configured yet.");
    return;
  }

  elements.submitButton.disabled = true;
  const credentials = {
    email: elements.email.value.trim(),
    password: elements.password.value
  };

  try {
    const result = mode === "login"
      ? await client.auth.signInWithPassword(credentials)
      : await client.auth.signUp(credentials);

    if (result.error) throw result.error;

    if (mode === "signup" && !result.data.session) {
      showMessage("Account created. Check your email to confirm it, then log in.", "success");
      elements.authForm.reset();
    } else {
      renderSession(result.data.session);
    }
  } catch (error) {
    showMessage(error.message || "Authentication failed. Please try again.");
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function resetPassword() {
  clearMessage();
  const email = elements.email.value.trim();

  if (!client) return showMessage("Supabase is not configured yet.");
  if (!email) return showMessage("Enter your email address first.");

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return showMessage(error.message);
  showMessage("Password-reset email sent.", "success");
}

elements.loginTab.addEventListener("click", () => setMode("login"));
elements.signupTab.addEventListener("click", () => setMode("signup"));
elements.authForm.addEventListener("submit", handleSubmit);
elements.resetButton.addEventListener("click", resetPassword);
elements.logoutButton.addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  renderSession(null);
});

if (!configured) {
  elements.setupWarning.hidden = false;
  renderSession(null);
} else {
  client.auth.getSession().then(({ data }) => renderSession(data.session));
  client.auth.onAuthStateChange((_event, session) => renderSession(session));
}
