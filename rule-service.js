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
    .from("transaction_plan_matches")
    .select("id,transaction_id,plan_id,rule_id,source")
    .in("transaction_id", transactionIds);
  if (error) throw error;
  return new Map((data || []).map((match) => [match.transaction_id, match]));
}

export async function applyAutomaticRules(client, transactions, occurrences = []) {
  if (!transactions.length) return { matched: 0, ambiguous: [], unmatched: [] };

  const [rules, existing] = await Promise.all([
    loadRules(client),
    loadExistingMatches(client, transactions.map((transaction) => transaction.id)),
  ]);

  const inserts = [];
  const ambiguous = [];
  const unmatched = [];

  for (const transaction of transactions) {
    const result = planAutomaticMatch({
      transaction,
      rules,
      occurrences,
      existingMatch: existing.get(transaction.id) || null,
    });
    if (result.status === "matched") inserts.push(result.match);
    else if (result.status === "ambiguous") ambiguous.push({ transaction, result });
    else if (result.status === "unmatched") unmatched.push(transaction);
  }

  if (inserts.length) {
    const { error } = await client.from("transaction_plan_matches").insert(inserts);
    if (error) throw error;
  }

  return { matched: inserts.length, ambiguous, unmatched };
}
