import assert from "node:assert/strict";
import fs from "node:fs";
import { applyRulesAfterImport } from "../rule-import-orchestrator.js";

let fromCalls = 0;
const skippedClient = { from() { fromCalls++; throw new Error("should not query"); } };
const skipped = await applyRulesAfterImport(skippedClient, {});
assert.equal(skipped.skipped, true);
assert.equal(skipped.reason, "no_import_batch");
assert.equal(fromCalls, 0);

const source = fs.readFileSync(new URL("../rule-import-orchestrator.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /importResult\.already_imported/);
assert.match(source, /occurrences = null/);\n\nconst appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");\nassert.match(appSource, /Rule post-processing failed after successful import/);\nassert.match(appSource, /rules pending retry/);

console.log("Rule import orchestration tests passed.");
