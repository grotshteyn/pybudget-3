import { applyAutomaticRules } from "./rule-service.js";

export async function loadImportedTransactions(client, batchId) {
  if (!batchId) return [];
  const { data, error } = await client
    .from("transaction_observations")
    .select("transaction_id,transactions(id,account_id,status,amount_cent,booking_date,value_date,transaction_date,description,partner)")
    .eq("import_batch_id", batchId);
  if (error) throw error;

  const unique = new Map();
  for (const observation of data || []) {
    const transaction = observation.transactions;
    if (transaction?.id) unique.set(transaction.id, transaction);
  }
  return [...unique.values()];
}

export async function applyRulesAfterImport(client, importResult, { occurrences = null } = {}) {
  if (!importResult?.batch_id || importResult.already_imported) {
    return { skipped: true, reason: "no_new_import", matched: 0, ambiguous: [], unmatched: [] };
  }

  const transactions = await loadImportedTransactions(client, importResult.batch_id);
  // Reconciliation has completed before the import RPC returns. Open review rows have
  // no transaction observation yet, so they are naturally excluded until resolved.
  return {
    skipped: false,
    ...(await applyAutomaticRules(client, transactions, occurrences)),
  };
}
