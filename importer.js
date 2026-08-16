(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PyBudgetImporter = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const BOOKING_TYPES = {
    "Übertrag / Überweisung": "transfer",
    "Lastschrift / Belastung": "direct_debit",
    "Auszahlung GAA": "withdrawal",
    Kartenverfügung: "card_transaction",
    Entgelte: "fees",
    Kontoführungsentgelt: "fees",
    Kontoabschluss: "interest",
    "Visa-Umsatz": "visa_transaction",
    "Visa-Kartenabrechnung": "visa_bill",
    Gutschrift: "account_credit",
    "Entgeltstorno 3-Raten-Service": "fees",
    "Entgelt 3-Raten-Service": "fees",
    "Rate 3-Raten-Service": "visa_bill",
    "Anlage 3-Raten-Service": "visa_bill"
  };

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ";") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    return rows;
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseGermanAmountToCents(value) {
    const cleaned = String(value || "")
      .replace(/\s|€|EUR/gi, "")
      .trim();
    if (!/^-?[\d.]+(?:,\d{1,2})?$/.test(cleaned)) {
      throw new Error(`Invalid amount: ${value}`);
    }
    const negative = cleaned.startsWith("-");
    const unsigned = negative ? cleaned.slice(1) : cleaned;
    const [wholeRaw, fractionRaw = ""] = unsigned.split(",");
    const whole = wholeRaw.replace(/\./g, "");
    const fraction = (fractionRaw + "00").slice(0, 2);
    const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
    if (!Number.isSafeInteger(cents)) throw new Error("Amount exceeds safe range");
    return negative ? -cents : cents;
  }

  function parseGermanDate(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || normalized === "offen" || normalized === "--") return null;
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(normalized);
    if (!match) throw new Error(`Invalid date: ${value}`);
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  function extractReference(referenceColumn, description) {
    const dedicated = normalizeWhitespace(referenceColumn);
    if (dedicated) return dedicated;
    const match = /\bRef\.\s*([^\s;]+)/i.exec(String(description || ""));
    return match ? match[1].trim() : null;
  }

  function extractPartner(description, bookingType) {
    const text = normalizeWhitespace(description);
    if (!text) return null;
    if (bookingType === "fees" || bookingType === "interest" || bookingType === "visa_bill") {
      return "comdirect";
    }
    return normalizeWhitespace(
      text
        .split("Buchungstext:")[0]
        .split("Kto/IBAN")[0]
        .split("Ref.")[0]
        .replace(/^Auftraggeber:\s*/i, "")
        .replace(/^Empfänger:\s*/i, "")
    ) || null;
  }

  function stableAccountKey(name) {
    return `comdirect:${normalizeWhitespace(name).toLowerCase()}`;
  }

  function fallbackBase(accountKey, tx) {
    return [
      accountKey,
      tx.amount_cent,
      tx.transaction_date || tx.value_date || tx.booking_date || "",
      normalizeWhitespace(tx.partner).toLowerCase(),
      normalizeWhitespace(tx.description).toLowerCase(),
      tx.booking_type || ""
    ].join("|");
  }

  function simpleStableHash(value) {
    let h1 = 0xdeadbeef ^ value.length;
    let h2 = 0x41c6ce57 ^ value.length;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  }

  function parsePeriod(row) {
    const text = row.join(" ");
    const match = /Zeitraum:\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i.exec(text);
    return match ? { start: parseGermanDate(match[1]), end: parseGermanDate(match[2]) } : null;
  }

  function parseComdirectText(text) {
    const rows = parseCsv(text);
    const accounts = [];
    const errors = [];
    let current = null;
    let header = null;
    let periodStart = null;
    let periodEnd = null;

    rows.forEach((row, sourceIndex) => {
      const first = normalizeWhitespace(row[0]);
      if (!first) return;

      if (first.startsWith("Umsätze ")) {
        const displayName = first.slice("Umsätze ".length).trim();
        current = {
          external_key: stableAccountKey(displayName),
          display_name: displayName,
          currency: "EUR",
          transactions: []
        };
        accounts.push(current);
        header = null;
        const period = parsePeriod(row);
        if (period) {
          periodStart = periodStart || period.start;
          periodEnd = periodEnd || period.end;
        }
        return;
      }

      const period = parsePeriod(row);
      if (period) {
        periodStart = periodStart || period.start;
        periodEnd = periodEnd || period.end;
        return;
      }

      if (first === "Buchungstag") {
        header = row.map(normalizeWhitespace);
        return;
      }

      if (!current || !header) return;
      const raw = {};
      header.forEach((name, index) => {
        if (name) raw[name] = row[index] ?? "";
      });

      try {
        const bookingDate = parseGermanDate(raw.Buchungstag);
        const valueDate = parseGermanDate(raw["Wertstellung (Valuta)"]);
        const transactionDate = parseGermanDate(raw.Umsatztag);
        const description = normalizeWhitespace(raw.Buchungstext);
        const bookingTypeRaw = normalizeWhitespace(raw.Vorgang);
        const tx = {
          row_sequence: sourceIndex,
          status: bookingDate ? "booked" : "pending",
          amount_cent: parseGermanAmountToCents(raw["Umsatz in EUR"]),
          currency: "EUR",
          booking_date: bookingDate,
          value_date: valueDate,
          transaction_date: transactionDate,
          booking_type: BOOKING_TYPES[bookingTypeRaw] || bookingTypeRaw || null,
          description: description || null,
          partner: extractPartner(description, BOOKING_TYPES[bookingTypeRaw] || bookingTypeRaw),
          bank_reference: extractReference(raw.Referenz, description),
          raw_row: raw
        };
        const base = fallbackBase(current.external_key, tx);
        const occurrence = current.transactions.filter((item) => item._fallback_base === base).length + 1;
        tx._fallback_base = base;
        tx.fallback_fingerprint = simpleStableHash(`${base}|occurrence:${occurrence}`);
        current.transactions.push(tx);
      } catch (error) {
        errors.push({ row: sourceIndex + 1, message: error.message });
      }
    });

    accounts.forEach((account) => {
      account.transactions.forEach((tx) => delete tx._fallback_base);
    });

    const transactionCount = accounts.reduce((sum, account) => sum + account.transactions.length, 0);
    const pendingCount = accounts.reduce(
      (sum, account) => sum + account.transactions.filter((tx) => tx.status === "pending").length,
      0
    );
    return {
      source: "comdirect",
      period_start: periodStart,
      period_end: periodEnd,
      accounts,
      errors,
      transaction_count: transactionCount,
      pending_count: pendingCount
    };
  }

  function decodeComdirectBytes(bytes) {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }

  async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function parseComdirectFile(file) {
    const buffer = await file.arrayBuffer();
    const parsed = parseComdirectText(decodeComdirectBytes(buffer));
    return { ...parsed, file_name: file.name, file_sha256: await sha256Hex(buffer) };
  }

  return {
    parseCsv,
    parseGermanAmountToCents,
    parseGermanDate,
    extractReference,
    parseComdirectText,
    decodeComdirectBytes,
    parseComdirectFile
  };
});
