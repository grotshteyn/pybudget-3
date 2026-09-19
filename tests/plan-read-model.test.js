import assert from "node:assert/strict";
import { buildMonthFinancialReadModel, occurrenceKey } from "../plan-read-model.js";

const plan = (id, name, direction = "expense", group_id = null) => ({ id, name, direction, group_id });
const occurrence = (plan_id, occurrence_date, amount_cent, direction = "expense") => ({
  plan_id, occurrence_date, amount_cent, direction,
});
const allocation = (id, plan_id, amount_cent, date, status = "booked", source = "manual") => ({
  id,
  plan_id,
  transaction_id: `tx-${id}`,
  amount_cent,
  source,
  rule_id: source === "rule" ? `rule-${id}` : null,
  transaction: {
    id: `tx-${id}`,
    status,
    amount_cent: directionAmount(amount_cent),
    transaction_date: date,
  },
});
function directionAmount(amount) { return -Math.abs(amount); }

{
  const result = buildMonthFinancialReadModel({
    month: "2026-09-01",
    plans: [plan("once", "Insurance"), plan("gym", "Gym"), plan("monthly", "Rent"), plan("yearly", "Tax")],
    occurrences: [
      occurrence("once", "2026-09-01", 10000),
      occurrence("gym", "2026-09-03", 2000),
      occurrence("gym", "2026-09-10", 2000),
      occurrence("gym", "2026-09-17", 2000),
      occurrence("gym", "2026-09-24", 2000),
      occurrence("monthly", "2026-09-30", 80000),
      occurrence("yearly", "2026-09-15", 12000),
      occurrence("gym", "2026-10-01", 2000),
    ],
    allocations: [],
  });
  assert.equal(result.occurrences.length, 7);
  assert.deepEqual(
    result.occurrences.filter((row) => row.plan_id === "gym").map((row) => row.occurrence_date),
    ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24"],
  );
  assert.equal(result.occurrences[0].id, occurrenceKey(result.occurrences[0].plan_id, result.occurrences[0].occurrence_date));
  assert.ok(result.occurrences.some((row) => row.occurrence_date === "2026-09-01"));
  assert.ok(result.occurrences.some((row) => row.occurrence_date === "2026-09-30"));
}

{
  const cases = [
    { amount: 0, earmarked: 10000, overrun: 0, materialized: false },
    { amount: 7000, earmarked: 3000, overrun: 0, materialized: true },
    { amount: 10000, earmarked: 0, overrun: 0, materialized: true },
    { amount: 13000, earmarked: 0, overrun: 3000, materialized: true },
  ];
  for (const expected of cases) {
    const allocations = expected.amount
      ? [allocation("expense", "p", expected.amount, "2026-09-15")]
      : [];
    const [row] = buildMonthFinancialReadModel({
      month: "2026-09",
      plans: [plan("p", "Expense")],
      occurrences: [occurrence("p", "2026-09-01", 10000)],
      allocations,
    }).occurrences;
    assert.equal(row.actual_cent, expected.amount);
    assert.equal(row.earmarked_cent, expected.earmarked);
    assert.equal(row.overrun_cent, expected.overrun);
    assert.equal(row.materialized, expected.materialized);
  }

  const [multiple] = buildMonthFinancialReadModel({
    month: "2026-09",
    plans: [plan("p", "Expense")],
    occurrences: [occurrence("p", "2026-09-01", 10000)],
    allocations: [
      allocation("a", "p", 3000, "2026-09-04"),
      allocation("b", "p", 4000, "2026-09-05", "pending", "rule"),
    ],
  }).occurrences;
  assert.equal(multiple.actual_cent, 7000);
  assert.equal(multiple.allocations.length, 2);
}

{
  const incomePlan = plan("salary", "Salary", "income");
  const incomeOccurrence = occurrence("salary", "2026-09-01", 10000, "income");
  for (const expected of [
    { amount: 0, receivable: 10000, windfall: 0 },
    { amount: 7000, receivable: 3000, windfall: 0 },
    { amount: 10000, receivable: 0, windfall: 0 },
    { amount: 13000, receivable: 0, windfall: 3000 },
  ]) {
    const [row] = buildMonthFinancialReadModel({
      month: "2026-09",
      plans: [incomePlan],
      occurrences: [incomeOccurrence],
      allocations: expected.amount ? [allocation("income", "salary", expected.amount, "2026-09-03")] : [],
    }).occurrences;
    assert.equal(row.actual_cent, expected.amount);
    assert.equal(row.receivable_cent, expected.receivable);
    assert.equal(row.windfall_cent, expected.windfall);
  }
}

{
  const statusModel = (status) => buildMonthFinancialReadModel({
    month: "2026-09",
    plans: [plan("p", "Status")],
    occurrences: [occurrence("p", "2026-09-01", 10000)],
    allocations: [allocation("same", "p", 4000, "2026-09-05", status)],
  }).occurrences[0];

  assert.equal(statusModel("pending").actual_cent, 4000);
  assert.equal(statusModel("booked").actual_cent, 4000);
  assert.equal(statusModel("cancelled").actual_cent, 0);
  assert.equal(statusModel("pending").allocations.length, 1);
  assert.equal(statusModel("booked").allocations.length, 1);
}

{
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    plans: [plan("gym", "Gym")],
    occurrences: [
      occurrence("gym", "2026-09-03", 2000),
      occurrence("gym", "2026-09-10", 2000),
      occurrence("gym", "2026-09-17", 2000),
    ],
    allocations: [
      allocation("before", "gym", 500, "2026-09-02"),
      allocation("first", "gym", 1000, "2026-09-09"),
      allocation("second", "gym", 1500, "2026-09-16"),
    ],
  });
  assert.deepEqual(result.occurrences.map((row) => row.actual_cent), [1000, 1500, 0]);
}

{
  const groups = [
    { id: "food", name: "Food", parent_group_id: null },
  ];
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    groups,
    plans: [plan("groceries", "Groceries", "expense", "food"), plan("restaurants", "Restaurants", "expense", "food")],
    occurrences: [
      occurrence("groceries", "2026-09-01", 50000),
      occurrence("restaurants", "2026-09-01", 20000),
    ],
    allocations: [
      allocation("g", "groceries", 60000, "2026-09-10"),
      allocation("r", "restaurants", 10000, "2026-09-10"),
    ],
  });
  const food = result.groups.find((group) => group.id === "food");
  assert.equal(food.expense_planned_cent, 70000);
  assert.equal(food.expense_actual_cent, 70000);
  assert.equal(food.expense_earmarked_cent, 10000);
  assert.equal(food.expense_overrun_cent, 10000);
  assert.notEqual(food.expense_earmarked_cent, Math.max(food.expense_planned_cent - food.expense_actual_cent, 0));
}

{
  const groups = [
    { id: "living", name: "Living", parent_group_id: null },
    { id: "transport", name: "Transport", parent_group_id: "living" },
    { id: "public", name: "Public transport", parent_group_id: "transport" },
  ];
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    groups,
    plans: [plan("ticket", "Deutschlandticket", "expense", "public")],
    occurrences: [occurrence("ticket", "2026-09-01", 4900)],
    allocations: [],
  });
  for (const id of ["public", "transport", "living"]) {
    const state = result.groups.find((group) => group.id === id);
    assert.equal(state.expense_earmarked_cent, 4900);
    assert.deepEqual(state.descendant_occurrence_ids, ["ticket:2026-09-01"]);
  }
}

{
  const groups = [{ id: "mixed", name: "Mixed", parent_group_id: null }];
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    groups,
    plans: [
      plan("expense", "Expense", "expense", "mixed"),
      plan("income", "Income", "income", "mixed"),
    ],
    occurrences: [
      occurrence("expense", "2026-09-01", 10000, "expense"),
      occurrence("income", "2026-09-01", 20000, "income"),
    ],
    allocations: [
      allocation("expense", "expense", 13000, "2026-09-02"),
      allocation("income", "income", 15000, "2026-09-02"),
    ],
  });
  const mixed = result.groups[0];
  assert.equal(mixed.expense_earmarked_cent, 0);
  assert.equal(mixed.expense_overrun_cent, 3000);
  assert.equal(mixed.income_receivable_cent, 5000);
  assert.equal(mixed.income_windfall_cent, 0);
}

{
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    groups: [{ id: "g", name: "Grouped", parent_group_id: null }],
    plans: [plan("root", "Root"), plan("child", "Child", "expense", "g")],
    occurrences: [
      occurrence("root", "2026-09-01", 1000),
      occurrence("child", "2026-09-01", 2000),
    ],
    allocations: [],
  });
  assert.deepEqual(result.root_occurrences.map((row) => row.plan_id), ["root"]);
  assert.deepEqual(result.groups[0].descendant_occurrence_ids, ["child:2026-09-01"]);
}

assert.throws(
  () => buildMonthFinancialReadModel({
    month: "2026-09",
    groups: [
      { id: "a", name: "A", parent_group_id: "b" },
      { id: "b", name: "B", parent_group_id: "a" },
    ],
    plans: [],
    occurrences: [],
    allocations: [],
  }),
  /Cycle detected/,
);

console.log("Plan occurrence and group financial read-model tests passed.");
