import { selectRuleMatch } from "./rules.js";

export function transactionRuleDate(transaction) {
  return transaction.transaction_date || transaction.booking_date || transaction.value_date || null;
}

export function occurrenceApplies(transaction, occurrence) {
  const date = transactionRuleDate(transaction);
  if (!date || !occurrence) return false;
  if (occurrence.status === "cancelled" || occurrence.status_override === "cancelled") return false;
  return date >= occurrence.period_start && date <= occurrence.period_end;
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

  // Plan occurrences are not persisted on dev yet. Until that feature lands,
  // a rule can still create a plan-level assignment. Once occurrences are supplied,
  // applicability becomes mandatory and ambiguous periods remain unresolved.
  const occurrence = occurrences.length
    ? chooseOccurrence(transaction, selected.rule, occurrences)
    : { status: "matched", occurrence: null };
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

export async function applyAutomaticRules(client, transactions, occurrences = []) {
  if (!transactions.length) return { matched: 0, ambiguous: [], unmatched: [] };

  const [rules, existing] = await Promise.all([
    loadRules(client),
    loadExistingMatches(client, transactions.map((transaction) => transaction.id)),
  ]);

  const allocations = [];
  const ambiguous = [];
  const unmatched = [];

  for (const transaction of transactions) {
    const result = planAutomaticMatch({
      transaction,
      rules,
      occurrences,
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
