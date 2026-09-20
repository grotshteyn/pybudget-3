const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// All data and authentication are synthetic. No external requests are permitted.
function mockSupabase() {
  const user = { id: "synthetic-user", email: "test@example.invalid" };
  const state = (window.fixture = {
    rows: [
      {
        id: "t1",
        status: "booked",
        amount_cent: 10000,
        booking_date: "2026-09-12",
        partner: "Example salary",
        description: "Income",
        bank_accounts: { display_name: "Example account" },
      },
      {
        id: "t2",
        status: "pending",
        amount_cent: -2000,
        booking_date: "2026-09-13",
        partner: "Example shop",
        description: "Card purchase",
        bank_accounts: { display_name: "Example account" },
      },
    ],
    accounts: [
      {
        id: "a1",
        source: "comdirect",
        external_key: "synthetic-account",
        display_name: "Example account",
        is_active: true,
      },
    ],
    plans: [
      { id: "p1", plan_id: "p1", name: "Groceries", group_id: "g1", occurrence_date: "2026-09-01", amount_cent: 50000, direction: "expense", schedule_type: "monthly", start_date: "2026-01-01", end_date: null, is_active: true },
      { id: "p2", plan_id: "p2", name: "Salary", group_id: null, occurrence_date: "2026-09-01", amount_cent: 300000, direction: "income", schedule_type: "monthly", start_date: "2026-01-01", end_date: null, is_active: true },
      { id: "p3", plan_id: "p3", name: "Weekly fun", group_id: null, occurrence_date: "2026-09-01", amount_cent: 1000, direction: "expense", schedule_type: "weekly", start_date: "2026-09-01", end_date: null, is_active: true },
      { id: "p3", plan_id: "p3", name: "Weekly fun", group_id: null, occurrence_date: "2026-09-08", amount_cent: 1000, direction: "expense", schedule_type: "weekly", start_date: "2026-09-01", end_date: null, is_active: true },
    ],
    groups: [
      { id: "g1", name: "Household", parent_group_id: null, sort_order: 0 },
    ],
    allocations: [
      { id: "alloc-1", plan_id: "p1", transaction_id: "t2", amount_cent: 2000, source: "manual", rule_id: null, transactions: { id: "t2", status: "pending", amount_cent: -2000, transaction_date: null, booking_date: "2026-09-13", value_date: null, partner: "Example shop", description: "Card purchase" } },
      { id: "alloc-2", plan_id: "p1", transaction_id: "old-tx", amount_cent: 9000, source: "manual", rule_id: null, transactions: { id: "old-tx", status: "booked", amount_cent: -9000, transaction_date: null, booking_date: "2026-08-13", value_date: null, partner: null, description: null } },
    ],
    error: false,
    delay: 0,
    calls: [],
    session: sessionStorage.getItem("fixture.loggedOut") ? null : { user },
  });
  let authCallback = () => {};
  const client = {
    from(table) {
      let changes,
        accountId,
        ids,
        eqFilters = [],
        single = false,
        inField,
        from = 0,
        to = 999;
      const builder = {
        select() {
          return this;
        },
        maybeSingle() {
          single = true;
          return this.then(({ data, error }) => ({ data, error }));
        },
        single() {
          single = true;
          return this.then(({ data, error }) => ({ data, error }));
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        range(a, b) {
          from = a;
          to = b;
          return this;
        },
        in(field, value) {
          inField = field;
          ids = value;
          return this;
        },
        neq(field, value) {
          eqFilters.push([field, value, "neq"]);
          return this;
        },
        eq(field, value) {
          eqFilters.push([field, value]);
          if (field === "id") accountId = value;
          return this;
        },
        update(value) {
          changes = value;
          return this;
        },
        insert(value) {
          const rows = Array.isArray(value) ? value : [value];
          const collections = { plans: state.plans, plan_groups: state.groups, transactions: state.rows };
          const collection = collections[table];
          if (collection) rows.forEach((row, index) => {
            const id = row.id || `synthetic-${table}-${collection.length + index + 1}`;
            collection.push(table === "plans" ? { id, plan_id: id, ...row } : { id, ...row });
          });
          return this;
        },
        upsert(value) {
          if (table === "user_test_data") state.testData = { ...(state.testData || {}), ...value };
          return this;
        },
        delete() {
          changes = { __delete: true };
          return this;
        },
        ilike(field, pattern) {
          eqFilters.push([field, String(pattern).replaceAll("%", "").toLowerCase(), "ilike"]);
          return this;
        },
        then(resolve, reject) {
          state.calls.push(table);
          let rawData =
            table === "user_test_data"
              ? { value: "Synthetic storage value" }
              : table === "reconciliation_reviews"
                ? (state.reviews || []).slice(from, to + 1)
                : table === "transactions"
                  ? state.rows.filter((r) => !ids || ids.includes(r[inField || "id"]))
                  : table === "plan_groups"
                    ? (state.groups || [])
                    : table === "plans"
                      ? [...new Map(state.plans.map((p) => [p.plan_id || p.id, p])).values()].map((p) => ({ ...p, id: p.plan_id || p.id })).filter((p) => !ids || ids.includes(p.id))
                      : table === "plan_allocations"
                        ? state.allocations.filter((a) => !ids || ids.includes(a[inField || "plan_id"]))
                        : state.accounts;
          if (Array.isArray(rawData) && eqFilters.length)
            rawData = rawData.filter((row) => eqFilters.every(([field, value, operator]) =>
              operator === "neq" ? row[field] !== value : operator === "ilike" ? String(row[field] || "").toLowerCase().includes(value) : row[field] === value));
          if (single) rawData = Array.isArray(rawData) ? (rawData[0] || null) : rawData;
          const data = structuredClone(rawData);
          const error = state.error;
          return new Promise((done) =>
            setTimeout(() => {
              if (changes) {
                const collections = {
                  bank_accounts: state.accounts,
                  plans: state.plans,
                  plan_groups: state.groups,
                  transactions: state.rows,
                };
                const collection = collections[table];
                const row = collection?.find((item) => item.id === accountId || item.plan_id === accountId);
                if (row && changes.__delete) collection.splice(collection.indexOf(row), 1);
                else if (row) Object.assign(row, changes);
              }
              done({
                data,
                error: error ? { message: "Synthetic outage" } : null,
              });
            }, state.delay),
          ).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, payload) {
      if (name === "unallocate_transaction_from_plan") {
        state.calls.push(name);
        state.unallocationRpc = payload;
        state.allocations = state.allocations.filter((a) => a.transaction_id !== payload.p_transaction_id || a.plan_id !== payload.p_plan_id);
        return { data: 1, error: null };
      }
      if (name === "allocate_transaction_to_plan") {
        state.calls.push(name);
        state.allocationRpc = payload;
        const transaction = state.rows.find((row) => row.id === payload.p_transaction_id);
        state.allocations = state.allocations.filter((row) => row.transaction_id !== payload.p_transaction_id || row.plan_id !== payload.p_plan_id);
        state.allocations.push({
          id: "allocation-" + (state.allocations.length + 1),
          plan_id: payload.p_plan_id,
          transaction_id: payload.p_transaction_id,
          amount_cent: payload.p_amount_cent,
          source: payload.p_source || "manual",
          rule_id: payload.p_rule_id || null,
          transactions: transaction ? structuredClone(transaction) : null,
        });
        return { data: { id: "allocation-1", ...payload }, error: null };
      }
      if (name === "plan_occurrences_for_month") {
        state.calls.push(name);
        return { data: structuredClone(state.plans), error: state.error ? { message: "Synthetic outage" } : null };
      }
      if (name === "read_transaction_ledger") {
        const selected = state.rows.filter(
          (r) =>
            (payload.p_status === "all" || r.status === payload.p_status) &&
            (!payload.p_account || r.account_id === payload.p_account) &&
            (!payload.p_start ||
              (r.transaction_date || r.booking_date || r.value_date || "") >=
                payload.p_start) &&
            (!payload.p_end ||
              (r.transaction_date ||
                r.booking_date ||
                r.value_date ||
                "9999") <= payload.p_end) &&
            (payload.p_direction === "all" ||
              (payload.p_direction === "income"
                ? r.amount_cent > 0
                : r.amount_cent < 0)) &&
            [r.partner, r.description, r.bank_accounts?.display_name].some(
              (v) =>
                (v || "")
                  .toLowerCase()
                  .includes(payload.p_search.toLowerCase()),
            ),
        );
        const data = {
          rows: structuredClone(
            selected.slice(
              payload.p_offset,
              payload.p_offset + payload.p_limit,
            ),
          ),
          count: selected.length,
          booked: String(
            selected
              .filter((r) => r.status === "booked")
              .reduce((a, r) => a + Number(r.amount_cent), 0),
          ),
          pending: String(
            selected
              .filter((r) => r.status === "pending")
              .reduce((a, r) => a + Number(r.amount_cent), 0),
          ),
          review_count: (state.reviews || []).length,
        };
        const error = state.error;
        state.calls.push(name);
        return new Promise((done) =>
          setTimeout(
            () =>
              done({
                data,
                error: error ? { message: "Synthetic outage" } : null,
              }),
            state.delay,
          ),
        );
      }
      if (name === "resolve_reconciliation_review") {
        if (state.resolveError) throw Error("Transport failure");
        state.reviews = [];
        return { error: null, data: {} };
      }
      state.rpc = { name, payload };
      if (state.rpcError) throw new Error("Synthetic import transport failure");
      const now = "2026-05-01T12:00:00+00:00";
      state.rows[1].first_seen_at = now;
      state.rows[1].imports = [{ batch_id: "latest-import", observed_at: now }];
      state.rows[0].first_seen_at = "2026-01-01T00:00:00+00:00";
      state.rows[0].imports = [{ batch_id: "latest-import", observed_at: now }];
      return {
        data: {
          batch_id: "latest-import",
          inserted: 1,
          reconciled: 0,
          duplicates: 0,
          rejected: 0,
        },
        error: null,
      };
    },
    auth: {
      async getSession() {
        return { data: { session: state.session } };
      },
      onAuthStateChange(callback) {
        authCallback = callback;
      },
      async signInWithPassword() {
        state.session = { user };
        sessionStorage.removeItem("fixture.loggedOut");
        authCallback("SIGNED_IN", state.session);
        return { data: { session: state.session }, error: null };
      },
      async signOut() {
        if (state.logoutError)
          return { error: new Error("Synthetic logout failure") };
        state.session = null;
        sessionStorage.setItem("fixture.loggedOut", "true");
        authCallback("SIGNED_OUT", null);
        return { error: null };
      },
    },
  };
  state.refreshSession = () => authCallback("TOKEN_REFRESHED", state.session);
  window.supabase = { createClient: () => client };
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer((req, res) => {
    const name =
      new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    if (
      ![
        "index.html",
        "app.js",
        "styles.css",
        "importer.js",
        "config.js",
        "rules.js",
        "rule-service.js",
        "rule-import-orchestrator.js",
        "rule-actions.js",
        "plan-group-service.js",
        "plan-read-model.js",
      ].includes(name)
    ) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "Content-Type",
      name.endsWith("html")
        ? "text/html; charset=utf-8"
        : name.endsWith("css")
          ? "text/css"
          : "text/javascript",
    );
    res.end(
      name === "config.js"
        ? 'window.PYBUDGET_CONFIG = {supabaseUrl:"https://fixture.invalid",supabaseAnonKey:"synthetic-publishable-key"};'
        : fs.readFileSync(path.join(root, name)),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.TEST_BROWSER_CHANNEL
        ? { channel: process.env.TEST_BROWSER_CHANNEL }
        : {}),
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    const base =
      process.env.TEST_BASE_URL || `http://127.0.0.1:${server.address().port}`;
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.startsWith("https://cdn.jsdelivr.net/"))
        return route.fulfill({
          contentType: "text/javascript",
          body: `(${mockSupabase.toString()})();`,
        });
      return route.abort();
    });
    const active = async (view) => {
      await page.waitForFunction(
        (v) =>
          document
            .querySelector(`.app-menu [data-view="${v}"]`)
            .getAttribute("aria-current") === "page",
        view,
      );
      assert.equal(await page.locator(".feature-view:visible").count(), 1);
    };
    const rows = async (count) =>
      page.waitForFunction(
        (n) =>
          document.querySelectorAll("#transactions-body .transaction-card").length === n &&
          document
            .querySelector("#accounts-view")
            .getAttribute("aria-busy") === "false",
        count,
      );
    const navigate = async (view) => {
      const link = page.locator(`[data-view="${view}"]`);
      if ((await link.getAttribute("aria-current")) === "page") {
        await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
      } else {
        await link.click();
      }
      await active(view);
    };

    await page.goto(`${base}/#accounts?month=2026-09`);
    await active("accounts");
    await rows(2);
    await page.reload();
    await rows(2);
    await active("accounts");
    await navigate("plans");
    await page
      .getByRole("link", { name: "Review transactions", exact: true })
      .click();
    await active("accounts");
    await rows(2);
    await navigate("plans");
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll("#workspace-occurrences .occurrence-row").length;
      const message = document.querySelector("#plans-message")?.textContent || "";
      return rows === 3 || message.includes("Could not load plans");
    });
    assert.equal(
      await page.locator("#workspace-occurrences .occurrence-row").count(),
      3,
      `Root Plan workspace did not render three direct occurrences. Browser errors: ${errors.join(" | ") || "none"}`,
    );
    assert.match(await page.locator("#plan-month").textContent(), /September 2026/);
    assert.match(await page.locator("#workspace-occurrences").textContent(), /Earmarked/);
    assert.match(await page.locator("#workspace-occurrences").textContent(), /Expected|Matched/);
    assert.doesNotMatch(await page.locator("#workspace-occurrences").textContent(), /Example shop/);
    assert.match(await page.locator("#workspace-groups").textContent(), /Expenses: Earmarked/);
    await page.locator("#workspace-groups .group-row", { hasText: "Household" }).click();
    await page.waitForFunction(() => document.querySelectorAll("#workspace-occurrences .occurrence-row").length === 1);
    assert.match(await page.locator("#workspace-occurrences").textContent(), /Example shop/);
    await page.locator("#workspace-occurrences .occurrence-edit").first().click();
    await page.locator("#plan-dialog").waitFor({ state: "visible" });
    assert.equal(await page.locator("#plan-dialog-title").textContent(), "Edit plan");
    assert.equal(await page.locator("#plan-name").inputValue(), "Groceries");
    assert.equal(await page.locator("#plan-schedule").inputValue(), "monthly");
    assert.equal(await page.locator("#plan-start").inputValue(), "2026-01-01");
    await page.locator("#plan-dialog").evaluate((dialog) => dialog.close());
    await page.getByRole("button", { name: "Plans", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#workspace-unmatched-section")?.hidden === false);
    assert.equal(await page.locator("#workspace-unmatched .unmatched-transaction").count(), 1);
    assert.equal(await page.locator("#workspace-unmatched .transaction-card").count(), 1);
    assert.equal(await page.locator("#workspace-unmatched .transaction-card").first().locator(".transaction-card-identity").count(), 1);
    assert.equal(await page.locator("#workspace-unmatched .transaction-card").first().locator(".transaction-card-amount").count(), 1);
    assert.match(await page.locator("#workspace-unmatched").textContent(), /Example salary/);
    assert.match(await page.locator("#workspace-unmatched").textContent(), /Unmatched/);
    await page.locator("#workspace-unmatched .unmatched-transaction").click();
    await page.locator("#transaction-detail-dialog").waitFor({ state: "visible" });
    assert.match(await page.locator("#transaction-detail-title").textContent(), /Example salary/);
    assert.match(await page.locator("#transaction-detail-plan-state").textContent(), /Not assigned/);
    await page.locator("#transaction-detail-assign").click();
    await page.locator("#assign-dialog").waitFor({ state: "visible" });
    assert.match(await page.locator("#assign-title").textContent(), /Example salary/);
    assert.equal(await page.locator("#assign-include").isChecked(), true);
    assert.equal(await page.locator("#assign-rule").isChecked(), false);
    await page.waitForFunction(() => document.querySelector("#assign-group")?.disabled === false);
    await page.locator("#assign-new-plan").click();
    await page.waitForFunction(() => document.querySelector("#plan-dialog")?.open === true);
    assert.equal(await page.locator("#assign-dialog").evaluate((dialog) => dialog.open), false);
    assert.equal(await page.locator("#plan-dialog-title").textContent(), "Add plan");
    assert.equal(await page.locator("#plan-name").inputValue(), "Example salary");
    assert.equal(await page.locator("#plan-amount").inputValue(), "100.00");
    assert.equal(await page.locator("#plan-direction").inputValue(), "income");
    assert.equal(await page.locator("#direction-income").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#direction-expense").getAttribute("aria-pressed"), "false");
    await page.locator("#close-plan").click();

    await page.locator("#workspace-unmatched .unmatched-transaction").click();
    await page.locator("#transaction-detail-assign").click();
    await page.waitForFunction(() => document.querySelector("#assign-group")?.disabled === false);
    assert.equal(await page.locator("#assign-plan").inputValue(), "p1");
    assert.equal(await page.locator("#assign-group").inputValue(), "g1");
    await page.locator("#assign-group").evaluate((select) => { select.value = ""; });
    assert.equal(await page.locator("#assign-group").inputValue(), "");
    await page.locator("#assign-once").evaluate((button) => button.click());
    await page.waitForFunction(() => fixture.allocationRpc?.p_transaction_id === "t1");
    assert.equal(await page.evaluate(() => fixture.allocationRpc.p_plan_id), "p1");
    assert.equal(await page.evaluate(() => fixture.allocationRpc.p_amount_cent), 10000);
    assert.equal(await page.locator("#workspace-groups .list-add-action").textContent(), "+ Add group");
    assert.equal(await page.locator("#workspace-occurrences .list-add-action").textContent(), "+ Add plan");
    await page.locator("#workspace-occurrences .list-add-action").click();
    assert.equal(await page.locator("#plan-dialog-title").textContent(), "Add plan");
    assert.equal(await page.locator("#plan-start").inputValue(), "2026-09-01");
    assert.equal(await page.locator("#plan-group").inputValue(), "");
    await page.locator("#plan-name").fill("Browser-created plan");
    await page.locator("#plan-amount").fill("42.50");
    await page.locator("#direction-income").click();
    assert.equal(await page.locator("#plan-direction").inputValue(), "income");
    await page.locator("#direction-expense").click();
    assert.equal(await page.locator("#plan-direction").inputValue(), "expense");
    await page.locator("#plan-schedule").selectOption("monthly");
    await page.locator("#plan-form").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector("#plan-dialog")?.open);
    assert.equal(await page.evaluate(() => fixture.plans.some((plan) => plan.name === "Browser-created plan" && plan.group_id === null)), true);

    await page.locator("#workspace-groups .group-row").first().click();
    await page.locator("#workspace-occurrences .list-add-action").click();
    assert.equal(await page.locator("#plan-group").inputValue(), "g1");
    await page.locator("#close-plan").click();
    await page.locator("#workspace-groups .list-add-action").click();
    assert.equal(await page.locator("#plan-dialog-title").textContent(), "Add group");
    assert.equal(await page.locator("#creation-group-parent").inputValue(), "g1");
    await page.locator("#creation-group-name").fill("Household child");
    await page.locator("#plan-form").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector("#plan-dialog")?.open);
    assert.equal(await page.evaluate(() => fixture.groups.some((group) => group.name === "Household child" && group.parent_group_id === "g1")), true);
    await page.locator("#next-plan-month").click();
    assert.match(await page.locator("#plan-month").textContent(), /October 2026/);
    await navigate("plans");
    assert.match(
      await page.locator("#overview-view").textContent(),
      /Monthly budget/,
    );
    assert.equal(await page.locator('[data-view="budget"]').count(), 0);
    assert.equal(await page.locator('[data-view="setup"]').count(), 0);
    assert.equal(await page.locator("#budget-view").count(), 0);
    await page.locator("#overview-view [data-open-import]").click();
    await active("accounts");
    await page.locator("#import-dialog").waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "close-import",
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#import-dialog").isVisible(), false);
    await navigate("reports");
    await page.selectOption("#report-variant", "settlement");
    await page.reload();
    await active("reports");
    assert.equal(
      await page.locator("#report-variant").inputValue(),
      "settlement",
    );
    assert.match(
      await page.locator("#report-message").textContent(),
      /Settlement is not available yet/,
    );
    await navigate("accounts");
    await page.locator("#accounts-list input").fill("Renamed example account");
    await page.getByRole("button", { name: "Save name" }).click();
    await page.waitForFunction(
      () => fixture.accounts[0].display_name === "Renamed example account",
    );
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page
      .getByRole("button", { name: "Reactivate", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Reactivate", exact: true }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).waitFor();
    assert.equal(await page.locator("#accounts-view #csv-file").count(), 1);
    assert.equal(
      await page.locator("#accounts-view #reconciliation-list").count(),
      1,
    );
    assert.equal(await page.locator("#accounts-title").count(), 1);
    assert.equal(await page.locator("#transactions-title").count(), 1);
    assert.equal(await page.locator('[data-view="transactions"]').count(), 0);
    await navigate("accounts");
    await page.locator("#accounts-view [data-open-import]").first().click();
    await page.locator("#import-dialog").waitFor();
    await page.locator("#csv-file").setInputFiles({
      name: "invalid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("not a bank export"),
    });
    await page.waitForFunction(() =>
      document.querySelector("#import-message").classList.contains("error"),
    );
    assert.equal(await page.locator("#import-button").isDisabled(), true);
    const csv = [
      '"Umsätze Girokonto";"Zeitraum: 01.01.2026 - 31.03.2026";',
      '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR";',
      '"12.03.2026";"12.03.2026";"Lastschrift / Belastung";"EXAMPLE SHOP";"-12,34";',
    ].join("\r\n");
    await page.locator("#csv-file").setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "latin1"),
    });
    await page.waitForFunction(
      () => !document.querySelector("#import-button").disabled,
    );
    await page.evaluate(() => {
      fixture.rpcError = true;
    });
    await page.locator("#import-button").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#import-message")
        .textContent.includes("Could not import"),
    );
    assert.equal(await page.locator("#import-button").isDisabled(), false);
    await page.evaluate(() => {
      fixture.rpcError = false;
    });
    await page.locator("#import-button").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#import-result")
        .textContent.includes("Import complete"),
    );
    await active("accounts");
    await rows(2);
    assert.equal(await page.locator("#import-dialog").isVisible(), false);
    assert.equal(await page.locator(".new-transaction").count(), 1);
    assert.equal(await page.locator(".new-dot").count(), 1);
    assert.equal(
      await page.evaluate(() => fixture.rpc.name),
      "import_comdirect_transactions",
    );
    assert.equal(
      await page.evaluate(
        () => fixture.rpc.payload.p_accounts[0].transactions[0].amount_cent,
      ),
      -1234,
    );

    await navigate("accounts");
    await rows(2);
    const before = await page.evaluate(() => fixture.calls.length);
    await page.evaluate(() => fixture.refreshSession());
    await active("accounts");
    assert.equal(await page.evaluate(() => fixture.calls.length), before);
    await page.evaluate(() => {
      fixture.logoutError = true;
    });
    const dialog = new Promise((resolve) =>
      page.once("dialog", async (dialog) => {
        await dialog.accept();
        resolve();
      }),
    );
    await page.locator("#logout-button").click();
    await dialog;
    assert.equal(await page.locator("#dashboard-view").isVisible(), true);
    await page.evaluate(() => {
      fixture.logoutError = false;
    });
    await page.locator("#logout-button").click();
    await page.locator("#auth-view").waitFor();
    assert.equal(await page.locator("#transactions-body .transaction-card").count(), 0);
    assert.equal(new URL(page.url()).hash.includes("q="), false);
    await page.reload();
    await page.locator("#auth-view").waitFor();
    await page.fill("#email", "test@example.invalid");
    await page.fill("#password", "synthetic-password");
    await page.locator("#submit-button").click();
    await active("accounts");
    await rows(2);

    await page.evaluate(() => {
      fixture.rows = [];
    });
    await navigate("plans");
    await navigate("accounts");
    await rows(0);
    assert.match(
      await page.locator("#transactions-message").textContent(),
      /No transactions in this month/,
    );
    await navigate("accounts");
    await page.evaluate(() => {
      fixture.error = true;
    });
    await page.locator("#refresh-accounts").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#accounts-message")
        .textContent.includes("Could not load"),
    );
    await page.evaluate(() => {
      fixture.error = false;
      fixture.accounts = [];
    });
    await page.locator("#refresh-accounts").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#accounts-message")
        .textContent.includes("No accounts detected"),
    );

    await page.evaluate(() => {
      fixture.delay = 0;
      fixture.error = false;
      fixture.rows = Array.from({ length: 251 }, (_, i) => ({
        id: "p" + i,
        status: i === 250 ? "cancelled" : "booked",
        amount_cent: 100,
        booking_date: "2026-09-12",
        partner: i === 249 ? "Far away shop" : "Synthetic payment",
      }));
    });
    await navigate("accounts");
    await rows(50);
    await page.locator("#load-more").click();
    await rows(100);
    await page.evaluate(() => {
      fixture.reviews = [
        {
          id: "r1",
          booked_payload: { partner: "Review shop", amount_cent: 100 },
          candidate_transaction_ids: ["p249"],
          status: "open",
          created_at: "2026-09-19T12:00:00Z",
        },
      ];
    });
    await navigate("accounts");
    await page.locator("#accounts-view [data-open-import]").first().click();
    await page
      .getByRole("button", { name: "Same transaction", exact: true })
      .waitFor();
    assert.match(
      await page.locator("#reconciliation-list").textContent(),
      /Far away shop/,
    );
    await page.evaluate(() => {
      fixture.resolveError = true;
    });
    await page
      .getByRole("button", { name: "Same transaction", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#reconciliation-message")
        .textContent.includes("Could not resolve"),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Same transaction", exact: true })
        .isDisabled(),
      false,
    );
    await page.evaluate(() => {
      fixture.resolveError = false;
    });
    await page
      .getByRole("button", { name: "Separate transaction", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#reconciliation-message")
        .textContent.includes("No transactions need review"),
    );

    await page.locator("#close-import").click();
    // A delayed response must not put private rows back into the DOM after logout.
    await page.evaluate(() => {
      fixture.delay = 250;
      fixture.rows = [
        { partner: "Late private fixture", status: "booked", amount_cent: 1 },
      ];
    });
    await navigate("accounts");
    await page.locator("#logout-button").click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#transactions-body .transaction-card").count(), 0);
    await page.fill("#email", "test@example.invalid");
    await page.fill("#password", "synthetic-password");
    await page.locator("#submit-button").click();
    await active("accounts");
    await navigate("plans");
    await navigate("reports");
    await page.goBack();
    await active("plans");
    await page.goForward();
    await active("reports");
    await page.goto(`${base}/#budget`);
    await active("plans");
    await page.goto(`${base}/#setup`);
    await active("accounts");
    await navigate("reports");
    await page.goto(`${base}/#unknown?status=invalid`);
    await active("reports");

    for (const width of [320, 375, 768, 1180]) {
      await page.setViewportSize({ width, height: 800 });
      for (const view of ["plans", "reports", "accounts"]) {
        const link = page.locator(`[data-view="${view}"]`);
        await link.focus();
        await page.keyboard.press("Enter");
        await active(view);
        assert.equal(
          await page.evaluate(() => document.activeElement.tagName),
          "H2",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
          `${view} overflows at ${width}px`,
        );
      }
      assert.equal(await page.locator("#logout-button").isVisible(), true);
      assert.equal(await page.locator("#csv-file").isVisible(), false);
      await navigate("accounts");
      await page
        .locator("#accounts-view [data-open-import]")
        .first()
        .click();
      assert.equal(await page.locator("#csv-file").isVisible(), true);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.locator("#close-import").click();
      await page.waitForFunction(
        () => document.activeElement.id === "transactions-title",
      );
    }
    if (process.env.TEST_SCREENSHOT) {
      await page.evaluate(() => {
        fixture.delay = 0;
      });
      await navigate("plans");
      await page.screenshot({
        path: process.env.TEST_SCREENSHOT,
        fullPage: true,
      });
      await page.setViewportSize({ width: 320, height: 800 });
      await navigate("accounts");
      await page.waitForFunction(
        () =>
          document.querySelector("#accounts-list").getAttribute("aria-busy") ===
          "false",
      );
      await page.screenshot({
        path: process.env.TEST_SCREENSHOT.replace(".png", "-phone.png"),
        fullPage: true,
      });
    }
    if (process.env.TEST_SCREENSHOT) {
      await navigate("accounts");
      await page
        .locator("#accounts-view [data-open-import]")
        .first()
        .click();
      await page.screenshot({
        path: process.env.TEST_SCREENSHOT.replace(".png", "-import-phone.png"),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      "Navigation browser tests passed (routes, filters, login, history, states, account actions, import, keyboard, and 320–1180px layouts)",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
