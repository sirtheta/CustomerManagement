import { describe, expect, it } from "vitest";
import { extractDocumentNumberCandidates } from "@/lib/import/document-reference";

const P = "I-";

describe("extractDocumentNumberCandidates", () => {
  it("finds the canonical number in plain text", () => {
    expect(extractDocumentNumberCandidates("Zahlung I-26010042 danke", P)).toEqual(["I-26010042"]);
  });

  it("normalises case", () => {
    expect(extractDocumentNumberCandidates("rechnung i-26010042", P)).toEqual(["I-26010042"]);
  });

  it("tolerates spaces and separators between prefix and digits", () => {
    expect(extractDocumentNumberCandidates("Rg I 26010042", P)).toEqual(["I-26010042"]);
    expect(extractDocumentNumberCandidates("Rg I-2601 0042", P)).toEqual(["I-26010042"]);
    expect(extractDocumentNumberCandidates("Rg I-2601.0042", P)).toEqual(["I-26010042"]);
  });

  it("accepts the eight digits without the prefix when delimited", () => {
    expect(extractDocumentNumberCandidates("Rechnung 26010042 vom Januar", P)).toEqual(["I-26010042"]);
  });

  it("does not take eight digits out of a longer digit run", () => {
    expect(extractDocumentNumberCandidates("CH9300762011623852957", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Ref 1260100421", P)).toEqual([]);
  });

  it("accepts the bare digits with spaces or separators inside", () => {
    for (const text of [
      "Rg 2610 0135",
      "Rechnung 2610.0135 danke",
      "Nr. 2610-0135",
      "Rg 2610/0135",
      "26 10 01 35",
    ]) {
      expect(extractDocumentNumberCandidates(text, P)).toEqual(["I-26100135"]);
    }
  });

  it("does not take eight separated digits out of a longer grouped number", () => {
    // IBAN, QR reference and phone numbers in their usual grouping.
    expect(extractDocumentNumberCandidates("IBAN CH93 0076 2011 6238 5295 7", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Ref 21 00000 00003 13947 14300 09017", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Tel. 079 123 45 67", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Tel. +41 79 123 45 67", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Tel 0791 2345 67", P)).toEqual([]);
  });

  it("does not read a date as an invoice number", () => {
    expect(extractDocumentNumberCandidates("Zahlung vom 26.10.2025", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Valuta 26/10/2025", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Datum 2025-10-26", P)).toEqual([]);
  });

  it("still blocks a quote number written with spaces", () => {
    expect(extractDocumentNumberCandidates("Offerte Q-2601 0003", P)).toEqual([]);
  });

  it("does not match a prefix that is the tail of another word, only the bare digits", () => {
    // The prefix form is blocked behind a word character; the digits alone
    // still count as an invoice number candidate.
    expect(extractDocumentNumberCandidates("BILDI-26010042", P)).toEqual(["I-26010042"]);
  });

  it("accepts common payer spellings in front of the digits", () => {
    for (const text of ["Rg.26010042", "Nr.26010042", "Rechnung-26010042"]) {
      expect(extractDocumentNumberCandidates(text, P)).toEqual(["I-26010042"]);
    }
  });

  it("does not take the digits of another document type such as a quote number", () => {
    expect(extractDocumentNumberCandidates("Offerte Q-26010003", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Offerte Q26010003", P)).toEqual([]);
  });

  it("returns each number once, prefix form first", () => {
    expect(
      extractDocumentNumberCandidates("I-26010042 und 26010042 sowie I-26010099", P)
    ).toEqual(["I-26010042", "I-26010099"]);
  });
});
