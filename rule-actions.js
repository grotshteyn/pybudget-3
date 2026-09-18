export async function createManualPlanMatch(client, userId, transactionId, planId) {
  const payload = {
    user_id: userId,
    transaction_id: transactionId,
    plan_id: planId,
    rule_id: null,
    source: "manual",
  };
  const { data, error } = await client
    .from("transaction_plan_matches")
    .upsert(payload, { onConflict: "transaction_id" })
    .select("id,transaction_id,plan_id,rule_id,source")
    .single();
  if (error) throw error;
  return data;
}

export async function createPartnerRule(client, userId, transaction, planId) {
  const partner = String(transaction.partner || "").trim();
  if (!partner) throw new Error("This transaction has no partner to match.");

  const { data: rule, error: ruleError } = await client
    .from("transaction_rules")
    .insert({
      user_id: userId,
      plan_id: planId,
      name: partner,
      enabled: true,
      priority: 0,
    })
    .select("id,plan_id,name,enabled,priority")
    .single();
  if (ruleError) throw ruleError;

  const { error: conditionError } = await client
    .from("transaction_rule_conditions")
    .insert({
      user_id: userId,
      rule_id: rule.id,
      field: "partner",
      operator: "contains",
      value: partner,
    });
  if (conditionError) {
    await client.from("transaction_rules").delete().eq("id", rule.id);
    throw conditionError;
  }
  return rule;
}
