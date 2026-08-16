const assert = require("node:assert/strict");
const importer = require("../importer.js");

const csv = [
  '"Umsätze Girokonto";"Zeitraum: 01.01.2026 - 31.03.2026";',
  '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR";',
  '"12.03.2026";"12.03.2026";"Lastschrift / Belastung";"Auftraggeber: CAFÉ TEST Buchungstext: Karte Ref. ABC123/1";"-12,34";',
  '"offen";"--";"Lastschrift / Belastung";"Auftraggeber: SHOP TEST Buchungstext: Pending Ref. PENDING1";"-20,00";',
  '',
  '"Umsätze Visa-Karte ..1234";"Zeitraum: 01.01.2026 - 31.03.2026";',
  '"Buchungstag";"Umsatztag";"Vorgang";"Referenz";"Buchungstext";"Umsatz in EUR";',
  '"13.03.2026";"11.03.2026";"Visa-Umsatz";"CARDREF1";"EXAMPLE SHOP";"-5,50";'
].join("\r\n");

const result = importer.parseComdirectText(csv);
assert.equal(result.accounts.length, 2);
assert.equal(result.transaction_count, 3);
assert.equal(result.pending_count, 1);
assert.equal(result.period_start, "2026-01-01");
assert.equal(result.period_end, "2026-03-31");
assert.equal(result.accounts[0].transactions[0].amount_cent, -1234);
assert.equal(result.accounts[0].transactions[0].bank_reference, "ABC123/1");
assert.equal(result.accounts[0].transactions[1].status, "pending");
assert.equal(result.accounts[1].transactions[0].bank_reference, "CARDREF1");
assert.equal(result.errors.length, 0);

assert.equal(importer.parseGermanAmountToCents("3.359,53"), 335953);
assert.equal(importer.parseGermanAmountToCents("-0,90"), -90);
assert.equal(importer.parseGermanDate("offen"), null);
assert.throws(() => importer.parseGermanAmountToCents("not money"));

const repeated = importer.parseComdirectText(csv);
assert.deepEqual(repeated, result);

const identicalRows = [
  '"Umsätze Girokonto";"Zeitraum: 01.01.2026 - 31.03.2026";',
  '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR";',
  '"offen";"--";"Lastschrift / Belastung";"Same pending row";"-10,00";',
  '"offen";"--";"Lastschrift / Belastung";"Same pending row";"-10,00";'
].join("\r\n");
const identicalResult = importer.parseComdirectText(identicalRows);
const [firstPending, secondPending] = identicalResult.accounts[0].transactions;
assert.notEqual(firstPending.fallback_fingerprint, secondPending.fallback_fingerprint);
assert.deepEqual(importer.parseComdirectText(identicalRows), identicalResult);

console.log("Importer tests passed");
