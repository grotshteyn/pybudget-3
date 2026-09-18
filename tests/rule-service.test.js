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
  plan_id: "p1", occurrence_date: "2026-09-18", amount_cent: 50000, direction: "expense",
};
assert.equal(occurrenceApplies(transaction, september), true);
assert.equal(occurrenceApplies(transaction, { ...september, occurrence_date: "2026-10-18" }), false);
assert.equal(chooseOccurrence(transaction, rule, [september]).occurrence.occurrence_date, "2026-09-18");
assert.equal(chooseOccurrence(transaction, rule, []).status, "unmatched");
assert.equal(chooseOccurrence(transaction, rule, [september, { ...september }]).status, "ambiguous");

const result = planAutomaticMatch({ transaction, rules: [rule], occurrences: [september] });
assert.equal(result.status, "matched");
assert.deepEqual(result.match, {
  transaction_id: "t1", plan_id: "p1", rule_id: "r1", source: "rule",
});

const manual = { id: "m1", transaction_id: "t1", plan_id: "other", source: "manual" };
assert.equal(planAutomaticMatch({ transaction, rules: [rule], occurrences: [september], existingMatch: manual }).status, "manual");
assert.equal(planAutomaticMatch({ transaction, rules: [rule], occurrences: [] }).status, "unmatched");

console.log("Rule service tests passed.");
