import { selectRuleMatch } from "./rules.js";

export function transactionRuleDate(transaction) {
  return transaction.transaction_date || transaction.booking_date || transaction.value_date || null;
}

export function occurrenceApplies(transaction, occurrence) {
  const date = transactionRuleDate(transaction);
  if (!date || !occurrence) return false;
  return occurrence.occurrence_date === date;
}

export function chooseOccurrence(transaction, rule, occurrences) {
  const candidates = (occurrences || []).filter(
    (occurrence) =>
      occurrence.plan_id === rule.plan_id && occurrenceApplies(transaction, occurrence),
  );
  if (candidates.length === 1) return { status: "matched", occurrence: candidates[0] };
  if (!candidates.length) return { status: "unmatched", occurrence: null };
  return { status: "ambiguous", occurrence: null, candidates };
}

export function planAutomaticMatch({ transaction, rules, occurrences = [], existingMatch = null }) {
  if (existingMatch) {
    return {
      status: existingMatch.source === "manual" ? "manual" : "already_matched",
      match: existingMatch,
    };
  }

  const selected = selectRuleMatch(transaction, rules);
  if (selected.status !== "matched") return selected;

  const occurrence = chooseOccurrence(transaction, selected.rule, occurrences);
  if (occurrence.status !== "matched") {
    return { ...occurrence, rule: selected.rule };
  }

  return {
    status: "matched",
    rule: selected.rule,
    occurrence: occurrence.occurrence,
    match: {
      transaction_id: transaction.id,
      plan_id: selected.rule.plan_id,
      rule_id: selected.rule.id,
      source: "rule",
    },
  };
}

export async function loadOccurrencesForTransactions(client, transactions) {
  const months = [...new Set(
    transactions
      .map(transactionRuleDate)
      .filter(Boolean)
      .map((date) => `${date.slice(0, 7)}-01`),
  )];
  const occurrences = [];
  for (const month of months) {
    const { data, error } = await client.rpc("plan_occurrences_for_month", { p_month: month });
    if (error) throw error;
    occurrences.push(...(data || []));
  }
  return occurrences;
}

export async function loadRules(client) {
  const { data, error } = await client
    .from("transaction_rules")
    .select("id,plan_id,name,enabled,priority,transaction_rule_conditions(field,operator,value)")
    .eq("enabled", true)
    .order("priority", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data || []).map((rule) => ({
    ...rule,
    conditions: rule.transaction_rule_conditions || [],
  }));
}

export async function loadExistingMatches(client, transactionIds) {
  if (!transactionIds.length) return new Map();
  const { data, error } = await client
    .from("plan_allocations")
    .select("id,transaction_id,plan_id,rule_id,source,amount_cent")
    .in("transaction_id", transactionIds);
  if (error) throw error;

  const matches = new Map();
  for (const allocation of data || []) {
    if (!matches.has(allocation.transaction_id)) {
      matches.set(allocation.transaction_id, allocation);
    }
  }
  return matches;
}

export async function applyAutomaticRules(client, transactions, occurrences = null) {
  if (!transactions.length) return { matched: 0, ambiguous: [], unmatched: [] };

  const [rules, existing, applicableOccurrences] = await Promise.all([
    loadRules(client),
    loadExistingMatches(client, transactions.map((transaction) => transaction.id)),
    occurrences === null ? loadOccurrencesForTransactions(client, transactions) : Promise.resolve(occurrences),
  ]);

  const allocations = [];
  const ambiguous = [];
  const unmatched = [];

  for (const transaction of transactions) {
    const result = planAutomaticMatch({
      transaction,
      rules,
      occurrences: applicableOccurrences,
      existingMatch: existing.get(transaction.id) || null,
    });
    if (result.status === "matched") allocations.push(result.match);
    else if (result.status === "ambiguous") ambiguous.push({ transaction, result });
    else if (result.status === "unmatched") unmatched.push(transaction);
  }

  for (const allocation of allocations) {
    const { error } = await client.rpc("allocate_transaction_to_plan", {
      p_transaction_id: allocation.transaction_id,
      p_plan_id: allocation.plan_id,
      p_amount_cent: null,
      p_source: "rule",
      p_rule_id: allocation.rule_id,
    });
    if (error) throw error;
  }

  return { matched: allocations.length, ambiguous, unmatched };
}
