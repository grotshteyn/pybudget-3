import { applyRulesAfterImport } from "./rule-import-orchestrator.js";
import { createManualPlanMatch, createPartnerRule } from "./rule-actions.js";

const config = window.PYBUDGET_CONFIG || {};
const configured = Boolean(
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  !config.supabaseUrl.startsWith("YOUR_") &&
  !config.supabaseAnonKey.startsWith("YOUR_"),
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
  logoutButton: document.querySelector("#logout-button"),
  navigationLinks: document.querySelectorAll(".app-menu [data-view]"),
  transactionMonth: document.querySelector("#transaction-month"),
  previousMonth: document.querySelector("#previous-month"),
  nextMonth: document.querySelector("#next-month"),
  reportVariant: document.querySelector("#report-variant"),
  reportMessage: document.querySelector("#report-message"),
  importView: document.querySelector("#accounts-view"),
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
  refreshReconciliation: document.querySelector("#refresh-reconciliation"),
  reconciliationList: document.querySelector("#reconciliation-list"),
  reconciliationMessage: document.querySelector("#reconciliation-message"),
  transactionsBody: document.querySelector("#transactions-body"),
  transactionsMessage: document.querySelector("#transactions-message"),
  testFieldForm: document.querySelector("#test-field-form"),
  testField: document.querySelector("#test-field"),
  saveFieldButton: document.querySelector("#save-field-button"),
  dataMessage: document.querySelector("#data-message"),
  assignDialog: document.querySelector("#assign-dialog"),
  assignTitle: document.querySelector("#assign-title"),
  assignPlan: document.querySelector("#assign-plan"),
  assignMessage: document.querySelector("#assign-message"),
  assignOnce: document.querySelector("#assign-once"),
  assignPartner: document.querySelector("#assign-partner"),
  closeAssign: document.querySelector("#close-assign"),
};

let mode = "login";
let currentUser = null;
let parsedImport = null;
let importBusy = false,
  recentBatch = null;
const importDialog = document.querySelector("#import-dialog"),
  closeImportButton = document.querySelector("#close-import"),
  importResult = document.querySelector("#import-result"),
  reviewImports = document.querySelector("#review-imports");
let transactions = [];
let ledger = { count: 0, booked: "0", pending: "0", review_count: 0 },
  ledgerOffset = 0;
const pageSize = 50;
let reviewCandidates = [],
  reviewRequest = 0;
const loadMore = document.querySelector("#load-more");
let assignmentTransaction = null;
let transactionState = "idle";
let transactionError = "";
let sessionVersion = 0;
let accountsRequest = 0;
let transactionsRequest = 0;
let fileRequest = 0;
const views = {
  overview: "overview-view",
  transactions: "transactions-view",
  reports: "reports-view",
  accounts: "accounts-view",
};
const navigationKey = "pybudget.navigation.v1";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

function readNavigation() {
  const migrateRoute = (value) =>
    value
      .replace(/^budget(?=\?|$)/, "overview")
      .replace(/^setup(?=\?|$)/, "accounts");
  let route = migrateRoute(window.location.hash.slice(1));
  if (!Object.hasOwn(views, route.split("?")[0])) {
    try {
      route = migrateRoute(sessionStorage.getItem(navigationKey) || "overview");
    } catch {
      route = "overview";
    }
  }
  const [view, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  return {
    view: Object.hasOwn(views, view) ? view : "overview",
    status: "all",
    account: /^[0-9a-f-]{36}$/i.test(params.get("account") || "")
      ? params.get("account")
      : "",
    month: /^\d{4}-\d{2}$/.test(params.get("month") || "")
      ? params.get("month")
      : currentMonth(),
    direction: "all",
    search: "",
    report: params.get("report") === "settlement" ? "settlement" : "expenses",
  };
}
let navigation = readNavigation();

function navigationHash(view = navigation.view) {
  const params = new URLSearchParams();
  params.set("month", navigation.month);
  if (navigation.report !== "expenses") params.set("report", navigation.report);
  return `#${view}${params.size ? `?${params}` : ""}`;
}

function retainNavigation() {
  const hash = navigationHash();
  try {
    sessionStorage.setItem(navigationKey, hash.slice(1));
  } catch {
    /* Direct links still work when storage is unavailable. */
  }
  window.history.replaceState(null, "", hash);
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    const view = link.getAttribute("href").slice(1).split("?")[0];
    if (Object.hasOwn(views, view)) link.href = navigationHash(view);
  });
}

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
  elements.formTitle.textContent = login
    ? "Welcome back"
    : "Create your account";
  elements.formSubtitle.textContent = login
    ? "Log in to continue to PyBudget."
    : "Start with a secure PyBudget account.";
  elements.submitButton.textContent = login ? "Log in" : "Create account";
  elements.password.autocomplete = login ? "current-password" : "new-password";
  elements.resetButton.hidden = !login;
  clearMessage(elements.authMessage);
}

function formatMoney(cents) {
  const value = BigInt(cents),
    absolute = value < 0n ? -value : value;
  return (
    (value < 0n ? "-" : "") +
    "€" +
    (absolute / 100n).toLocaleString("en-DE") +
    "," +
    String(absolute % 100n).padStart(2, "0")
  );
}

function formatDate(transaction) {
  const value =
    transaction.transaction_date ||
    transaction.booking_date ||
    transaction.value_date;
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en-GB").format(new Date(`${value}T00:00:00`));
}

async function loadTestField(user) {
  elements.testField.value = "";
  clearMessage(elements.dataMessage);
  const { data, error } = await client
    .from("user_test_data")
    .select("value")
    .eq("user_id", user.id)
    .maybeSingle();
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
  label.htmlFor = `account-name-${account.id}`;
  const input = document.createElement("input");
  input.id = label.htmlFor;
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
  toggle.addEventListener("click", () =>
    updateAccount(account.id, { is_active: !account.is_active }),
  );
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
  const version = sessionVersion;
  const request = ++accountsRequest;
  elements.accountsList.replaceChildren();
  elements.accountsList.setAttribute("aria-busy", "true");
  showMessage(elements.accountsMessage, "Loading accounts…", "loading");
  try {
    const { data, error } = await client
      .from("bank_accounts")
      .select(
        "id,source,external_key,display_name,currency,is_active,created_at,updated_at",
      )
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: true });
    if (version !== sessionVersion || request !== accountsRequest) return;
    if (error) throw error;
    clearMessage(elements.accountsMessage);
    elements.accountsList.replaceChildren(...data.map(accountCard));
    if (!data.length)
      showMessage(
        elements.accountsMessage,
        "No accounts detected yet. Import a bank CSV below to create them.",
        "empty",
      );
  } catch {
    if (version === sessionVersion && request === accountsRequest)
      showMessage(
        elements.accountsMessage,
        "Could not load accounts. Check your connection and try Refresh.",
      );
  } finally {
    if (version === sessionVersion && request === accountsRequest)
      elements.accountsList.setAttribute("aria-busy", "false");
  }
}

async function updateAccount(accountId, changes) {
  if (!client || !currentUser) return;
  if ("display_name" in changes && !changes.display_name)
    return showMessage(
      elements.accountsMessage,
      "Account name cannot be empty.",
    );
  const version = sessionVersion;
  const buttons = elements.accountsList.querySelectorAll("button");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  showMessage(elements.accountsMessage, "Updating account…", "loading");
  try {
    const { error } = await client
      .from("bank_accounts")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", accountId);
    if (version !== sessionVersion) return;
    if (error) throw error;
    await loadAccounts();
    await loadTransactions();
  } catch {
    if (version === sessionVersion)
      showMessage(
        elements.accountsMessage,
        "Could not update the account. Check your connection and try again.",
      );
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function loadTransactions() {
  if (!client || !currentUser) return;
  const version = sessionVersion;
  const request = ++transactionsRequest;
  if (!ledgerOffset) transactions = [];
  transactionState = "loading";
  renderTransactions();
  try {
    const bounds = monthBounds(navigation.month);
    const { data, error } = await client.rpc("read_transaction_ledger", {
      p_offset: ledgerOffset,
      p_limit: pageSize,
      p_status: navigation.status,
      p_search: navigation.search,
      p_account: navigation.account || null,
      p_start: bounds.start,
      p_end: bounds.end,
      p_direction: navigation.direction,
    });
    if (version !== sessionVersion || request !== transactionsRequest) return;
    if (error) throw error;
    ledger = data;
    if (ledgerOffset && ledgerOffset >= data.count) {
      ledgerOffset = 0;
      return loadTransactions();
    }
    transactions = ledgerOffset ? [...transactions, ...data.rows] : data.rows;
    transactionState = "ready";
  } catch {
    if (version !== sessionVersion || request !== transactionsRequest) return;
    transactionState = "error";
    transactionError =
      "Could not load transactions. Check your connection and try Refresh.";
  }
  renderTransactions();
}


function openAssignment(transaction) {
  assignmentTransaction = transaction;
  elements.assignTitle.textContent =
    "Assign " + (transaction.partner || transaction.description || "transaction");
  elements.assignPlan.value = "";
  clearMessage(elements.assignMessage);
  elements.assignPartner.hidden = !transaction.partner;
  elements.assignPartner.textContent = transaction.partner
    ? 'All transactions from "' + transaction.partner + '"'
    : "Create partner rule";
  elements.assignDialog.showModal();
}

function selectedPlanId() {
  const value = elements.assignPlan.value.trim();
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

async function assignCurrentTransaction(createRule = false) {
  if (!client || !currentUser || !assignmentTransaction) return;
  const planId = selectedPlanId();
  if (!planId)
    return showMessage(elements.assignMessage, "Enter a valid plan ID.");
  elements.assignOnce.disabled = true;
  elements.assignPartner.disabled = true;
  try {
    if (createRule) {
      await createPartnerRule(client, currentUser.id, assignmentTransaction, planId);
    }
    await createManualPlanMatch(
      client,
      currentUser.id,
      assignmentTransaction.id,
      planId,
    );
    elements.assignDialog.close();
    showMessage(
      elements.transactionsMessage,
      createRule
        ? "Transaction assigned and partner rule created."
        : "Transaction assigned to plan.",
      "success",
    );
  } catch (error) {
    showMessage(
      elements.assignMessage,
      error.message || "Could not assign this transaction.",
    );
  } finally {
    elements.assignOnce.disabled = false;
    elements.assignPartner.disabled = false;
  }
}

function renderTransactions() {
  clearMessage(elements.transactionsMessage);
  const filtered = transactions;
  const rows = filtered.map((transaction) => {
    const row = document.createElement("tr");
    const isNew =
      recentBatch &&
      (transaction.imports || []).some(
        (i) =>
          i.batch_id === recentBatch &&
          (i.observed_at === transaction.first_seen_at ||
            i.observed_at === transaction.booked_at),
      );
    if (isNew) {
      row.classList.add("new-transaction");
      row.setAttribute("aria-label", "New or updated transaction");
    }

    const dateCell = makeCell(formatDate(transaction));
    if (isNew) {
      const dot = document.createElement("span");
      dot.className = "new-dot";
      dot.title = "New or updated in your latest import";
      dot.setAttribute("aria-label", dot.title);
      dateCell.append(dot);
    }
    row.appendChild(dateCell);
    row.appendChild(
      makeCell(transaction.partner || transaction.description || "Unknown"),
    );
    row.appendChild(makeCell(transaction.account_name || "Account"));
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${transaction.status}`;
    badge.textContent = transaction.status;
    statusCell.appendChild(badge);
    row.appendChild(statusCell);
    row.appendChild(
      makeCell(
        formatMoney(transaction.amount_cent),
        `amount ${transaction.amount_cent >= 0 ? "positive" : "negative"}`,
      ),
    );
    const cell = document.createElement("td"),
      details = document.createElement("details"),
      summary = document.createElement("summary"),
      info = document.createElement("p");
    summary.textContent = "Details";
    info.textContent =
      "ID: " +
      transaction.id +
      " · Reference: " +
      (transaction.bank_reference || "None") +
      " · Booking: " +
      (transaction.booking_date || "None") +
      " · Value: " +
      (transaction.value_date || "None") +
      " · Purchase: " +
      (transaction.transaction_date || "None") +
      " · First seen: " +
      (transaction.first_seen_at || "Unknown") +
      " · Last seen: " +
      (transaction.last_seen_at || "Unknown") +
      " · " +
      (transaction.description || "");
    const provenance = document.createElement("p");
    provenance.textContent =
      "Imports: " +
      (transaction.imports || [])
        .map(
          (i) =>
            (i.file_name || "File") + " (" + i.batch_id + ", " + i.status + ")",
        )
        .join("; ");
    const assign = document.createElement("button");
    assign.type = "button";
    assign.className = "compact secondary transaction-assign";
    assign.textContent = "Assign";
    assign.addEventListener("click", () => openAssignment(transaction));
    details.append(summary, info, provenance);
    cell.append(details, assign);
    row.append(cell);
    return row;
  });
  elements.transactionsBody.replaceChildren(...rows);
  loadMore.hidden =
    transactionState !== "ready" || transactions.length >= ledger.count;
  loadMore.disabled = transactionState !== "ready";
  if (transactionState === "loading")
    showMessage(
      elements.transactionsMessage,
      "Loading transactions…",
      "loading",
    );
  else if (transactionState === "error")
    showMessage(elements.transactionsMessage, transactionError);
  else if (!transactions.length)
    showMessage(
      elements.transactionsMessage,
      "No transactions in this month.",
      "empty",
    );
  else if (ledger.review_count)
    showMessage(
      elements.transactionsMessage,
      ledger.review_count +
        " booked transactions await reconciliation in the import window and are excluded from these totals. Totals remain provisional.",
      "warning",
    );
  reviewImports.hidden = !ledger.review_count || transactionState !== "ready";
  elements.transactionsView.setAttribute(
    "aria-busy",
    String(transactionState === "loading"),
  );
}

function showFeature({ focus = false, load = true } = {}) {
  elements.transactionMonth.textContent = formatMonth(navigation.month);
  elements.reportVariant.value = navigation.report;
  elements.reportMessage.textContent = `${navigation.report === "settlement" ? "Settlement" : "Expense summary"} is not available yet. This report is planned.`;
  Object.entries(views).forEach(([view, id]) => {
    document.getElementById(id).hidden = view !== navigation.view;
  });
  elements.navigationLinks.forEach((link) => {
    const active = link.dataset.view === navigation.view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  retainNavigation();
  document.title = `${navigation.view[0].toUpperCase()}${navigation.view.slice(1)} · PyBudget`;
  if (focus)
    document.querySelector(`#${views[navigation.view]} h2[tabindex]`).focus();
  if (load && navigation.view === "accounts") loadAccounts();
  if (load && navigation.view === "transactions") {
    loadAccounts();
    loadTransactions();
  }
}

function renderSession(session) {
  const previousId = currentUser?.id;
  const signedIn = Boolean(session?.user);
  currentUser = session?.user || null;
  document.body.classList.toggle("signed-in", signedIn);
  elements.authView.hidden = signedIn;
  elements.dashboardView.hidden = !signedIn;
  elements.userEmail.textContent = currentUser?.email || "";
  if (previousId !== currentUser?.id) {
    sessionVersion++;
    importBusy = false;
    recentBatch = null;
    if (importDialog.open) importDialog.close();
    closeImportButton.disabled = false;
    elements.csvFile.disabled = false;
    clearMessage(importResult);
    transactions = [];
    ledgerOffset = 0;
    reviewCandidates = [];
    if (previousId) {
        navigation.month = currentMonth();
      }
    transactionState = "idle";
    elements.transactionsBody.replaceChildren();
    renderTransactions();
    elements.accountsList.replaceChildren();
    elements.reconciliationList.replaceChildren();
    elements.csvFile.value = "";
    parsedImport = null;
    elements.importPreview.hidden = true;
    elements.importButton.disabled = true;
    clearMessage(elements.importMessage);
    elements.testField.value = "";
  }
  if (currentUser) {
    if (previousId !== currentUser.id)
      loadTestField(currentUser).catch(() => {});
    showFeature({ load: previousId !== currentUser.id });
  } else document.title = "Log in · PyBudget";
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage(elements.authMessage);
  if (!client)
    return showMessage(elements.authMessage, "Supabase is not configured yet.");
  elements.submitButton.disabled = true;
  const credentials = {
    email: elements.email.value.trim(),
    password: elements.password.value,
  };
  try {
    const result =
      mode === "login"
        ? await client.auth.signInWithPassword(credentials)
        : await client.auth.signUp({
            ...credentials,
            options: {
              emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
            },
          });
    if (result.error) throw result.error;
    if (mode === "signup" && !result.data.session) {
      showMessage(
        elements.authMessage,
        "Account created. Check your email to confirm it, then log in.",
        "success",
      );
      elements.authForm.reset();
    } else renderSession(result.data.session);
  } catch (error) {
    showMessage(
      elements.authMessage,
      error.message || "Authentication failed.",
    );
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function resetPassword() {
  clearMessage(elements.authMessage);
  const email = elements.email.value.trim();
  if (!client)
    return showMessage(elements.authMessage, "Supabase is not configured yet.");
  if (!email)
    return showMessage(elements.authMessage, "Enter your email address first.");
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) return showMessage(elements.authMessage, error.message);
  showMessage(elements.authMessage, "Password-reset email sent.", "success");
}

async function handleFileSelection() {
  const request = ++fileRequest,
    version = sessionVersion;
  parsedImport = null;
  elements.importButton.disabled = true;
  elements.importPreview.hidden = true;
  clearMessage(elements.importMessage);
  const file = elements.csvFile.files?.[0];
  if (!file) return;
  try {
    const parsed = await window.PyBudgetImporter.parseComdirectFile(file);
    if (
      request !== fileRequest ||
      version !== sessionVersion ||
      !importDialog.open
    )
      return;
    parsedImport = parsed;
    elements.previewAccounts.textContent = parsedImport.accounts.length;
    elements.previewTransactions.textContent = parsedImport.transaction_count;
    elements.previewPending.textContent = parsedImport.pending_count;
    elements.previewErrors.textContent = parsedImport.errors.length;
    elements.importPreview.hidden = false;
    if (!parsedImport.accounts.length || !parsedImport.transaction_count) {
      throw new Error("No supported Comdirect transactions were found.");
    }
    elements.importButton.disabled = false;
    showMessage(
      elements.importMessage,
      `Ready to import ${parsedImport.transaction_count} transactions.`,
      "success",
    );
  } catch (error) {
    if (
      request !== fileRequest ||
      version !== sessionVersion ||
      !importDialog.open
    )
      return;
    parsedImport = null;
    showMessage(
      elements.importMessage,
      error.message || "Could not parse this CSV.",
    );
  }
}

async function resolveReview(reviewId, action, candidateId = null) {
  if (!client || !currentUser) return;
  const version = sessionVersion,
    buttons = elements.reconciliationList.querySelectorAll("button");
  buttons.forEach((b) => {
    b.disabled = true;
  });
  try {
    const { error } = await client.rpc("resolve_reconciliation_review", {
      p_review_id: reviewId,
      p_action: action,
      p_candidate_transaction_id: candidateId,
    });
    if (error) throw error;
    if (version !== sessionVersion) return;
    await Promise.all([loadReconciliationReviews(), loadTransactions()]);
  } catch {
    if (version === sessionVersion)
      showMessage(
        elements.reconciliationMessage,
        "Could not resolve this transaction. Refresh and try again.",
      );
  } finally {
    buttons.forEach((b) => {
      b.disabled = false;
    });
  }
}

function reconciliationCard(review) {
  const card = document.createElement("article");
  card.className = "account-card";
  const payload = review.booked_payload || {};
  const heading = document.createElement("div");
  heading.className = "account-card-heading";
  const info = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent =
    payload.partner || payload.description || "Booked transaction";
  const detail = document.createElement("small");
  detail.textContent = [
    payload.transaction_date || payload.booking_date || "Unknown date",
    formatMoney(Number(payload.amount_cent || 0)),
  ].join(" · ");
  info.append(title, detail);
  heading.append(info);
  card.append(heading);

  const candidates = Array.isArray(review.candidate_transaction_ids)
    ? review.candidate_transaction_ids
    : [];
  for (const id of candidates) {
    const tx = reviewCandidates.find((item) => item.id === id);
    const row = document.createElement("div");
    row.className = "review-candidate";
    const text = document.createElement("span");
    text.textContent = tx
      ? [
          formatDate(tx),
          tx.partner || tx.description || "Pending transaction",
          formatMoney(tx.amount_cent),
        ].join(" · ")
      : "Pending candidate";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "compact secondary";
    button.textContent = "Same transaction";
    button.addEventListener("click", () =>
      resolveReview(review.id, "same", id),
    );
    row.append(text, button);
    card.append(row);
  }
  const separate = document.createElement("button");
  separate.type = "button";
  separate.className = "compact secondary";
  separate.textContent = "Separate transaction";
  separate.addEventListener("click", () =>
    resolveReview(review.id, "separate"),
  );
  card.append(separate);
  return card;
}

async function loadReconciliationReviews() {
  if (!client || !currentUser) return;
  const version = sessionVersion,
    request = ++reviewRequest;
  elements.reconciliationList.replaceChildren();
  showMessage(
    elements.reconciliationMessage,
    "Loading reconciliation reviews…",
    "loading",
  );
  try {
    let reviews = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client
        .from("reconciliation_reviews")
        .select("id,booked_payload,candidate_transaction_ids,status,created_at")
        .eq("status", "open")
        .order("created_at")
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      reviews.push(...data);
      if (data.length < 500) break;
    }
    const ids = [
        ...new Set(reviews.flatMap((r) => r.candidate_transaction_ids)),
      ],
      candidates = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await client
        .from("transactions")
        .select(
          "id,status,amount_cent,booking_date,value_date,transaction_date,partner,description",
        )
        .in("id", ids.slice(offset, offset + 100));
      if (error) throw error;
      candidates.push(...data);
    }
    if (version !== sessionVersion || request !== reviewRequest) return;
    reviewCandidates = candidates;
    elements.reconciliationList.replaceChildren(
      ...reviews.map(reconciliationCard),
    );
    showMessage(
      elements.reconciliationMessage,
      reviews.length
        ? reviews.length + " transactions need review."
        : "No transactions need review.",
      reviews.length ? "warning" : "empty",
    );
  } catch {
    if (version === sessionVersion && request === reviewRequest)
      showMessage(
        elements.reconciliationMessage,
        "Could not load reconciliation reviews. Refresh and try again.",
      );
  }
}

async function importTransactions() {
  if (!client || !currentUser || !parsedImport) return;
  const version = sessionVersion;
  importBusy = true;
  closeImportButton.disabled = true;
  elements.csvFile.disabled = true;
  elements.importButton.disabled = true;
  showMessage(
    elements.importMessage,
    "Importing and reconciling transactions…",
    "loading",
  );
  try {
    const { data, error } = await client.rpc("import_comdirect_transactions", {
      p_file_name: parsedImport.file_name,
      p_file_sha256: parsedImport.file_sha256,
      p_period_start: parsedImport.period_start,
      p_period_end: parsedImport.period_end,
      p_accounts: parsedImport.accounts,
    });
    if (version !== sessionVersion) return;
    if (error) throw error;
    const ruleResult = await applyRulesAfterImport(client, data);
    if (version !== sessionVersion) return;
    const prefix = data.already_imported
      ? "This exact file was already imported."
      : "Import complete.";
    const reviewCount = Number(data.needs_review || 0);
    const reviewText = reviewCount ? ", needs review " + reviewCount : "";
    const ruleText = ruleResult.skipped || !ruleResult.matched
      ? ""
      : ", rule-matched " + ruleResult.matched;
    const rejectionText = (data.errors || [])
      .slice(0, 5)
      .map((e) => "Row " + e.row + ": " + e.reason)
      .join("; ");
    showMessage(
      elements.importMessage,
      prefix +
        " Added " +
        data.inserted +
        ", reconciled " +
        data.reconciled +
        ", skipped " +
        data.duplicates +
        ", rejected " +
        data.rejected +
        reviewText +
        ruleText +
        "." +
        (rejectionText ? " " + rejectionText : ""),
      reviewCount ? "warning" : "success",
    );
    recentBatch = data.already_imported ? null : data.batch_id;
    showMessage(
      importResult,
      elements.importMessage.textContent +
        (recentBatch
          ? " New and updated transactions are marked with a dot."
          : ""),
      reviewCount || data.rejected ? "warning" : "success",
    );
    navigation.view = "transactions";
    navigation.month = currentMonth();
    navigation.direction = "all";
    ledgerOffset = 0;
    importBusy = false;
    importDialog.close();
    showFeature({ focus: true, load: false });
    await Promise.all([loadTransactions(), loadAccounts()]);
  } catch {
    if (version === sessionVersion)
      showMessage(
        elements.importMessage,
        "Could not import transactions. Check your connection and try again. Retrying the same file is safe.",
      );
  } finally {
    if (version === sessionVersion) {
      importBusy = false;
      closeImportButton.disabled = false;
      elements.csvFile.disabled = false;
      elements.importButton.disabled = !parsedImport;
    }
  }
}

function resetImportWindow() {
  fileRequest++;
  parsedImport = null;
  elements.csvFile.value = "";
  elements.importPreview.hidden = true;
  elements.importButton.disabled = true;
  clearMessage(elements.importMessage);
}
function openImportWindow() {
  if (!currentUser || importBusy) return;
  navigation.view = "transactions";
  showFeature({ load: false });
  loadAccounts();
  loadTransactions();
  resetImportWindow();
  importDialog.showModal();
  loadReconciliationReviews();
  closeImportButton.focus();
}
document
  .querySelectorAll("[data-open-import]")
  .forEach((button) => button.addEventListener("click", openImportWindow));
closeImportButton.addEventListener("click", () => {
  if (!importBusy) importDialog.close();
});
importDialog.addEventListener("cancel", (event) => {
  if (importBusy) event.preventDefault();
});
importDialog.addEventListener("close", () => {
  resetImportWindow();
  if (currentUser && navigation.view === "transactions")
    document.querySelector("#transactions-title").focus();
});

elements.loginTab.addEventListener("click", () => setMode("login"));
elements.signupTab.addEventListener("click", () => setMode("signup"));
elements.authForm.addEventListener("submit", handleSubmit);
elements.resetButton.addEventListener("click", resetPassword);
window.addEventListener("hashchange", () => {
  navigation = readNavigation();
  ledgerOffset = 0;
  if (currentUser) showFeature({ focus: true });
});
function changeMonth(offset) {
  navigation.month = shiftMonth(navigation.month, offset);
  ledgerOffset = 0;
  showFeature({ load: false });
  loadTransactions();
}
elements.previousMonth.addEventListener("click", () => changeMonth(-1));
elements.nextMonth.addEventListener("click", () => changeMonth(1));
loadMore.addEventListener("click", () => {
  ledgerOffset = transactions.length;
  loadTransactions();
});
elements.reportVariant.addEventListener("change", () => {
  navigation.report = elements.reportVariant.value;
  showFeature({ load: false });
});
elements.refreshAccounts.addEventListener("click", loadAccounts);
elements.csvFile.addEventListener("change", handleFileSelection);
elements.importButton.addEventListener("click", importTransactions);
elements.refreshReconciliation.addEventListener(
  "click",
  loadReconciliationReviews,
);
elements.testFieldForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client || !currentUser) return;
  elements.saveFieldButton.disabled = true;
  clearMessage(elements.dataMessage);
  const { error } = await client.from("user_test_data").upsert(
    {
      user_id: currentUser.id,
      value: elements.testField.value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  elements.saveFieldButton.disabled = false;
  if (error) return showMessage(elements.dataMessage, error.message);
  showMessage(elements.dataMessage, "Saved privately to Supabase.", "success");
});
elements.logoutButton.addEventListener("click", async () => {
  elements.logoutButton.disabled = true;
  try {
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }
    retainNavigation();
    renderSession(null);
  } catch {
    window.alert("Could not log out. Check your connection and try again.");
  } finally {
    elements.logoutButton.disabled = false;
  }
});

if (!configured) {
  elements.setupWarning.hidden = false;
  renderSession(null);
} else {
  client.auth.getSession().then(({ data }) => renderSession(data.session));
  client.auth.onAuthStateChange((_event, session) => renderSession(session));
}

elements.assignOnce.addEventListener("click", () => assignCurrentTransaction(false));
elements.assignPartner.addEventListener("click", () => assignCurrentTransaction(true));
elements.closeAssign.addEventListener("click", () => elements.assignDialog.close());
elements.assignDialog.addEventListener("close", () => {
  assignmentTransaction = null;
  clearMessage(elements.assignMessage);
});
