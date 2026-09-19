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
  plan_id: "p1", occurrence_date: "2026-09-01", amount_cent: 50000, direction: "expense",
};
assert.equal(occurrenceApplies(transaction, september), true);
assert.equal(occurrenceApplies(transaction, { ...september, occurrence_date: "2026-09-19" }), false);
assert.equal(chooseOccurrence(transaction, rule, [september]).occurrence.occurrence_date, "2026-09-01");
assert.equal(chooseOccurrence(transaction, rule, []).status, "unmatched");
const weekly = [
  { ...september, occurrence_date: "2026-09-01" },
  { ...september, occurrence_date: "2026-09-08" },
  { ...september, occurrence_date: "2026-09-15" },
  { ...september, occurrence_date: "2026-09-22" },
];
assert.equal(chooseOccurrence(transaction, rule, weekly).occurrence.occurrence_date, "2026-09-15");

const result = planAutomaticMatch({ transaction, rules: [rule], occurrences: [september] });
assert.equal(result.status, "matched");
assert.deepEqual(result.match, {
  transaction_id: "t1", plan_id: "p1", rule_id: "r1", source: "rule",
});

const manual = { id: "m1", transaction_id: "t1", plan_id: "other", source: "manual" };
assert.equal(planAutomaticMatch({ transaction, rules: [rule], occurrences: [september], existingMatch: manual }).status, "manual");
const split = [
  { id: "ralloc", transaction_id: "t1", plan_id: "p1", source: "rule", amount_cent: 1000 },
  manual,
];
const protectedSplit = planAutomaticMatch({ transaction, rules: [rule], occurrences: [september], existingMatch: split });
assert.equal(protectedSplit.status, "manual");
assert.equal(protectedSplit.allocations.length, 2);
assert.equal(planAutomaticMatch({ transaction, rules: [rule], occurrences: [] }).status, "unmatched");

console.log("Rule service tests passed.");
