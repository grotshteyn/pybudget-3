import { loadMonthFinancialReadModel } from "./plan-read-model.js";
import { createPlanGroup, deletePlanGroup, loadPlanGroups, movePlanToGroup, updatePlanGroup, validParentGroups } from "./plan-group-service.js";
import { applyRulesAfterImport } from "./rule-import-orchestrator.js";
import { applyAutomaticRules } from "./rule-service.js";
import { allocateTransaction, applyPartnerRuleToExistingTransactions, createManualPlanMatch, createPartnerRule, unallocateTransaction } from "./rule-actions.js";

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
  planMonth: document.querySelector("#plan-month"),
  previousPlanMonth: document.querySelector("#previous-plan-month"),
  nextPlanMonth: document.querySelector("#next-plan-month"),
  plansMessage: document.querySelector("#plans-message"),
  expensePlans: document.querySelector("#expense-plans"),
  incomePlans: document.querySelector("#income-plans"),
  workspaceBreadcrumb: document.querySelector("#workspace-breadcrumb"),
  workspaceGroups: document.querySelector("#workspace-groups"),
  workspaceOccurrences: document.querySelector("#workspace-occurrences"),
  addPlan: document.querySelector("#add-plan"),
  manageGroups: document.querySelector("#manage-groups"),
  groupDialog: document.querySelector("#group-dialog"),
  groupForm: document.querySelector("#group-form"),
  groupId: document.querySelector("#group-id"),
  groupName: document.querySelector("#group-name"),
  groupParent: document.querySelector("#group-parent"),
  groupOrder: document.querySelector("#group-order"),
  groupList: document.querySelector("#group-list"),
  groupFormMessage: document.querySelector("#group-form-message"),
  closeGroups: document.querySelector("#close-groups"),
  deleteGroup: document.querySelector("#delete-group"),
  newGroup: document.querySelector("#new-group"),
  planDialog: document.querySelector("#plan-dialog"),
  planForm: document.querySelector("#plan-form"),
  planDialogTitle: document.querySelector("#plan-dialog-title"),
  planId: document.querySelector("#plan-id"),
  planName: document.querySelector("#plan-name"),
  planAmount: document.querySelector("#plan-amount"),
  planDirection: document.querySelector("#plan-direction"),
  planGroup: document.querySelector("#plan-group"),
  planSchedule: document.querySelector("#plan-schedule"),
  planStart: document.querySelector("#plan-start"),
  planEnd: document.querySelector("#plan-end"),
  planFormMessage: document.querySelector("#plan-form-message"),
  deactivatePlan: document.querySelector("#deactivate-plan"),
  closePlan: document.querySelector("#close-plan"),
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
  assignAmount: document.querySelector("#assign-amount"),
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
let planGroups = [];
let activePlanGroupId = null;
let transactionState = "idle";
let transactionError = "";
let sessionVersion = 0;
let accountsRequest = 0;
let transactionsRequest = 0;
let fileRequest = 0;
const views = {
  overview: "overview-view",
  transactions: "transactions-view",
  plans: "plans-view",
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


async function openAssignment(transaction) {
  assignmentTransaction = transaction;
  elements.assignTitle.textContent =
    "Assign " + (transaction.partner || transaction.description || "transaction");
  elements.assignPlan.replaceChildren();
  elements.assignAmount.value = (Math.abs(Number(transaction.amount_cent)) / 100).toFixed(2);
  clearMessage(elements.assignMessage);
  elements.assignPartner.hidden = !transaction.partner;
  elements.assignPartner.textContent = transaction.partner
    ? 'All transactions from "' + transaction.partner + '"'
    : "Create partner rule";
  elements.assignDialog.showModal();
  const { data, error } = await client
    .from("plans")
    .select("id,name,direction")
    .eq("is_active", true)
    .order("name");
  if (assignmentTransaction !== transaction) return;
  if (error) return showMessage(elements.assignMessage, "Could not load plans.");
  (data || []).forEach((plan) => {
    const option = document.createElement("option");
    option.value = plan.id;
    option.textContent = plan.name;
    elements.assignPlan.append(option);
  });
  if (!data?.length) showMessage(elements.assignMessage, "Create a plan first.");
}

function selectedPlanId() {
  return elements.assignPlan.value || null;
}

async function assignCurrentTransaction(createRule = false) {
  if (!client || !currentUser || !assignmentTransaction) return;
  const planId = selectedPlanId();
  if (!planId)
    return showMessage(elements.assignMessage, "Enter a valid plan ID.");
  elements.assignOnce.disabled = true;
  elements.assignPartner.disabled = true;
  try {
    const amountCent = Math.round(Number(elements.assignAmount.value) * 100);
    if (!Number.isInteger(amountCent) || amountCent <= 0)
      throw new Error("Enter a positive allocation amount.");
    let partnerRule = null;
    if (createRule) {
      partnerRule = await createPartnerRule(client, currentUser.id, assignmentTransaction, planId);
    }
    await createManualPlanMatch(
      client,
      currentUser.id,
      assignmentTransaction.id,
      planId,
      amountCent,
    );
    if (partnerRule) {
      try {
        await applyPartnerRuleToExistingTransactions(
          client,
          partnerRule,
          assignmentTransaction.partner,
          applyAutomaticRules,
        );
      } catch (ruleError) {
        console.error("Partner rule created, but bulk application failed.", ruleError);
      }
    }
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

function fillGroupSelect(select, selected = "", groups = planGroups) {
  select.replaceChildren();
  const root = document.createElement("option"); root.value = ""; root.textContent = "Root"; select.append(root);
  groups.forEach((group) => { const option=document.createElement("option"); option.value=group.id; option.textContent=group.name; select.append(option); });
  select.value = selected || "";
}
async function refreshPlanGroups() {
  planGroups = await loadPlanGroups(client);
  return planGroups;
}
function resetGroupEditor(group = null) {
  elements.groupId.value=group?.id||""; elements.groupName.value=group?.name||""; elements.groupOrder.value=group?.sort_order??0;
  fillGroupSelect(elements.groupParent, group?.parent_group_id||"", validParentGroups(planGroups, group?.id||null));
  elements.deleteGroup.hidden=!group; clearMessage(elements.groupFormMessage);
}
function renderGroupManager() {
  elements.groupList.replaceChildren(...planGroups.map((group)=>{
    const row=document.createElement("button"); row.type="button"; row.className="account-card"; row.textContent=group.name;
    row.addEventListener("click",()=>resetGroupEditor(group)); return row;
  }));
}
async function openGroupManager() {
  try { await refreshPlanGroups(); resetGroupEditor(); renderGroupManager(); elements.groupDialog.showModal(); }
  catch { showMessage(elements.plansMessage,"Could not load groups."); }
}
async function saveGroup(event) {
  event.preventDefault();
  try {
    const values={name:elements.groupName.value,parent_group_id:elements.groupParent.value||null,sort_order:Number(elements.groupOrder.value||0)};
    if(elements.groupId.value) await updatePlanGroup(client,elements.groupId.value,values);
    else await createPlanGroup(client,currentUser.id,values);
    await refreshPlanGroups(); renderGroupManager(); resetGroupEditor(); await loadPlans();
  } catch(error) { showMessage(elements.groupFormMessage,error.message||"Could not save group."); }
}
async function removeGroup() {
  if(!elements.groupId.value) return;
  try { await deletePlanGroup(client,elements.groupId.value); await refreshPlanGroups(); renderGroupManager(); resetGroupEditor(); await loadPlans(); }
  catch(error) { showMessage(elements.groupFormMessage,error.message||"Could not delete group."); }
}

function openPlanEditor(plan = null) {
  elements.planForm.reset();
  clearMessage(elements.planFormMessage);
  elements.planId.value = plan?.id || plan?.plan_id || "";
  elements.planDialogTitle.textContent = plan ? "Edit plan" : "Add plan";
  elements.planName.value = plan?.name || "";
  elements.planAmount.value = plan ? (Number(plan.amount_cent) / 100).toFixed(2) : "";
  elements.planDirection.value = plan?.direction || "expense";
  fillGroupSelect(elements.planGroup, plan?.group_id || "");
  elements.planSchedule.value = plan?.schedule_type || "monthly";
  elements.planStart.value = plan?.start_date || `${navigation.month}-01`;
  elements.planEnd.value = plan?.end_date || "";
  elements.deactivatePlan.hidden = !plan;
  elements.planDialog.showModal();
}
async function savePlan(event) {
  event.preventDefault();
  const amountCent = Math.round(Number(elements.planAmount.value) * 100);
  if (!elements.planName.value.trim() || !Number.isInteger(amountCent) || amountCent <= 0)
    return showMessage(elements.planFormMessage, "Enter a name and a positive amount.");
  if (elements.planEnd.value && elements.planEnd.value < elements.planStart.value)
    return showMessage(elements.planFormMessage, "End date cannot be before start date.");
  const values = {
    name: elements.planName.value.trim(),
    amount_cent: amountCent,
    direction: elements.planDirection.value,
    group_id: elements.planGroup.value || null,
    schedule_type: elements.planSchedule.value,
    start_date: elements.planStart.value,
    end_date: elements.planEnd.value || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  let query = elements.planId.value
    ? client.from("plans").update(values).eq("id", elements.planId.value)
    : client.from("plans").insert({ ...values, user_id: currentUser.id });
  const { error } = await query;
  if (error) return showMessage(elements.planFormMessage, error.message || "Could not save plan.");
  elements.planDialog.close();
  await loadPlans();
}
async function deactivatePlan() {
  if (!elements.planId.value) return;
  const { error } = await client.from("plans").update({
    is_active: false,
    updated_at: new Date().toISOString(),
  }).eq("id", elements.planId.value);
  if (error) return showMessage(elements.planFormMessage, error.message || "Could not deactivate plan.");
  elements.planDialog.close();
  await loadPlans();
}

async function loadPlans() {
  if (!client || !currentUser) return;
  showMessage(elements.plansMessage, "Loading plans…", "loading");
  try {
    const model = await loadMonthFinancialReadModel(client, navigation.month);
    planGroups = model.groups;
    if (activePlanGroupId && !model.groups.some((g) => g.id === activePlanGroupId)) activePlanGroupId = null;
    renderPlanWorkspace(model);
    clearMessage(elements.plansMessage);
  } catch (error) {
    console.error(error);
    showMessage(elements.plansMessage, "Could not load plans.");
  }
}
function renderPlanWorkspace(model) {
  const level = model.level(activePlanGroupId);
  elements.expensePlans.replaceChildren();
  elements.incomePlans.replaceChildren();
  elements.workspaceGroups.replaceChildren();
  elements.workspaceOccurrences.replaceChildren();
  elements.workspaceBreadcrumb.replaceChildren();
  const root=document.createElement("button"); root.type="button"; root.className="text-button"; root.textContent="Plans";
  root.addEventListener("click",()=>{activePlanGroupId=null;renderPlanWorkspace(model);}); elements.workspaceBreadcrumb.append(root);
  if(activePlanGroupId){
    const byId=new Map(model.groups.map(g=>[g.id,g])), trail=[]; let cursor=byId.get(activePlanGroupId);
    while(cursor){trail.unshift(cursor); cursor=cursor.parent_group_id?byId.get(cursor.parent_group_id):null;}
    trail.forEach((group,index)=>{const sep=document.createElement("span");sep.textContent=" / ";elements.workspaceBreadcrumb.append(sep);const crumb=document.createElement("button");crumb.type="button";crumb.className="text-button";crumb.textContent=group.name;crumb.setAttribute("aria-current",index===trail.length-1?"location":"false");crumb.addEventListener("click",()=>{activePlanGroupId=group.id;renderPlanWorkspace(model);});elements.workspaceBreadcrumb.append(crumb);});
  }
  level.groups.forEach((group)=>{
    const row=document.createElement("button"); row.type="button"; row.className="account-card plan-row group-row";
    const name=document.createElement("strong"); name.textContent=group.name;
    const state=document.createElement("span");
    state.textContent=`Earmarked ${formatMoney(group.expense_earmarked_cent)} · Overrun ${formatMoney(group.expense_overrun_cent)}`+
      (group.income_receivable_cent||group.income_windfall_cent?` · Receivable ${formatMoney(group.income_receivable_cent)} · Windfall ${formatMoney(group.income_windfall_cent)}`:"");
    row.append(name,state); row.addEventListener("click",()=>{activePlanGroupId=group.id;renderPlanWorkspace(model);}); elements.workspaceGroups.append(row);
  });
  level.occurrences.forEach((item)=>{
    const details=document.createElement("details"); details.className=`account-card plan-row occurrence-row ${item.materialized?"materialized":"planned"}`;
    const summary=document.createElement("summary"); const name=document.createElement("strong"); const marker=document.createElement("span"); marker.className="occurrence-marker"; marker.setAttribute("aria-hidden","true"); marker.textContent=item.materialized?"●":"○"; name.append(marker, document.createTextNode(` ${item.name} · ${item.occurrence_date}`));
    const state=document.createElement("span");
    state.textContent=item.direction==="expense"
      ? `${formatMoney(item.planned_cent)} · Earmarked ${formatMoney(item.earmarked_cent)} · Overrun ${formatMoney(item.overrun_cent)}`
      : `${formatMoney(item.planned_cent)} · Receivable ${formatMoney(item.receivable_cent)} · Windfall ${formatMoney(item.windfall_cent)}`;
    summary.append(name,state); details.append(summary);
    item.matched_transactions.forEach((tx)=>{const line=document.createElement("div"); line.className="assignment-actions matched-transaction"; const label=document.createElement("span"); label.textContent=`${tx.partner||tx.description||"Transaction"} · ${formatMoney(tx.allocated_amount_cent)}`; line.append(label); details.append(line);});
    elements.workspaceOccurrences.append(details);
  });
  if(!level.groups.length&&!level.occurrences.length){const empty=document.createElement("p"); empty.className="muted"; empty.textContent="Nothing planned at this level for this month."; elements.workspaceOccurrences.append(empty);}
}

