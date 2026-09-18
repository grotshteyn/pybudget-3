import assert from "node:assert/strict";
import { applyRulesAfterImport } from "../rule-import-orchestrator.js";

let fromCalls = 0;
const skippedClient = { from() { fromCalls++; throw new Error("should not query"); } };
const skipped = await applyRulesAfterImport(skippedClient, { batch_id: "b1", already_imported: true });
assert.equal(skipped.skipped, true);
assert.equal(fromCalls, 0);

console.log("Rule import orchestration tests passed.");
