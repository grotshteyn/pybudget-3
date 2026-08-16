const config = window.PYBUDGET_CONFIG || {};
const configured = Boolean(
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  !config.supabaseUrl.startsWith("YOUR_") &&
  !config.supabaseAnonKey.startsWith("YOUR_")
);
const client = configured ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;

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
  logoutButton: document.querySelector("#logout-button"),
  importMenuButton: document.querySelector("#import-menu-button"),
  transactionsMenuButton: document.querySelector("#transactions-menu-button"),
  importView: document.querySelector("#import-view"),
  transactionsView: document.querySelector("#transactions-view"),
  refreshAccounts: document.querySelector("#refresh-accounts"),
  accountsList: document.querySelector("#accounts-list"),
  accountsMessage: document.querySelector("#accounts-message"),
  csvFile: document.querySelector("#csv-file"),
  importPreview: document.querySelector("#import-preview"),
  previewAccounts: document.querySelector("#preview-accounts"),
  previewTransactions: document.querySelector("#preview-transactions"),
  previewPending: document.querySelector("#preview-pending"),
  previewErrors: document.querySelector("#preview-errors"),
  importButton: document.querySelector("#import-button"),
  importMessage: document.querySelector("#import-message"),
  refreshTransactions: document.querySelector("#refresh-transactions"),
  transactionsBody: document.querySelector("#transactions-body"),
  transactionsMessage: document.querySelector("#transactions-message"),
  bookedTotal: document.querySelector("#booked-total"),
  pendingTotal: document.querySelector("#pending-total"),
  combinedTotal: document.querySelector("#combined-total"),
  testFieldForm: document.querySelector("#test-field-form"),
  testField: document.querySelector("#test-field"),
  saveFieldButton: document.querySelector("#save-field-button"),
  dataMessage: document.querySelector("#data-message")
};

let mode = "login";
let currentUser = null;
let parsedImport = null;

function showMessage(element, text, type = "error") {
  element.textContent = text;
  element.className = `notice ${type}`;
  element.hidden = false;
}

function clearMessage(element) {
  element.hidden = true;
  element.textContent = "";
}

function setMode(nextMode) {
  mode = nextMode;
  const login = mode === "login";
  elements.loginTab.classList.toggle("active", login);
  elements.signupTab.classList.toggle("active", !login);
  elements.loginTab.setAttribute("aria-selected", String(login));
  elements.signupTab.setAttribute("aria-selected", String(!login));
  elements.formTitle.textContent = login ? "Welcome back" : "Create your account";
  elements.formSubtitle.textContent = login ? "Log in to continue to PyBudget." : "Start with a secure PyBudget account.";
  elements.submitButton.textContent = login ? "Log in" : "Create account";
  elements.password.autocomplete = login ? "current-password" : "new-password";
  elements.resetButton.hidden = !login;
  clearMessage(elements.authMessage);
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function formatDate(transaction) {
  const value = transaction.booking_date || transaction.transaction_date || transaction.value_date;
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en-GB").format(new Date(`${value}T00:00:00`));
}

async function loadTestField(user) {
  elements.testField.value = "";
  clearMessage(elements.dataMessage);
  const { data, error } = await client.from("user_test_data").select("value").eq("user_id", user.id).maybeSingle();
  if (error) return showMessage(elements.dataMessage, error.message);
  elements.testField.value = data?.value || "";
}

function makeCell(text, className) {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function accountCard(account) {
  const form = document.createElement("form");
  form.className = "account-card";
  const heading = document.createElement("div");
  heading.className = "account-card-heading";
  const identity = document.createElement("div");
  const source = document.createElement("span");
  source.className = "account-source";
  source.textContent = account.source;
  const key = document.createElement("small");
  key.textContent = account.external_key;
  identity.append(source, key);
  const status = document.createElement("span");
  status.className = `account-state ${account.is_active ? "active" : "archived"}`;
  status.textContent = account.is_active ? "Active" : "Archived";
  heading.append(identity, status);

  const label = document.createElement("label");
  label.textContent = "Display name";
  const input = document.createElement("input");
  input.name = "display_name";
  input.maxLength = 80;
  input.required = true;
  input.value = account.display_name;

  const actions = document.createElement("div");
  actions.className = "account-actions";
  const save = document.createElement("button");
  save.className = "compact primary";
  save.type = "submit";
  save.textContent = "Save name";
  const toggle = document.createElement("button");
  toggle.className = "compact secondary";
  toggle.type = "button";
  toggle.textContent = account.is_active ? "Archive" : "Reactivate";
  toggle.addEventListener("click", () => updateAccount(account.id, { is_active: !account.is_active }));
  actions.append(save, toggle);
  form.append(heading, label, input, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    updateAccount(account.id, { display_name: input.value.trim() });
  });
  return form;
}

async function loadAccounts() {
  if (!client || !currentUser) return;
  clearMessage(elements.accountsMessage);
  const { data, error } = await client.from("bank_accounts")
    .select("id,source,external_key,display_name,currency,is_active,created_at,updated_at")
    .order("is_active", { ascending: false }).order("created_at", { ascending: true });
  if (error) {
    elements.accountsList.replaceChildren();
    return showMessage(elements.accountsMessage, error.message);
  }
  elements.accountsList.replaceChildren(...data.map(accountCard));
  if (!data.length) showMessage(elements.accountsMessage, "No accounts detected yet. Import a bank CSV below to create them.", "success");
}

async function updateAccount(accountId, changes) {
  if (!client || !currentUser) return;
  if ("display_name" in changes && !changes.display_name) return showMessage(elements.accountsMessage, "Account name cannot be empty.");
  clearMessage(elements.accountsMessage);
  const { error } = await client.from("bank_accounts")
    .update({ ...changes, updated_at: new Date().toISOString() }).eq("id", accountId);
  if (error) return showMessage(elements.accountsMessage, error.message);
  showMessage(elements.accountsMessage, "Account updated.", "success");
  await loadAccounts();
  await loadTransactions();
}

async function loadTransactions() {
  if (!client || !currentUser) return;
  clearMessage(elements.transactionsMessage);
  const { data, error } = await client
    .from("transactions")
    .select("id,status,amount_cent,currency,booking_date,value_date,transaction_date,partner,description,bank_accounts(display_name)")
    .order("booking_date", { ascending: false, nullsFirst: true })
    .limit(200);

  if (error) {
    elements.transactionsBody.replaceChildren();
    return showMessage(elements.transactionsMessage, `Transaction schema is not ready: ${error.message}`);
  }

  let booked = 0;
  let pending = 0;
  const rows = data.map((transaction) => {
    if (transaction.status === "pending") pending += Number(transaction.amount_cent);
    if (transaction.status === "booked") booked += Number(transaction.amount_cent);
    const row = document.createElement("tr");
    row.appendChild(makeCell(formatDate(transaction)));
    row.appendChild(makeCell(transaction.partner || transaction.description || "Unknown"));
    row.appendChild(makeCell(transaction.bank_accounts?.display_name || "Account"));
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${transaction.status}`;
    badge.textContent = transaction.status;
    statusCell.appendChild(badge);
    row.appendChild(statusCell);
    row.appendChild(makeCell(formatMoney(Number(transaction.amount_cent)), `amount ${transaction.amount_cent >= 0 ? "positive" : "negative"}`));
    return row;
  });
  elements.transactionsBody.replaceChildren(...rows);
  elements.bookedTotal.textContent = formatMoney(booked);
  elements.pendingTotal.textContent = formatMoney(pending);
  elements.combinedTotal.textContent = formatMoney(booked + pending);
  if (!data.length) showMessage(elements.transactionsMessage, "No imported transactions yet.", "success");
}

function showFeature(feature) {
  const showImport = feature === "import";
  elements.importView.hidden = !showImport;
  elements.transactionsView.hidden = showImport;
  elements.importMenuButton.classList.toggle("active", showImport);
  elements.transactionsMenuButton.classList.toggle("active", !showImport);
  elements.importMenuButton.setAttribute("aria-current", showImport ? "page" : "false");
  elements.transactionsMenuButton.setAttribute("aria-current", showImport ? "false" : "page");
  if (showImport) loadAccounts();
  else loadTransactions();
}

function renderSession(session) {
  const signedIn = Boolean(session?.user);
  currentUser = session?.user || null;
  document.body.classList.toggle("signed-in", signedIn);
  elements.authView.hidden = signedIn;
  elements.dashboardView.hidden = !signedIn;
  elements.userEmail.textContent = currentUser?.email || "";
  if (currentUser) {
    loadTestField(currentUser);
    showFeature("import");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage(elements.authMessage);
  if (!client) return showMessage(elements.authMessage, "Supabase is not configured yet.");
  elements.submitButton.disabled = true;
  const credentials = { email: elements.email.value.trim(), password: elements.password.value };
  try {
    const result = mode === "login"
      ? await client.auth.signInWithPassword(credentials)
      : await client.auth.signUp({
          ...credentials,
          options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
        });
    if (result.error) throw result.error;
    if (mode === "signup" && !result.data.session) {
      showMessage(elements.authMessage, "Account created. Check your email to confirm it, then log in.", "success");
      elements.authForm.reset();
    } else renderSession(result.data.session);
  } catch (error) {
    showMessage(elements.authMessage, error.message || "Authentication failed.");
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function resetPassword() {
  clearMessage(elements.authMessage);
  const email = elements.email.value.trim();
  if (!client) return showMessage(elements.authMessage, "Supabase is not configured yet.");
  if (!email) return showMessage(elements.authMessage, "Enter your email address first.");
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return showMessage(elements.authMessage, error.message);
  showMessage(elements.authMessage, "Password-reset email sent.", "success");
}

async function handleFileSelection() {
  parsedImport = null;
  elements.importButton.disabled = true;
  elements.importPreview.hidden = true;
  clearMessage(elements.importMessage);
  const file = elements.csvFile.files?.[0];
  if (!file) return;
  try {
    parsedImport = await window.PyBudgetImporter.parseComdirectFile(file);
    elements.previewAccounts.textContent = parsedImport.accounts.length;
    elements.previewTransactions.textContent = parsedImport.transaction_count;
    elements.previewPending.textContent = parsedImport.pending_count;
    elements.previewErrors.textContent = parsedImport.errors.length;
    elements.importPreview.hidden = false;
    if (!parsedImport.accounts.length || !parsedImport.transaction_count) {
      throw new Error("No supported Comdirect transactions were found.");
    }
    elements.importButton.disabled = false;
    showMessage(elements.importMessage, `Ready to import ${parsedImport.transaction_count} transactions.`, "success");
  } catch (error) {
    parsedImport = null;
    showMessage(elements.importMessage, error.message || "Could not parse this CSV.");
  }
}

async function importTransactions() {
  if (!client || !currentUser || !parsedImport) return;
  elements.importButton.disabled = true;
  showMessage(elements.importMessage, "Importing and reconciling transactions…", "success");
  const { data, error } = await client.rpc("import_comdirect_transactions", {
    p_file_name: parsedImport.file_name,
    p_file_sha256: parsedImport.file_sha256,
    p_period_start: parsedImport.period_start,
    p_period_end: parsedImport.period_end,
    p_accounts: parsedImport.accounts
  });
  elements.importButton.disabled = false;
  if (error) return showMessage(elements.importMessage, error.message);
  const prefix = data.already_imported ? "This exact file was already imported." : "Import complete.";
  showMessage(
    elements.importMessage,
    `${prefix} Added ${data.inserted}, reconciled ${data.reconciled}, skipped ${data.duplicates}, rejected ${data.rejected}.`,
    "success"
  );
  await loadTransactions();
  await loadAccounts();
}

elements.loginTab.addEventListener("click", () => setMode("login"));
elements.signupTab.addEventListener("click", () => setMode("signup"));
elements.authForm.addEventListener("submit", handleSubmit);
elements.resetButton.addEventListener("click", resetPassword);
elements.importMenuButton.addEventListener("click", () => showFeature("import"));
elements.transactionsMenuButton.addEventListener("click", () => showFeature("transactions"));
elements.refreshAccounts.addEventListener("click", loadAccounts);
elements.csvFile.addEventListener("change", handleFileSelection);
elements.importButton.addEventListener("click", importTransactions);
elements.refreshTransactions.addEventListener("click", loadTransactions);
elements.testFieldForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client || !currentUser) return;
  elements.saveFieldButton.disabled = true;
  clearMessage(elements.dataMessage);
  const { error } = await client.from("user_test_data").upsert(
    { user_id: currentUser.id, value: elements.testField.value, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  elements.saveFieldButton.disabled = false;
  if (error) return showMessage(elements.dataMessage, error.message);
  showMessage(elements.dataMessage, "Saved privately to Supabase.", "success");
});
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
