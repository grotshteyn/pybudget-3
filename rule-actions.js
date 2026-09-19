export async function allocateTransaction(client, transactionId, planId, amountCent = null, source = "manual", ruleId = null) {
  const { data, error } = await client.rpc("allocate_transaction_to_plan", {
    p_transaction_id: transactionId,
    p_plan_id: planId,
    p_amount_cent: amountCent,
    p_source: source,
    p_rule_id: ruleId,
  });
  if (error) throw error;
  return data;
}

export async function unallocateTransaction(client, transactionId, planId, source = null) {
  const { data, error } = await client.rpc("unallocate_transaction_from_plan", {
    p_transaction_id: transactionId,
    p_plan_id: planId,
    p_source: source,
  });
  if (error) throw error;
  return data;
}

export async function createManualPlanMatch(client, userId, transactionId, planId, amountCent = null) {
  return allocateTransaction(client, transactionId, planId, amountCent, "manual", null);
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


export async function applyPartnerRuleToExistingTransactions(client, rule, partner) {
  const normalizedPartner = String(partner || "").trim();
  if (!normalizedPartner) return { matched: 0, ambiguous: [], unmatched: [] };

  const { data: transactions, error } = await client
    .from("transactions")
    .select("id,account_id,status,amount_cent,booking_date,value_date,transaction_date,description,partner")
    .neq("status", "cancelled")
    .ilike("partner", `%${normalizedPartner}%`);
  if (error) throw error;

  const { applyAutomaticRules } = await import("./rule-service.js");
  return applyAutomaticRules(client, transactions || []);
}
