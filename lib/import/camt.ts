import { XMLParser } from "fast-xml-parser";
import { isValidDateString } from "@/lib/date";
import type { ParsedStatement, ParsedTransaction } from "@/lib/import/types";

/**
 * CAMT.053 (ISO 20022 "Bank to Customer Statement") parser.
 *
 * CAMT.053 is the format to import from: it is the definitive account
 * statement, so every entry is booked (not pending), and it carries opening
 * and closing balances that let the import verify it was complete. CAMT.054
 * only avises individual credits, and MT940 is the superseded SWIFT format —
 * neither is worth a second parser.
 *
 * Every Swiss bank emits slightly different CAMT: namespace prefixes vary,
 * counterparty names sit at different levels, and version 001.02 through
 * 001.08 move fields around. The parser therefore strips namespaces, treats
 * every repeatable element as possibly-single, and falls back through several
 * locations for description and counterparty.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Banks emit <ns2:Document>, <Document>, <camt:Document> … stripping the
  // prefix is what makes one code path work across all of them.
  removeNSPrefix: true,
  // Keep values as strings: "100.00" must not become a float before it is
  // converted to Rappen, and "2026-01-05" must not be coerced to a number.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

/**
 * Francs → Rappen, rounded half-away-from-zero. Local to statement parsing —
 * the rest of the app keeps amounts as Prisma `Decimal` francs, not cents.
 */
function toCents(francs: number): number {
  const scaled = Number((Math.abs(francs) * 100).toFixed(4));
  return (francs < 0 ? -1 : 1) * Math.round(scaled);
}

/** fast-xml-parser yields an object for one occurrence and an array for many. */
function toArray(value: Node): Node[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text of a node, whether it was parsed as a bare string or as `{ "#text": … }`. */
function text(value: Node): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && "#text" in value) {
    const inner = value["#text"];
    return inner === undefined || inner === null ? null : String(inner).trim() || null;
  }
  return null;
}

/** First non-empty text found by walking the given paths in order. */
function firstText(node: Node, paths: string[][]): string | null {
  for (const path of paths) {
    let current: Node = node;
    for (const key of path) {
      current = current?.[key];
      if (current === undefined) break;
    }
    const value = text(Array.isArray(current) ? current[0] : current);
    if (value) return value;
  }
  return null;
}

/** `<Dt><Dt>2026-01-05</Dt></Dt>` and `<Dt><DtTm>2026-01-05T…</DtTm></Dt>`. */
function dateOf(node: Node): string | null {
  const raw = firstText(node, [["Dt"], ["DtTm"]]);
  if (!raw) return null;
  const day = raw.slice(0, 10);
  return isValidDateString(day) ? day : null;
}

/** Signed Rappen from an `<Amt>` plus the `<CdtDbtInd>` that gives it direction. */
function signedAmount(amountNode: Node, indicator: string | null): number | null {
  const raw = text(amountNode);
  if (!raw) return null;
  const francs = Number(raw.replace(/[\s']/g, ""));
  if (!Number.isFinite(francs)) return null;
  const cents = toCents(Math.abs(francs));
  // DBIT = money leaves the account. Anything else (CRDT) is money in.
  return indicator === "DBIT" ? -cents : cents;
}

/**
 * Counterparty of an entry. Which side is "the other party" depends on the
 * direction: for a debit the money goes to the creditor, for a credit it
 * comes from the debtor.
 */
function counterpartyOf(txDetails: Node, entry: Node, isDebit: boolean): string | null {
  const parties = txDetails?.RltdPties ?? entry?.NtryDtls?.TxDtls?.RltdPties;
  if (!parties) return null;
  const preferred = isDebit ? ["Cdtr", "Dbtr"] : ["Dbtr", "Cdtr"];
  for (const side of preferred) {
    const party = parties[side];
    const name = firstText(party, [["Nm"], ["Pty", "Nm"]]);
    if (name) return name;
  }
  return null;
}

/**
 * Description of an entry, preferring the structured remittance information
 * the payer supplied over the bank's own booking text.
 */
function descriptionOf(txDetails: Node, entry: Node, counterparty: string | null): string {
  const unstructured = toArray(txDetails?.RmtInf?.Ustrd)
    .map(text)
    .filter((value): value is string => !!value)
    .join(" ");
  if (unstructured) return unstructured;

  const structured = firstText(txDetails, [
    ["RmtInf", "Strd", "CdtrRefInf", "Ref"],
    ["RmtInf", "Strd", "AddtlRmtInf"],
  ]);
  if (structured) return structured;

  const additional = firstText(entry, [["AddtlNtryInf"]]);
  if (additional) return additional;

  return counterparty ?? "Ohne Beschreibung";
}

/**
 * Placeholder banks emit for a reference field they don't actually populate —
 * seen on `EndToEndId`, `InstrId`, and `TxId` alike (e.g. card/ATM bookings
 * that never got a real SEPA reference). It repeats across bookings, so it
 * must never be accepted as a fingerprinting reference: two distinct card
 * withdrawals with no real reference would otherwise collide.
 */
function isPlaceholderRef(value: string | null): boolean {
  return value === null || value.toUpperCase() === "NOTPROVIDED";
}

/**
 * Bank reference used to fingerprint an entry.
 *
 * `AcctSvcrRef` is the bank's own reference and is unique per booking, so it
 * wins wherever it sits — banks put it on the `Ntry` as often as on the
 * `TxDtls`. `EndToEndId`, `TxId`, and `InstrId` only come next because they
 * are frequently unpopulated placeholders (see `isPlaceholderRef`).
 *
 * The entry-level fallback (`entry.AcctSvcrRef` / `NtryRef`) is only valid for
 * a single-`TxDtls` entry. A collective booking (Sammelbuchung) has several
 * `TxDtls` under one `Ntry`, and that `Ntry`-level reference belongs to the
 * collective booking as a whole — falling back to it for each split leg would
 * hand every leg without its own reference the same fingerprint.
 */
function referenceOf(txDetails: Node, entry: Node, allowEntryFallback = true): string | null {
  const accountServicerRef =
    firstText(txDetails, [["Refs", "AcctSvcrRef"]]) ??
    (allowEntryFallback ? firstText(entry, [["AcctSvcrRef"], ["NtryRef"]]) : null);
  if (!isPlaceholderRef(accountServicerRef)) return accountServicerRef;

  const endToEnd = firstText(txDetails, [["Refs", "EndToEndId"]]);
  if (!isPlaceholderRef(endToEnd)) return endToEnd;

  const txId = firstText(txDetails, [["Refs", "TxId"], ["Refs", "InstrId"]]);
  if (!isPlaceholderRef(txId)) return txId;

  return null;
}

/** Balance of a given ISO type code (`OPBD` opening, `CLBD` closing booked). */
function balanceOf(statement: Node, codes: string[]): number | null {
  for (const code of codes) {
    for (const balance of toArray(statement?.Bal)) {
      const type = firstText(balance, [
        ["Tp", "CdOrPrtry", "Cd"],
        ["Tp", "CdOrPrtry", "Prtry"],
      ]);
      if (type !== code) continue;
      const amount = signedAmount(balance.Amt, firstText(balance, [["CdtDbtInd"]]));
      if (amount !== null) return amount;
    }
  }
  return null;
}

/**
 * Parses a CAMT.053 document.
 *
 * A file may contain several `<Stmt>` blocks (e.g. one per month); all of them
 * are merged, and the period and closing balance are taken from the last one
 * so the balance check compares against the most recent state.
 */
export function parseCamt053(xml: string): ParsedStatement {
  let document: Node;
  try {
    document = parser.parse(xml);
  } catch (err) {
    throw new Error(
      `Die Datei konnte nicht als XML gelesen werden: ${err instanceof Error ? err.message : "Unbekannter Fehler"}`
    );
  }

  const root = document?.Document?.BkToCstmrStmt;
  if (!root) {
    throw new Error(
      "Kein CAMT.053-Kontoauszug erkannt (erwartet wird <Document><BkToCstmrStmt>). " +
        "Bitte prüfen, ob versehentlich eine CAMT.054-Avisierung exportiert wurde."
    );
  }

  const statements = toArray(root.Stmt);
  if (statements.length === 0) {
    throw new Error("Der Kontoauszug enthält keine <Stmt>-Elemente.");
  }

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];
  let iban: string | null = null;
  let currency: string | null = null;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  let closingBalanceCents: number | null = null;
  let openingBalanceCents: number | null = null;

  for (const statement of statements) {
    iban ??= firstText(statement, [
      ["Acct", "Id", "IBAN"],
      ["Acct", "Id", "Othr", "Id"],
    ]);
    currency ??= firstText(statement, [["Acct", "Ccy"]]);

    const from = dateOf(statement?.FrToDt?.FrDtTm ? { Dt: statement.FrToDt.FrDtTm } : statement?.FrToDt);
    periodFrom ??= from ?? firstText(statement, [["FrToDt", "FrDtTm"]])?.slice(0, 10) ?? null;
    periodTo = firstText(statement, [["FrToDt", "ToDtTm"]])?.slice(0, 10) ?? periodTo;

    openingBalanceCents ??= balanceOf(statement, ["OPBD", "PRCD"]);
    const closing = balanceOf(statement, ["CLBD", "CLAV"]);
    if (closing !== null) closingBalanceCents = closing;

    for (const entry of toArray(statement.Ntry)) {
      const status = firstText(entry, [["Sts"], ["Sts", "Cd"]]);
      // Pending entries can still change amount or date; importing them would
      // create a row that never reconciles against the next statement.
      if (status && status !== "BOOK") {
        warnings.push(`Eine nicht verbuchte Bewegung (Status ${status}) wurde übersprungen.`);
        continue;
      }

      const entryDate =
        dateOf(entry.BookgDt) ?? dateOf(entry.ValDt) ?? periodTo ?? periodFrom;
      const entryIndicator = firstText(entry, [["CdtDbtInd"]]);
      const details = toArray(entry?.NtryDtls?.TxDtls);

      if (!entryDate) {
        warnings.push("Eine Bewegung ohne Buchungsdatum wurde übersprungen.");
        continue;
      }

      // A collective booking (Sammelbuchung) carries several TxDtls under one
      // Ntry; each is a real transaction and has to be imported separately.
      if (details.length > 1) {
        for (const txDetails of details) {
          const indicator = firstText(txDetails, [["CdtDbtInd"]]) ?? entryIndicator;
          const amountCents = signedAmount(txDetails.Amt ?? entry.Amt, indicator);
          if (amountCents === null) {
            warnings.push("Eine Teilbuchung ohne lesbaren Betrag wurde übersprungen.");
            continue;
          }
          const counterparty = counterpartyOf(txDetails, entry, indicator === "DBIT");
          transactions.push({
            date: entryDate,
            amountCents,
            description: descriptionOf(txDetails, entry, counterparty),
            counterparty,
            bankReference: referenceOf(txDetails, entry, false),
          });
        }
        continue;
      }

      const txDetails = details[0];
      const amountCents = signedAmount(entry.Amt, entryIndicator);
      if (amountCents === null) {
        warnings.push("Eine Bewegung ohne lesbaren Betrag wurde übersprungen.");
        continue;
      }
      const counterparty = counterpartyOf(txDetails, entry, entryIndicator === "DBIT");
      transactions.push({
        date: entryDate,
        amountCents,
        description: descriptionOf(txDetails, entry, counterparty),
        counterparty,
        bankReference: referenceOf(txDetails, entry),
      });
    }
  }

  if (transactions.length === 0) {
    warnings.push("Der Kontoauszug enthält keine verbuchten Bewegungen.");
  }

  return {
    transactions,
    iban,
    currency,
    closingBalanceCents,
    openingBalanceCents,
    periodFrom,
    periodTo,
    // Repeated warnings (e.g. twenty pending entries) would bury the useful
    // ones — collapse them.
    warnings: [...new Set(warnings)],
  };
}
