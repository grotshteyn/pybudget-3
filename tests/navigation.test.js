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
        booking_date: "2026-03-12",
        partner: "Example salary",
        description: "Income",
        bank_accounts: { display_name: "Example account" },
      },
      {
        id: "t2",
        status: "pending",
        amount_cent: -2000,
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
        from = 0,
        to = 999;
      const builder = {
        select() {
          return this;
        },
        maybeSingle() {
          return this;
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
        in(_field, value) {
          ids = value;
          return this;
        },
        eq(_field, value) {
          accountId = value;
          return this;
        },
        update(value) {
          changes = value;
          return this;
        },
        then(resolve, reject) {
          state.calls.push(table);
          const data = structuredClone(
            table === "user_test_data"
              ? { value: "Synthetic storage value" }
              : table === "reconciliation_reviews"
                ? (state.reviews || []).slice(from, to + 1)
                : table === "transactions"
                  ? state.rows.filter((r) => !ids || ids.includes(r.id))
                  : state.accounts,
          );
          const error = state.error;
          return new Promise((done) =>
            setTimeout(() => {
              if (changes)
                Object.assign(
                  state.accounts.find((a) => a.id === accountId),
                  changes,
                );
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
          document.querySelectorAll("#transactions-body tr").length === n &&
          document
            .querySelector("#transactions-view")
            .getAttribute("aria-busy") === "false",
        count,
      );
    const navigate = async (view) => {
      await page.locator(`[data-view="${view}"]`).click();
      await active(view);
    };

    await page.goto(`${base}/#transactions?status=pending&q=shop`);
    await active("transactions");
    await rows(1);
    assert.equal(
      await page.locator("#transaction-status").inputValue(),
      "pending",
    );
    assert.match(await page.locator("#pending-total").textContent(), /20/);
    await page.reload();
    await rows(1);
    await active("transactions");
    await navigate("overview");
    await page
      .getByRole("link", { name: "Review transactions", exact: true })
      .click();
    await active("transactions");
    await rows(1);
    assert.equal(
      await page.locator("#transaction-search").inputValue(),
      "shop",
    );
    await navigate("overview");
    assert.match(
      await page.locator("#overview-view").textContent(),
      /Monthly budget/,
    );
    assert.equal(await page.locator('[data-view="budget"]').count(), 0);
    assert.equal(await page.locator('[data-view="setup"]').count(), 0);
    assert.equal(await page.locator("#budget-view").count(), 0);
    await page.locator("#overview-view [data-open-import]").click();
    await active("transactions");
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
    assert.equal(await page.locator("#accounts-view #csv-file").count(), 0);
    assert.equal(
      await page.locator("#accounts-view #reconciliation-list").count(),
      0,
    );
    assert.equal(
      await page.locator("#accounts-view").getByRole("heading").count(),
      1,
    );
    await navigate("transactions");
    await page.locator("#transactions-view [data-open-import]").first().click();
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
    await active("transactions");
    await rows(2);
    assert.equal(await page.locator("#import-dialog").isVisible(), false);
    assert.equal(await page.locator(".new-transaction").count(), 1);
    assert.equal(await page.locator(".new-dot").count(), 1);
    assert.equal(await page.locator("#transaction-status").inputValue(), "all");
    assert.equal(await page.locator("#transaction-search").inputValue(), "");
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

    await navigate("transactions");
    await rows(2);
    const before = await page.evaluate(() => fixture.calls.length);
    await page.evaluate(() => fixture.refreshSession());
    await active("transactions");
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
    assert.equal(await page.locator("#transactions-body tr").count(), 0);
    assert.equal(new URL(page.url()).hash.includes("q="), false);
    await page.reload();
    await page.locator("#auth-view").waitFor();
    await page.fill("#email", "test@example.invalid");
    await page.fill("#password", "synthetic-password");
    await page.locator("#submit-button").click();
    await active("transactions");
    await rows(2);

    await page.selectOption("#transaction-status", "all");
    await page.fill("#transaction-search", "");
    await rows(2);
    await page.fill("#transaction-search", "no matching synthetic text");
    await rows(0);
    assert.match(
      await page.locator("#transactions-message").textContent(),
      /No transactions match/,
    );
    await page.fill("#transaction-search", "");
    await page.evaluate(() => {
      fixture.delay = 350;
      fixture.error = true;
    });
    await page.locator("#refresh-transactions").click();
    assert.match(
      await page.locator("#transactions-message").textContent(),
      /Loading/,
    );
    await page.waitForFunction(() =>
      document
        .querySelector("#transactions-message")
        .textContent.includes("Could not load"),
    );
    assert.equal(await page.locator("#transactions-body tr").count(), 0);
    assert.match(
      await page.locator("#combined-total").textContent(),
      /0[.,]00/,
    );
    await page.evaluate(() => {
      fixture.delay = 0;
      fixture.error = false;
      fixture.rows = [];
    });
    await page.locator("#refresh-transactions").click();
    await rows(0);
    assert.match(
      await page.locator("#transactions-message").textContent(),
      /No imported transactions/,
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
        booking_date: "2026-03-12",
        partner: i === 249 ? "Far away shop" : "Synthetic payment",
      }));
    });
    await navigate("transactions");
    await rows(50);
    assert.match(await page.locator("#ledger-page").textContent(), /of 251/);
    const total = await page.locator("#booked-total").textContent();
    await page.locator("#next-page").click();
    await page.waitForFunction(() =>
      document.querySelector("#ledger-page").textContent.startsWith("51"),
    );
    assert.equal(await page.locator("#booked-total").textContent(), total);
    await page.fill("#transaction-search", "Far away");
    await rows(1);
    assert.match(await page.locator("#ledger-page").textContent(), /of 1/);
    await page.fill("#transaction-search", "");
    await rows(50);
    await page.selectOption("#transaction-status", "cancelled");
    await rows(1);
    assert.match(
      await page.locator("#combined-total").textContent(),
      /0[.,]00/,
    );
    await page.selectOption("#transaction-status", "all");
    await rows(50);
    await page.evaluate(() => {
      fixture.reviews = [
        {
          id: "r1",
          booked_payload: { partner: "Review shop", amount_cent: 100 },
          candidate_transaction_ids: ["p249"],
        },
      ];
    });
    await navigate("transactions");
    await page.locator("#transactions-view [data-open-import]").first().click();
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
    await navigate("transactions");
    await page.locator("#logout-button").click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#transactions-body tr").count(), 0);
    await page.fill("#email", "test@example.invalid");
    await page.fill("#password", "synthetic-password");
    await page.locator("#submit-button").click();
    await active("transactions");
    await navigate("overview");
    await navigate("reports");
    await page.goBack();
    await active("overview");
    await page.goForward();
    await active("reports");
    await page.goto(`${base}/#budget`);
    await active("overview");
    await page.goto(`${base}/#setup`);
    await active("accounts");
    await navigate("reports");
    await page.goto(`${base}/#unknown?status=invalid`);
    await active("reports");

    for (const width of [320, 375, 768, 1180]) {
      await page.setViewportSize({ width, height: 800 });
      for (const view of ["overview", "transactions", "reports", "accounts"]) {
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
      await navigate("transactions");
      await page
        .locator("#transactions-view [data-open-import]")
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
      await navigate("overview");
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
      await navigate("transactions");
      await page
        .locator("#transactions-view [data-open-import]")
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
