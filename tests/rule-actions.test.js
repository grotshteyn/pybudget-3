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
assert.match(actions, /applyPartnerRuleToExistingTransactions/);
assert.match(actions, /\.neq\("status", "cancelled"\)/);
assert.match(actions, /\.ilike\("partner"/);
assert.match(actions, /typeof applyRules !== "function"/);
assert.match(actions, /return applyRules\(client, transactions \|\| \[\]\)/);
assert.doesNotMatch(actions, /await import\("\.\/rule-service\.js"\)/);
assert.match(app, /applyPartnerRuleToExistingTransactions/);
assert.match(app, /Rule post-processing failed after reconciliation resolution/);
assert.match(app, /resolution\?\.transaction_id/);
assert.match(html, /Save assignment/);
assert.match(html, /Include this transaction in the Plan/);
assert.match(html, /Create a Rule for similar transactions/);
assert.doesNotMatch(html, /assign-amount/);
assert.doesNotMatch(html, /allocate only part/);

console.log("Rule action UI tests passed.");
