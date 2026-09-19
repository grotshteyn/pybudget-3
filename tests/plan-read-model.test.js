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


{
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    plans: [plan("weekly", "Weekly")],
    occurrences: [
      occurrence("weekly", "2026-09-03", 2000),
      occurrence("weekly", "2026-09-10", 2000),
    ],
    allocations: [
      allocation("on-date", "weekly", 500, "2026-09-03"),
      allocation("later-a", "weekly", 700, "2026-09-09"),
      allocation("later-b", "weekly", 300, "2026-09-09", "pending", "rule"),
      allocation("next", "weekly", 800, "2026-09-10"),
      allocation("cancelled", "weekly", 900, "2026-09-10", "cancelled"),
    ],
  });
  assert.equal(result.occurrences[0].actual_cent, 1500);
  assert.equal(result.occurrences[0].allocations.length, 3);
  assert.equal(result.occurrences[1].actual_cent, 800);
  assert.equal(result.occurrences[1].allocations.length, 1);
}

{
  const groups = [
    { id: "root", name: "Root", parent_group_id: null },
    { id: "expense-child", name: "Expense child", parent_group_id: "root" },
    { id: "income-child", name: "Income child", parent_group_id: "root" },
  ];
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    groups,
    plans: [
      plan("expense-a", "Expense A", "expense", "expense-child"),
      plan("expense-b", "Expense B", "expense", "expense-child"),
      plan("income-a", "Income A", "income", "income-child"),
      plan("income-b", "Income B", "income", "income-child"),
    ],
    occurrences: [
      occurrence("expense-a", "2026-09-01", 10000, "expense"),
      occurrence("expense-b", "2026-09-01", 10000, "expense"),
      occurrence("income-a", "2026-09-01", 20000, "income"),
      occurrence("income-b", "2026-09-01", 20000, "income"),
    ],
    allocations: [
      allocation("expense-over", "expense-a", 13000, "2026-09-02"),
      allocation("expense-under", "expense-b", 4000, "2026-09-02", "pending"),
      allocation("income-over", "income-a", 25000, "2026-09-02"),
      allocation("income-under", "income-b", 5000, "2026-09-02", "pending", "rule"),
    ],
  });
  const root = result.groups.find((group) => group.id === "root");
  assert.equal(root.expense_earmarked_cent, 6000);
  assert.equal(root.expense_overrun_cent, 3000);
  assert.equal(root.income_receivable_cent, 15000);
  assert.equal(root.income_windfall_cent, 5000);
}

{
  const depth = 1500;
  const groups = Array.from({ length: depth }, (_, index) => ({
    id: `deep-${index}`,
    name: `Deep ${index}`,
    parent_group_id: index === 0 ? null : `deep-${index - 1}`,
  }));
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    groups,
    plans: [plan("deep-plan", "Deep plan", "expense", `deep-${depth - 1}`)],
    occurrences: [occurrence("deep-plan", "2026-09-01", 1234)],
    allocations: [],
  });
  const root = result.groups.find((group) => group.id === "deep-0");
  assert.equal(root.expense_earmarked_cent, 1234);
  assert.deepEqual(root.descendant_occurrence_ids, ["deep-plan:2026-09-01"]);
}

{
  const transaction = {
    id: "shared-tx",
    status: "booked",
    amount_cent: -10000,
    transaction_date: "2026-09-05",
  };
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    plans: [plan("split-a", "Split A"), plan("split-b", "Split B")],
    occurrences: [
      occurrence("split-a", "2026-09-01", 6000),
      occurrence("split-b", "2026-09-01", 4000),
    ],
    allocations: [
      { id: "split-1", plan_id: "split-a", transaction_id: "shared-tx", amount_cent: 6000, source: "manual", transaction },
      { id: "split-2", plan_id: "split-b", transaction_id: "shared-tx", amount_cent: 4000, source: "manual", transaction },
    ],
  });
  assert.deepEqual(result.occurrences.map((row) => row.actual_cent), [6000, 4000]);
  assert.ok(result.occurrences.every((row) => row.materialized));
}


{
  const transaction = {
    id: "tx-render",
    status: "pending",
    amount_cent: -4200,
    transaction_date: "2026-09-08",
    booking_date: null,
    value_date: "2026-09-08",
    description: "Monthly ticket",
    partner: "Transit",
  };
  const result = buildMonthFinancialReadModel({
    month: "2026-09",
    groups: [
      { id: "root-group", name: "Root group", parent_group_id: null, sort_order: 20 },
      { id: "first-group", name: "First group", parent_group_id: null, sort_order: 10 },
      { id: "child-group", name: "Child group", parent_group_id: "root-group", sort_order: 0 },
    ],
    plans: [
      plan("root-plan", "Root plan"),
      plan("child-plan", "Child plan", "expense", "root-group"),
    ],
    occurrences: [
      occurrence("root-plan", "2026-09-01", 1000),
      occurrence("child-plan", "2026-09-01", 5000),
    ],
    allocations: [{
      id: "alloc-render",
      plan_id: "child-plan",
      transaction_id: transaction.id,
      amount_cent: 4200,
      source: "rule",
      rule_id: "rule-render",
      transaction,
    }],
  });

  assert.deepEqual(result.level().groups.map((group) => group.id), ["first-group", "root-group"]);
  assert.deepEqual(result.level().occurrences.map((row) => row.plan_id), ["root-plan"]);
  assert.deepEqual(result.level("root-group").groups.map((group) => group.id), ["child-group"]);
  assert.deepEqual(result.level("root-group").occurrences.map((row) => row.plan_id), ["child-plan"]);
  assert.throws(() => result.level("missing"), /Unknown plan group/);

  const matched = result.level("root-group").occurrences[0].matched_transactions;
  assert.deepEqual(matched, [{
    id: "tx-render",
    status: "pending",
    amount_cent: -4200,
    booking_date: null,
    value_date: "2026-09-08",
    transaction_date: "2026-09-08",
    description: "Monthly ticket",
    partner: "Transit",
    allocated_amount_cent: 4200,
    allocation_id: "alloc-render",
    allocation_source: "rule",
    rule_id: "rule-render",
  }]);
}
