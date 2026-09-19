export const RULE_FIELDS = Object.freeze(["partner", "description", "amount", "account"]);
export const RULE_OPERATORS = Object.freeze(["equals", "contains"]);

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function fieldValue(transaction, field) {
  switch (field) {
    case "partner":
      return transaction.partner;
    case "description":
      return transaction.description;
    case "amount":
      return transaction.amount_cent;
    case "account":
      return transaction.account_id ?? transaction.account_name;
    default:
      return undefined;
  }
}

export function conditionMatches(transaction, condition) {
  if (!RULE_FIELDS.includes(condition.field) || !RULE_OPERATORS.includes(condition.operator)) {
    return false;
  }

  const actual = fieldValue(transaction, condition.field);
  const expected = condition.value;

  if (condition.field === "amount") {
    if (condition.operator !== "equals") return false;
    try {
      return BigInt(actual) === BigInt(expected);
    } catch {
      return false;
    }
  }

  const left = normalize(actual);
  const right = normalize(expected);
  if (!right) return false;

  return condition.operator === "equals" ? left === right : left.includes(right);
}

export function ruleMatches(transaction, rule) {
  if (!rule?.enabled || !Array.isArray(rule.conditions) || !rule.conditions.length) return false;
  return rule.conditions.every((condition) => conditionMatches(transaction, condition));
}

export function matchingRules(transaction, rules) {
  return (rules || [])
    .filter((rule) => ruleMatches(transaction, rule))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || String(a.id).localeCompare(String(b.id)));
}

export function selectRuleMatch(transaction, rules) {
  const matches = matchingRules(transaction, rules);
  if (!matches.length) return { status: "unmatched", rule: null, matches: [] };

  const topPriority = matches[0].priority ?? 0;
  const top = matches.filter((rule) => (rule.priority ?? 0) === topPriority);
  const planIds = new Set(top.map((rule) => rule.plan_id));

  if (planIds.size > 1) return { status: "ambiguous", rule: null, matches: top };
  return { status: "matched", rule: top[0], matches: top };
}
