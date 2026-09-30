import { describe, expect, it } from "vitest";
import { fingerprint, normalize, withFingerprints } from "@/lib/import/dedupe";
import type { ParsedTransaction } from "@/lib/import/types";

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-03-01",
    amountCents: -450,
    description: "Kaffee",
    counterparty: "Bäckerei",
    bankReference: null,
    ...overrides,
  };
}

const IBAN = "CH93 0076 2011 6238 5295 7";

describe("normalize", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalize("  Hallo   WELT ")).toBe("hallo welt");
    expect(normalize(null)).toBe("");
  });
});

describe("fingerprint", () => {
  it("lets the bank reference dominate the hash", () => {
    const a = fingerprint(IBAN, tx({ bankReference: "REF-1", description: "A" }), 0);
    const b = fingerprint(IBAN, tx({ bankReference: "REF-1", description: "B", amountCents: -1 }), 5);
    expect(a).toBe(b);
  });

  it("differs per IBAN and ignores IBAN spacing and case", () => {
    const base = tx({ bankReference: "REF-1" });
    expect(fingerprint(IBAN, base, 0)).toBe(fingerprint("ch9300762011623852957", base, 0));
    expect(fingerprint(IBAN, base, 0)).not.toBe(fingerprint("CH5604835012345678009", base, 0));
  });

  it("without a reference depends on date, amount, text, counterparty and occurrence", () => {
    const base = fingerprint(IBAN, tx(), 0);
    expect(base).toBe(fingerprint(IBAN, tx({ description: "  KAFFEE " }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx({ date: "2026-03-02" }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx({ amountCents: -451 }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx({ counterparty: "Metzger" }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx(), 1));
  });
});

describe("blank bank reference", () => {
  it("behaves exactly like a missing reference", () => {
    const a = fingerprint(IBAN, tx({ bankReference: "  ", description: "A" }), 0);
    const b = fingerprint(IBAN, tx({ bankReference: "  ", description: "B" }), 0);
    expect(a).not.toBe(b);
    expect(fingerprint(IBAN, tx({ bankReference: "  " }), 0)).toBe(fingerprint(IBAN, tx(), 0));
    const [first, second] = withFingerprints(IBAN, [tx({ bankReference: " " }), tx({ bankReference: " " })]);
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });
});

describe("withFingerprints", () => {
  it("numbers identical bookings so both import, and is stable across runs", () => {
    const list = [tx(), tx(), tx({ description: "Anderes" })];
    const first = withFingerprints(IBAN, list);
    const second = withFingerprints(IBAN, list);
    expect(first[0].fingerprint).not.toBe(first[1].fingerprint);
    expect(first.map((t) => t.fingerprint)).toEqual(second.map((t) => t.fingerprint));
    expect(new Set(first.map((t) => t.fingerprint)).size).toBe(3);
  });

  it("counts only reference-less rows, so a referenced twin does not shift the counter", () => {
    const plain = tx();
    const withRef = tx({ bankReference: "REF-9" });
    const [alone] = withFingerprints(IBAN, [plain]);
    const [, afterTwin] = withFingerprints(IBAN, [withRef, plain]);
    expect(afterTwin.fingerprint).toBe(alone.fingerprint);
  });

  it("keeps the parsed fields", () => {
    const [first] = withFingerprints(IBAN, [tx({ bankReference: "R" })]);
    expect(first.description).toBe("Kaffee");
    expect(first.bankReference).toBe("R");
  });
});
