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

const fs = require("node:fs");
const path = require("node:path");
const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const sections = importer.parseComdirectText(fixture("comdirect-sections.csv"));
assert.equal(sections.transaction_count, 6);
assert.equal(sections.pending_count, 2);
assert.equal(sections.errors.length, 1);
assert.equal(sections.errors[0].code, "missing_booking_date_context");
const [giroAccount, cardAccount] = sections.accounts;
assert.equal(giroAccount.transactions[0].booking_date, "2024-02-29");
assert.equal(giroAccount.transactions[0].amount_cent, -123456);
assert.match(giroAccount.transactions[0].description, /Müller; Café/);
assert.notEqual(giroAccount.transactions[0].fallback_fingerprint, giroAccount.transactions[1].fallback_fingerprint);
assert.equal(giroAccount.transactions[2].booking_date, null);
assert.equal(cardAccount.transactions[2].booking_date, null);
assert.equal(cardAccount.transactions[0].booking_date, "2024-03-02");
assert.equal(cardAccount.transactions[0].bank_reference, "000 A  B/01");
assert.equal(cardAccount.transactions[1].bank_reference, "000 A  B/02");
assert.deepEqual(importer.parseComdirectText(fixture("comdirect-sections.csv")), sections);
const malformed = importer.parseComdirectText(fixture("comdirect-malformed.csv"));
assert.equal(malformed.errors.length, 6);
assert.equal(malformed.transaction_count, 1);
assert.equal(malformed.errors[1].code, "missing_booking_date_context");
for (const date of ["31.04.2026", "29.02.2025", "00.01.2026", "01.13.2026", "01.01.0000"]) {
  assert.throws(() => importer.parseGermanDate(date));
}
assert.equal(importer.parseGermanDate("29.02.2000"), "2000-02-29");
assert.throws(() => importer.parseGermanDate("29.02.1900"));
for (const amount of ["12.34,56", "1..234,56", ".123,00", "1.2345,00", "1,234", "90071992547409,92"]) {
  assert.throws(() => importer.parseGermanAmountToCents(amount));
}
assert.equal(importer.parseGermanAmountToCents("90.071.992.547.409,91"), Number.MAX_SAFE_INTEGER);
for (const csv of ['"unterminated', 'ab"cd";ef', '"abc"x;ef']) {
  assert.throws(() => importer.parseCsv(csv));
  assert.equal(importer.parseComdirectText(csv).errors[0].code, "invalid_csv");
}
assert.deepEqual(importer.parseCsv('"a;ä\nline";"say ""hello"""\r\n'), [["a;ä\nline", 'say "hello"']]);
console.log("Issue 5 regression tests passed");

for (const amount of ["1 234,56", "1EUR2", "1€2", "EUR 2,00"]) assert.throws(() => importer.parseGermanAmountToCents(amount));
assert.equal(importer.parseGermanAmountToCents(" 1.234,56 EUR "), 123456);
assert.equal(importer.parseComdirectText(fixture("comdirect-sections.csv").replaceAll("Referenz", "Reference")).accounts[1].transactions[0].bank_reference, "000 A  B/01");
