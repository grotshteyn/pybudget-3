const config = window.PYBUDGET_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.startsWith("YOUR_"));
const client = configured ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
const $ = (selector) => document.querySelector(selector);
const elements = Object.fromEntries([
  "setup-warning","auth-view","dashboard-view","auth-form","login-tab","signup-tab","form-title","form-subtitle","email","password","submit-button","reset-button","auth-message","user-email","logout-button",
  "import-menu-button","planning-menu-button","transactions-menu-button","import-view","planning-view","transactions-view","refresh-accounts","accounts-list","accounts-message","csv-file","import-preview","preview-accounts","preview-transactions","preview-pending","preview-errors","import-button","import-message","refresh-transactions","transactions-body","transactions-message","booked-total","pending-total","combined-total",
  "refresh-planning","planned-expected-total","planned-realized-total","planned-count","plan-form","plan-name","plan-amount","plan-timing","plan-recurrence","plan-start","plan-end","plan-end-field","plan-frequency","plan-frequency-field","plan-interval","plan-interval-field","create-plan-button","plan-message","planning-message","plans-list","test-field-form","test-field","save-field-button","data-message"
].map((id) => [id.replaceAll("-", "_"), $(`#${id}`)]));

let mode = "login", currentUser = null, parsedImport = null;
const showMessage = (el, text, type = "error") => { el.textContent = text; el.className = `notice ${type}`; el.hidden = false; };
const clearMessage = (el) => { el.hidden = true; el.textContent = ""; };
const money = (cents) => new Intl.NumberFormat("en-DE", { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
const displayDate = (value) => value ? new Intl.DateTimeFormat("en-GB").format(new Date(`${value}T00:00:00`)) : "Pending";

function setMode(next) {
  mode = next; const login = mode === "login";
  elements.login_tab.classList.toggle("active", login); elements.signup_tab.classList.toggle("active", !login);
  elements.form_title.textContent = login ? "Welcome back" : "Create your account";
  elements.form_subtitle.textContent = login ? "Log in to continue to PyBudget." : "Start with a secure PyBudget account.";
  elements.submit_button.textContent = login ? "Log in" : "Create account"; elements.reset_button.hidden = !login;
  clearMessage(elements.auth_message);
}

async function handleAuth(event) {
  event.preventDefault(); clearMessage(elements.auth_message); elements.submit_button.disabled = true;
  const credentials = { email: elements.email.value.trim(), password: elements.password.value };
  const result = mode === "login" ? await client.auth.signInWithPassword(credentials) : await client.auth.signUp({ ...credentials, options: { emailRedirectTo: `${location.origin}${location.pathname}` } });
  elements.submit_button.disabled = false;
  if (result.error) return showMessage(elements.auth_message, result.error.message);
  if (!result.data.session) showMessage(elements.auth_message, "Check your email to confirm your account.", "success");
}

function accountCard(account) {
  const form = document.createElement("form"); form.className = "account-card";
  form.innerHTML = `<div class="account-card-heading"><div><span class="account-source"></span><small></small></div><span class="account-state"></span></div><label>Display name</label><input maxlength="80" required><div class="account-actions"><button class="compact primary">Save name</button><button class="compact secondary" type="button"></button></div>`;
  form.querySelector(".account-source").textContent = account.source; form.querySelector("small").textContent = account.external_key;
  const state = form.querySelector(".account-state"); state.className = `account-state ${account.is_active ? "active" : "archived"}`; state.textContent = account.is_active ? "Active" : "Archived";
  const input = form.querySelector("input"); input.value = account.display_name; const toggle = form.querySelector("button[type=button]"); toggle.textContent = account.is_active ? "Archive" : "Reactivate";
  form.addEventListener("submit", (e) => { e.preventDefault(); updateAccount(account.id, { display_name: input.value.trim() }); });
  toggle.addEventListener("click", () => updateAccount(account.id, { is_active: !account.is_active })); return form;
}

async function loadAccounts() {
  clearMessage(elements.accounts_message); const { data, error } = await client.from("bank_accounts").select("*").order("is_active", { ascending: false }).order("created_at");
  if (error) return showMessage(elements.accounts_message, error.message); elements.accounts_list.replaceChildren(...data.map(accountCard));
  if (!data.length) showMessage(elements.accounts_message, "No accounts yet. Import a CSV below.", "success");
}
async function updateAccount(id, changes) { const { error } = await client.from("bank_accounts").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id); if (error) return showMessage(elements.accounts_message, error.message); await loadAccounts(); }

async function loadTransactions() {
  clearMessage(elements.transactions_message); const { data, error } = await client.from("transactions").select("id,status,amount_cent,booking_date,value_date,transaction_date,partner,description,bank_accounts(display_name)").order("booking_date", { ascending: false, nullsFirst: true }).limit(200);
  if (error) return showMessage(elements.transactions_message, error.message); let booked = 0, pending = 0;
  const rows = data.map((t) => { if (t.status === "booked") booked += Number(t.amount_cent); else pending += Number(t.amount_cent); const tr = document.createElement("tr"); [displayDate(t.booking_date || t.transaction_date || t.value_date), t.partner || t.description || "Unknown", t.bank_accounts?.display_name || "Account", t.status, money(t.amount_cent)].forEach((value, i) => { const td = document.createElement("td"); td.textContent = value; if (i === 4) td.className = `amount ${t.amount_cent >= 0 ? "positive" : "negative"}`; tr.append(td); }); return tr; });
  elements.transactions_body.replaceChildren(...rows); elements.booked_total.textContent = money(booked); elements.pending_total.textContent = money(pending); elements.combined_total.textContent = money(booked + pending);
}

const iso = (date) => date.toISOString().slice(0, 10);
const parseDate = (value) => new Date(`${value}T12:00:00Z`);
function addPeriod(date, frequency, count) { const next = new Date(date); if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7 * count); else if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + count); else if (frequency === "quarterly") next.setUTCMonth(next.getUTCMonth() + 3 * count); else next.setUTCFullYear(next.getUTCFullYear() + count); return next; }
function dayBefore(date) { const result = new Date(date); result.setUTCDate(result.getUTCDate() - 1); return result; }
function generateOccurrences(plan) {
  const start = parseDate(plan.starts_on), end = plan.ends_on ? parseDate(plan.ends_on) : null;
  if (plan.recurrence_mode === "one_off") return [{ period_start: plan.starts_on, period_end: plan.timing_mode === "distributed" ? plan.ends_on : plan.starts_on, expected_on: plan.timing_mode === "discrete" ? plan.starts_on : null }];
  const horizon = new Date(); horizon.setUTCMonth(horizon.getUTCMonth() + 18); const limit = end && end < horizon ? end : horizon; const rows = []; let cursor = start;
  while (cursor <= limit && rows.length < 250) { const next = addPeriod(cursor, plan.frequency, plan.interval_count); rows.push({ period_start: iso(cursor), period_end: plan.timing_mode === "distributed" ? iso(end && dayBefore(next) > end ? end : dayBefore(next)) : iso(cursor), expected_on: plan.timing_mode === "discrete" ? iso(cursor) : null }); cursor = next; }
  return rows;
}

function updatePlanFields() {
  const recurring = elements.plan_recurrence.value === "recurring", distributedOneOff = elements.plan_timing.value === "distributed" && !recurring;
  elements.plan_frequency_field.hidden = !recurring; elements.plan_interval_field.hidden = !recurring; elements.plan_end_field.hidden = !distributedOneOff && !recurring; elements.plan_end.required = distributedOneOff;
}

async function createPlan(event) {
  event.preventDefault(); clearMessage(elements.plan_message); const cents = Math.round(Number(elements.plan_amount.value) * 100);
  const plan = { user_id: currentUser.id, name: elements.plan_name.value.trim(), timing_mode: elements.plan_timing.value, recurrence_mode: elements.plan_recurrence.value, planned_amount_cent: cents, currency: "EUR", starts_on: elements.plan_start.value, ends_on: elements.plan_end.value || null, frequency: elements.plan_recurrence.value === "recurring" ? elements.plan_frequency.value : null, interval_count: elements.plan_recurrence.value === "recurring" ? Number(elements.plan_interval.value) : 1 };
  if (!plan.name || cents < 1) return showMessage(elements.plan_message, "Enter a name and a positive amount.");
  elements.create_plan_button.disabled = true; const { data, error } = await client.from("expense_plans").insert(plan).select().single();
  if (error) { elements.create_plan_button.disabled = false; return showMessage(elements.plan_message, error.message); }
  const occurrences = generateOccurrences(data).map((row) => ({ ...row, user_id: currentUser.id, plan_id: data.id, planned_amount_cent: cents, currency: "EUR" }));
  const inserted = await client.from("expense_plan_occurrences").insert(occurrences); elements.create_plan_button.disabled = false;
  if (inserted.error) { await client.from("expense_plans").delete().eq("id", data.id); return showMessage(elements.plan_message, inserted.error.message); }
  elements.plan_form.reset(); elements.plan_start.value = iso(new Date()); updatePlanFields(); showMessage(elements.plan_message, `Plan created with ${occurrences.length} scheduled occurrence${occurrences.length === 1 ? "" : "s"}.`, "success"); await loadPlanning();
}

async function setOccurrenceStatus(id, status) { const { error } = await client.from("expense_plan_occurrences").update({ status, realized_at: status === "realized" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", id); if (error) return showMessage(elements.planning_message, error.message); await loadPlanning(); }
async function togglePlan(id, active) { const { error } = await client.from("expense_plans").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id); if (error) return showMessage(elements.planning_message, error.message); await loadPlanning(); }

function planCard(plan) {
  const section = document.createElement("article"); section.className = `plan-card ${plan.is_active ? "" : "inactive"}`;
  const timing = plan.timing_mode === "discrete" ? "Single expense" : "Spending budget", recurrence = plan.recurrence_mode === "one_off" ? "One-off" : `Every ${plan.interval_count > 1 ? `${plan.interval_count} ` : ""}${plan.frequency}`;
  section.innerHTML = `<div class="plan-heading"><div><h3></h3><p class="plan-meta"></p></div><button class="compact secondary" type="button"></button></div><div class="occurrence-list"></div>`;
  section.querySelector("h3").textContent = plan.name; section.querySelector(".plan-meta").textContent = `${timing} · ${recurrence} · ${money(plan.planned_amount_cent)}`;
  const toggle = section.querySelector("button"); toggle.textContent = plan.is_active ? "Pause" : "Reactivate"; toggle.addEventListener("click", () => togglePlan(plan.id, !plan.is_active));
  const list = section.querySelector(".occurrence-list");
  plan.expense_plan_occurrences.forEach((o) => { const row = document.createElement("div"); row.className = "occurrence-row"; const range = o.period_start === o.period_end ? displayDate(o.period_start) : `${displayDate(o.period_start)} – ${displayDate(o.period_end)}`; row.innerHTML = `<div><strong></strong><span></span></div><div class="status-actions"></div>`; row.querySelector("strong").textContent = money(o.planned_amount_cent); row.querySelector("span").textContent = range; ["expected","realized","cancelled"].forEach((status) => { const button = document.createElement("button"); button.type = "button"; button.className = `status-choice ${status === o.status ? "active" : ""}`; button.textContent = status[0].toUpperCase() + status.slice(1); button.addEventListener("click", () => setOccurrenceStatus(o.id, status)); row.querySelector(".status-actions").append(button); }); list.append(row); });
  return section;
}

async function loadPlanning() {
  clearMessage(elements.planning_message); const { data, error } = await client.from("expense_plans").select("*,expense_plan_occurrences(*)").order("created_at", { ascending: false });
  if (error) return showMessage(elements.planning_message, error.message); let expected = 0, realized = 0, count = 0;
  data.forEach((plan) => { plan.expense_plan_occurrences.sort((a,b) => a.period_start.localeCompare(b.period_start)); plan.expense_plan_occurrences.forEach((o) => { if (o.status === "expected" && plan.is_active) { expected += Number(o.planned_amount_cent); count++; } if (o.status === "realized") realized += Number(o.planned_amount_cent); }); });
  elements.planned_expected_total.textContent = money(expected); elements.planned_realized_total.textContent = money(realized); elements.planned_count.textContent = count; elements.plans_list.replaceChildren(...data.map(planCard)); if (!data.length) showMessage(elements.planning_message, "No plans yet. Create your first one above.", "success");
}

function showFeature(feature) { ["import","planning","transactions"].forEach((name) => { elements[`${name}_view`].hidden = name !== feature; elements[`${name}_menu_button`].classList.toggle("active", name === feature); }); if (feature === "import") loadAccounts(); if (feature === "planning") loadPlanning(); if (feature === "transactions") loadTransactions(); }
function renderSession(session) { currentUser = session?.user || null; const signedIn = Boolean(currentUser); document.body.classList.toggle("signed-in", signedIn); elements.auth_view.hidden = signedIn; elements.dashboard_view.hidden = !signedIn; elements.user_email.textContent = currentUser?.email || ""; if (signedIn) showFeature("import"); }

async function handleFile() { parsedImport = null; elements.import_button.disabled = true; elements.import_preview.hidden = true; const file = elements.csv_file.files?.[0]; if (!file) return; try { parsedImport = await window.PyBudgetImporter.parseComdirectFile(file); elements.preview_accounts.textContent = parsedImport.accounts.length; elements.preview_transactions.textContent = parsedImport.transaction_count; elements.preview_pending.textContent = parsedImport.pending_count; elements.preview_errors.textContent = parsedImport.errors.length; elements.import_preview.hidden = false; elements.import_button.disabled = false; } catch (e) { showMessage(elements.import_message, e.message); } }
async function importTransactions() { elements.import_button.disabled = true; const { data, error } = await client.rpc("import_comdirect_transactions", { p_file_name: parsedImport.file_name, p_file_sha256: parsedImport.file_sha256, p_period_start: parsedImport.period_start, p_period_end: parsedImport.period_end, p_accounts: parsedImport.accounts }); elements.import_button.disabled = false; if (error) return showMessage(elements.import_message, error.message); showMessage(elements.import_message, `Added ${data.inserted}, reconciled ${data.reconciled}, skipped ${data.duplicates}.`, "success"); }

elements.login_tab.onclick = () => setMode("login"); elements.signup_tab.onclick = () => setMode("signup"); elements.auth_form.onsubmit = handleAuth;
elements.reset_button.onclick = async () => { const { error } = await client.auth.resetPasswordForEmail(elements.email.value.trim(), { redirectTo: `${location.origin}${location.pathname}` }); showMessage(elements.auth_message, error ? error.message : "Password reset email sent.", error ? "error" : "success"); };
elements.logout_button.onclick = () => client.auth.signOut(); elements.import_menu_button.onclick = () => showFeature("import"); elements.planning_menu_button.onclick = () => showFeature("planning"); elements.transactions_menu_button.onclick = () => showFeature("transactions"); elements.refresh_accounts.onclick = loadAccounts; elements.refresh_transactions.onclick = loadTransactions; elements.refresh_planning.onclick = loadPlanning; elements.csv_file.onchange = handleFile; elements.import_button.onclick = importTransactions; elements.plan_form.onsubmit = createPlan; elements.plan_timing.onchange = updatePlanFields; elements.plan_recurrence.onchange = updatePlanFields;
elements.plan_start.value = iso(new Date()); updatePlanFields();
if (!configured) { elements.setup_warning.hidden = false; renderSession(null); } else { client.auth.getSession().then(({ data }) => renderSession(data.session)); client.auth.onAuthStateChange((_event, session) => renderSession(session)); }
