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

  it("does not match a prefix that is the tail of another word", () => {
    expect(extractDocumentNumberCandidates("BILDI-26010042", P)).toEqual([]);
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
