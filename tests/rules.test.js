import assert from "node:assert/strict";
import { conditionMatches, ruleMatches, selectRuleMatch } from "../rules.js";

const tx = {
  id: "t1",
  partner: "EDEKA Konstanz",
  description: "Kartenzahlung",
  amount_cent: "-4273",
  account_id: "account-1",
};

assert.equal(conditionMatches(tx, { field: "partner", operator: "contains", value: "edeka" }), true);
assert.equal(conditionMatches(tx, { field: "partner", operator: "equals", value: "EDEKA Konstanz" }), true);
assert.equal(conditionMatches(tx, { field: "amount", operator: "equals", value: -4273 }), true);
assert.equal(conditionMatches(tx, { field: "amount", operator: "contains", value: "42" }), false);

const groceries = {
  id: "r1", plan_id: "groceries", enabled: true, priority: 10,
  conditions: [{ field: "partner", operator: "contains", value: "EDEKA" }],
};
assert.equal(ruleMatches(tx, groceries), true);
assert.equal(ruleMatches(tx, { ...groceries, enabled: false }), false);

assert.equal(selectRuleMatch(tx, [groceries]).status, "matched");
assert.equal(selectRuleMatch(tx, [{ ...groceries, conditions: [{ field: "partner", operator: "contains", value: "REWE" }] }]).status, "unmatched");

const specific = { ...groceries, id: "r2", plan_id: "food", priority: 20 };
assert.equal(selectRuleMatch(tx, [groceries, specific]).rule.id, "r2");

const conflict = { ...groceries, id: "r3", plan_id: "household", priority: 10 };
const ambiguous = selectRuleMatch(tx, [groceries, conflict]);
assert.equal(ambiguous.status, "ambiguous");
assert.equal(ambiguous.rule, null);

const samePlan = { ...groceries, id: "r4", priority: 10 };
assert.equal(selectRuleMatch(tx, [groceries, samePlan]).status, "matched");

console.log("Rule matching tests passed.");
