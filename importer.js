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
    let closed = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
          closed = true;
        } else {
          field += char;
        }
      } else if (char === '"') {
        if (field || closed) throw new Error("Invalid CSV: unexpected quote");
        quoted = true;
      } else if (char === ";") {
        row.push(field);
        field = "";
        closed = false;
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
        closed = false;
      } else {
        if (closed && !(char === "\r" && (text[i + 1] === "\n" || i === text.length - 1))) throw new Error("Invalid CSV: characters after closing quote");
        field += char;
      }
    }

    if (quoted) throw new Error("Invalid CSV: unterminated quoted field");
    if (field || row.length || closed) {
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
      .trim()
      .replace(/\s*(?:€|EUR)$/i, "")
      .trim();
    if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(cleaned)) {
      throw new Error(`Invalid amount: ${value}`);
    }
    const negative = cleaned.startsWith("-");
    const unsigned = negative ? cleaned.slice(1) : cleaned;
    const [wholeRaw, fractionRaw = ""] = unsigned.split(",");
    const whole = wholeRaw.replace(/\./g, "");
    const fraction = (fractionRaw + "00").slice(0, 2);
    const exact = BigInt(whole) * 100n + BigInt(fraction);
    if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds safe range");
    const cents = Number(exact);
    return negative ? -cents : cents;
  }

  function parseGermanDate(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || normalized === "offen" || normalized === "--") return null;
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(normalized);
    if (!match) throw new Error(`Invalid date: ${value}`);
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      throw new Error("Invalid date: " + value);
    }
    return match[3] + "-" + match[2] + "-" + match[1];
  }

  function extractReference(referenceColumn, description) {
    const dedicated = String(referenceColumn || "").trim();
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
    const cells = normalizeWhitespace(row[0]).startsWith("Umsätze ") ? row.slice(1) : row;
    const text = normalizeWhitespace(cells.join(" "));
    const match = /^Zeitraum:\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})$/i.exec(text);
    return match ? { start: parseGermanDate(match[1]), end: parseGermanDate(match[2]) } : null;
  }

  function isSummaryRow(row) {
    const first = normalizeWhitespace(row[0]);
    const balances = /^(?:Kontostand|Aktueller Kontostand|Saldo|Anfangssaldo|Endsaldo|Alter Kontostand|Neuer Kontostand|Summe|Gesamtsumme|Verfügbarer Betrag)(?:\b|:)/i;
    const emptyNotice = /^(?:Keine Umsätze|Keine Buchungen|Keine Transaktionen|Es liegen keine Umsätze)(?:\b|:)/i;
    const remaining = row.slice(1).filter((cell) => normalizeWhitespace(cell));
    if (emptyNotice.test(first)) return remaining.length === 0;
    if (!balances.test(first)) return false;
    // Summary values may occupy date columns, but transaction text is never a summary.
    return remaining.every((cell) => {
      try {
        parseGermanAmountToCents(cell);
        return true;
      } catch (_) {
        return false;
      }
    });
  }

  function parseComdirectText(text) {
    let rows;
    try {
      rows = parseCsv(text.replace(/^\uFEFF/, ""));
    } catch (error) {
      return {
        source: "comdirect", period_start: null, period_end: null, accounts: [],
        errors: [{ code: "invalid_csv", row: null, message: error.message }],
        transaction_count: 0, pending_count: 0
      };
    }
    const accounts = [];
    const errors = [];
    let current = null;
    let header = null;
    let dateContext = null;
    let periodStart = null;
    let periodEnd = null;

    rows.forEach((row, sourceIndex) => {
      const first = normalizeWhitespace(row[0]);
      if (row.every((cell) => !normalizeWhitespace(cell))) return;
      try {
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
          dateContext = null;
          const period = parsePeriod(row);
          if (period) {
            periodStart = periodStart || period.start;
            periodEnd = periodEnd || period.end;
          }
          return;
        }

        const period = /^Zeitraum:/i.test(first) ? parsePeriod(row) : null;
        if (period) {
          periodStart = periodStart || period.start;
          periodEnd = periodEnd || period.end;
          return;
        }

        if (first === "Buchungstag") {
          header = row.map(normalizeWhitespace);
          if (!["Vorgang", "Buchungstext", "Umsatz in EUR"].every((name) => header.includes(name))) {
            header = null;
            throw new Error("Unsupported transaction header");
          }
          return;
        }

        if (!current || !header) return;
        if (isSummaryRow(row)) return;
        if (first && row.slice(1).every((cell) => !normalizeWhitespace(cell))) {
          // An invalid context row must never leave an older booking date active.
          dateContext = null;
          dateContext = parseGermanDate(first);
          if (!dateContext) throw new Error("Invalid date-only context row: " + first);
          return;
        }
        const width = (cells) => {
          let n = cells.length;
          while (n && cells[n - 1] === "") n -= 1;
          return n;
        };
        if (width(row) !== width(header)) throw new Error("Invalid transaction column count");
        const raw = {};
        header.forEach((name, index) => {
          if (name) raw[name] = row[index] ?? "";
        });

        const marker = normalizeWhitespace(raw.Buchungstag).toLowerCase();
        if (marker === "neu" && !dateContext) {
          const error = new Error("Booked transaction has no preceding date in this account section");
          error.code = "missing_booking_date_context";
          throw error;
        }
        const bookingDate = marker === "neu" ? dateContext : parseGermanDate(raw.Buchungstag);
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
          bank_reference: extractReference(raw.Referenz || raw.Reference, description),
          raw_row: raw
        };
        const base = fallbackBase(current.external_key, tx);
        const occurrence = current.transactions.filter((item) => item._fallback_base === base).length + 1;
        tx._fallback_base = base;
        tx.fallback_fingerprint = simpleStableHash(`${base}|occurrence:${occurrence}`);
        current.transactions.push(tx);
      } catch (error) {
        errors.push({ code: error.code || "invalid_row", row: sourceIndex + 1, message: error.message });
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
