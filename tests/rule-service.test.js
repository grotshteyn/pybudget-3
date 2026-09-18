import assert from "node:assert/strict";
import { chooseOccurrence, occurrenceApplies, planAutomaticMatch } from "../rule-service.js";

const transaction = {
  id: "t1", partner: "EDEKA", amount_cent: "-4200",
  transaction_date: "2026-09-18",
};
const rule = {
  id: "r1", plan_id: "p1", enabled: true, priority: 10,
  conditions: [{ field: "partner", operator: "contains", value: "edeka" }],
};
const september = {
  id: "o1", plan_id: "p1", period_start: "2026-09-01", period_end: "2026-09-30",
};
assert.equal(occurrenceApplies(transaction, september), true);
assert.equal(occurrenceApplies(transaction, { ...september, period_start: "2026-10-01", period_end: "2026-10-31" }), false);
assert.equal(occurrenceApplies(transaction, { ...september, status_override: "cancelled" }), false);
assert.equal(chooseOccurrence(transaction, rule, [september]).occurrence.id, "o1");
assert.equal(chooseOccurrence(transaction, rule, []).status, "unmatched");
assert.equal(chooseOccurrence(transaction, rule, [september, { ...september, id: "o2" }]).status, "ambiguous");

const result = planAutomaticMatch({ transaction, rules: [rule], occurrences: [september] });
assert.equal(result.status, "matched");
assert.deepEqual(result.match, {
  transaction_id: "t1", plan_id: "p1", rule_id: "r1", source: "rule",
});

const manual = { id: "m1", transaction_id: "t1", plan_id: "other", source: "manual" };
assert.equal(planAutomaticMatch({ transaction, rules: [rule], occurrences: [september], existingMatch: manual }).status, "manual");
assert.equal(planAutomaticMatch({ transaction, rules: [rule], occurrences: [] }).status, "unmatched");

console.log("Rule service tests passed.");
