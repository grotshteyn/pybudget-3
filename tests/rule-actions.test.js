import assert from "node:assert/strict";
import fs from "node:fs";

const actions = fs.readFileSync(new URL("../rule-actions.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(actions, /allocateTransaction\(client, transactionId, planId, amountCent, "manual", null\)/);
assert.match(actions, /field: "partner"/);
assert.match(actions, /operator: "contains"/);
assert.doesNotMatch(actions, /transaction_plan_matches/);
assert.match(actions, /return allocateTransaction/);
assert.match(app, /createManualPlanMatch/);
assert.match(app, /createPartnerRule/);
assert.match(html, /Only this transaction/);
assert.match(html, /All transactions from this partner/);

console.log("Rule action UI tests passed.");
