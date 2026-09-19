import { chooseOccurrence, transactionRuleDate } from "./rule-service.js";

function cents(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) throw new Error("Financial amounts must be safe integer cents.");
  return number;
}

function monthKey(date) {
  return String(date || "").slice(0, 7);
}

function transactionForAllocation(allocation) {
  const related = allocation.transaction ?? allocation.transactions ?? null;
  return Array.isArray(related) ? related[0] ?? null : related;
}

function transactionReference(transaction) {
  return {
    id: transaction.id,
    status: transaction.status,
    amount_cent: cents(transaction.amount_cent),
    booking_date: transaction.booking_date ?? null,
    value_date: transaction.value_date ?? null,
    transaction_date: transaction.transaction_date ?? null,
    description: transaction.description ?? null,
    partner: transaction.partner ?? null,
  };
}

function emptyTotals() {
  return {
    expense_planned_cent: 0,
    expense_actual_cent: 0,
    expense_earmarked_cent: 0,
    expense_overrun_cent: 0,
    income_planned_cent: 0,
    income_actual_cent: 0,
    income_receivable_cent: 0,
    income_windfall_cent: 0,
  };
}

function addTotals(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] || 0;
  return target;
}

function occurrenceTotals(occurrence) {
  const totals = emptyTotals();
  if (occurrence.direction === "expense") {
    totals.expense_planned_cent = occurrence.planned_cent;
    totals.expense_actual_cent = occurrence.actual_cent;
    totals.expense_earmarked_cent = occurrence.earmarked_cent;
    totals.expense_overrun_cent = occurrence.overrun_cent;
  } else if (occurrence.direction === "income") {
    totals.income_planned_cent = occurrence.planned_cent;
    totals.income_actual_cent = occurrence.actual_cent;
    totals.income_receivable_cent = occurrence.receivable_cent;
    totals.income_windfall_cent = occurrence.windfall_cent;
  }
  return totals;
}

export function occurrenceKey(planId, occurrenceDate) {
  return `${planId}:${occurrenceDate}`;
}

export function buildMonthFinancialReadModel({
  month,
  plans,
  occurrences,
  allocations,
  groups = [],
}) {
  const selectedMonth = monthKey(month);
  if (!selectedMonth) throw new Error("A selected month is required.");

  const planById = new Map((plans || []).map((plan) => [plan.id, plan]));
  const occurrenceRows = (occurrences || [])
    .filter((occurrence) => monthKey(occurrence.occurrence_date) === selectedMonth)
    .map((occurrence) => {
      const plan = planById.get(occurrence.plan_id);
      if (!plan) throw new Error(`Occurrence references unknown plan ${occurrence.plan_id}.`);
      const planned = cents(occurrence.amount_cent);
      return {
        id: occurrenceKey(occurrence.plan_id, occurrence.occurrence_date),
        plan_id: occurrence.plan_id,
        group_id: plan.group_id ?? null,
        name: plan.name,
        occurrence_date: occurrence.occurrence_date,
        direction: occurrence.direction ?? plan.direction,
        planned_cent: planned,
        actual_cent: 0,
        earmarked_cent: 0,
        overrun_cent: 0,
        receivable_cent: 0,
        windfall_cent: 0,
        materialized: false,
        allocations: [],
        matched_transactions: [],
      };
    })
    .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date) || a.plan_id.localeCompare(b.plan_id));

  const occurrencesByPlan = new Map();
  for (const occurrence of occurrenceRows) {
    const rows = occurrencesByPlan.get(occurrence.plan_id) || [];
    rows.push(occurrence);
    occurrencesByPlan.set(occurrence.plan_id, rows);
  }

  for (const allocation of allocations || []) {
    const transaction = transactionForAllocation(allocation);
    if (!transaction || transaction.status === "cancelled") continue;
    const transactionDate = transactionRuleDate(transaction);
    if (!transactionDate || monthKey(transactionDate) !== selectedMonth) continue;

    const assignment = chooseOccurrence(
      transaction,
      { plan_id: allocation.plan_id },
      occurrencesByPlan.get(allocation.plan_id) || [],
    );
    if (assignment.status !== "matched") continue;
    const occurrence = assignment.occurrence;

    const amount = cents(allocation.amount_cent);
    occurrence.actual_cent += amount;
    occurrence.materialized = true;
    occurrence.allocations.push({
      allocation_id: allocation.id,
      transaction_id: allocation.transaction_id ?? transaction.id,
      amount_cent: amount,
      source: allocation.source,
      rule_id: allocation.rule_id ?? null,
      transaction_status: transaction.status,
      transaction_date: transactionDate,
    });
    occurrence.matched_transactions.push({
      ...transactionReference(transaction),
      allocated_amount_cent: amount,
      allocation_id: allocation.id,
      allocation_source: allocation.source,
      rule_id: allocation.rule_id ?? null,
    });
  }

  for (const occurrence of occurrenceRows) {
    if (occurrence.direction === "expense") {
      occurrence.earmarked_cent = Math.max(occurrence.planned_cent - occurrence.actual_cent, 0);
      occurrence.overrun_cent = Math.max(occurrence.actual_cent - occurrence.planned_cent, 0);
    } else if (occurrence.direction === "income") {
      occurrence.receivable_cent = Math.max(occurrence.planned_cent - occurrence.actual_cent, 0);
      occurrence.windfall_cent = Math.max(occurrence.actual_cent - occurrence.planned_cent, 0);
    } else {
      throw new Error(`Unknown plan direction ${occurrence.direction}.`);
    }
  }

  const groupById = new Map((groups || []).map((group) => [group.id, group]));
  const directOccurrences = new Map();
  for (const occurrence of occurrenceRows) {
    if (!occurrence.group_id) continue;
    if (!groupById.has(occurrence.group_id)) {
      throw new Error(`Plan ${occurrence.plan_id} references unknown group ${occurrence.group_id}.`);
    }
    const rows = directOccurrences.get(occurrence.group_id) || [];
    rows.push(occurrence);
    directOccurrences.set(occurrence.group_id, rows);
  }

  const childGroups = new Map();
  for (const group of groups || []) {
    if (!group.parent_group_id) continue;
    if (!groupById.has(group.parent_group_id)) {
      throw new Error(`Group ${group.id} references unknown parent ${group.parent_group_id}.`);
    }
    const children = childGroups.get(group.parent_group_id) || [];
    children.push(group.id);
    childGroups.set(group.parent_group_id, children);
  }

  const groupStates = new Map();
  const visitState = new Map();
  for (const startGroup of groups || []) {
    if (visitState.get(startGroup.id) === 2) continue;
    const stack = [{ id: startGroup.id, expanded: false }];
    while (stack.length) {
      const frame = stack.pop();
      const state = visitState.get(frame.id) || 0;
      if (frame.expanded) {
        const group = groupById.get(frame.id);
        const totals = emptyTotals();
        const occurrenceIds = [];
        for (const occurrence of directOccurrences.get(frame.id) || []) {
          addTotals(totals, occurrenceTotals(occurrence));
          occurrenceIds.push(occurrence.id);
        }
        const childGroupIds = childGroups.get(frame.id) || [];
        for (const childId of childGroupIds) {
          const child = groupStates.get(childId);
          if (!child) throw new Error(`Unable to aggregate child group ${childId}.`);
          addTotals(totals, child);
          occurrenceIds.push(...child.descendant_occurrence_ids);
        }
        groupStates.set(frame.id, {
          id: group.id,
          name: group.name,
          parent_group_id: group.parent_group_id ?? null,
          sort_order: group.sort_order ?? 0,
          ...totals,
          child_group_ids: [...childGroupIds],
          direct_occurrence_ids: (directOccurrences.get(frame.id) || []).map((row) => row.id),
          descendant_occurrence_ids: occurrenceIds,
        });
        visitState.set(frame.id, 2);
        continue;
      }
      if (state === 2) continue;
      if (state === 1) throw new Error(`Cycle detected in plan groups at ${frame.id}.`);
      visitState.set(frame.id, 1);
      stack.push({ id: frame.id, expanded: true });
      const children = childGroups.get(frame.id) || [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const childId = children[index];
        if (visitState.get(childId) === 1) throw new Error(`Cycle detected in plan groups at ${childId}.`);
        if (visitState.get(childId) !== 2) stack.push({ id: childId, expanded: false });
      }
    }
  }

  const groupRows = [...groupStates.values()];
  const groupsByParent = new Map();
  for (const group of groupRows) {
    const key = group.parent_group_id ?? null;
    const rows = groupsByParent.get(key) || [];
    rows.push(group);
    groupsByParent.set(key, rows);
  }
  for (const rows of groupsByParent.values()) {
    rows.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  }

  function level(groupId = null) {
    if (groupId !== null && !groupById.has(groupId)) throw new Error(`Unknown plan group ${groupId}.`);
    return {
      group_id: groupId,
      groups: [...(groupsByParent.get(groupId) || [])],
      occurrences: occurrenceRows.filter((occurrence) => (occurrence.group_id ?? null) === groupId),
    };
  }

  return {
    month: selectedMonth,
    occurrences: occurrenceRows,
    root_occurrences: occurrenceRows.filter((occurrence) => !occurrence.group_id),
    groups: groupRows,
    level,
  };
}


export async function loadMonthFinancialReadModel(client, month) {
  const selectedMonth = monthKey(month);
  if (!selectedMonth) throw new Error("A selected month is required.");

  const [occurrenceResult, planResult, groupResult, allocationResult] = await Promise.all([
    client.rpc("plan_occurrences_for_month", { p_month: `${selectedMonth}-01` }),
    client.from("plans").select("id,name,direction,group_id"),
    client.from("plan_groups").select("id,name,parent_group_id,sort_order").order("sort_order").order("id"),
    client
      .from("plan_allocations")
      .select("id,plan_id,transaction_id,amount_cent,source,rule_id,transactions(id,status,amount_cent,booking_date,value_date,transaction_date,description,partner)"),
  ]);

  for (const result of [occurrenceResult, planResult, groupResult, allocationResult]) {
    if (result.error) throw result.error;
  }

  return buildMonthFinancialReadModel({
    month: selectedMonth,
    plans: planResult.data || [],
    occurrences: occurrenceResult.data || [],
    allocations: allocationResult.data || [],
    groups: groupResult.data || [],
  });
}
