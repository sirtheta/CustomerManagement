import { describe, it, expect } from "vitest";
import { matchesMagicBytes } from "@/lib/file-validation";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("matchesMagicBytes", () => {
  it("accepts a real PDF header", () => {
    expect(matchesMagicBytes(".pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(true);
  });

  it("rejects HTML content declared as PDF", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(matchesMagicBytes(".pdf", html)).toBe(false);
  });

  it("accepts PNG, JPEG, GIF and BMP signatures", () => {
    expect(matchesMagicBytes(".png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe(true);
    expect(matchesMagicBytes(".jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesMagicBytes(".jpeg", bytes(0xff, 0xd8, 0xff, 0xe1))).toBe(true);
    expect(matchesMagicBytes(".gif", bytes(0x47, 0x49, 0x46, 0x38, 0x39))).toBe(true);
    expect(matchesMagicBytes(".bmp", bytes(0x42, 0x4d, 0x36))).toBe(true);
  });

  it("rejects an executable declared as PNG", () => {
    // MZ header of a Windows executable
    expect(matchesMagicBytes(".png", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
  });

  it("accepts ZIP container signature for OOXML formats", () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04);
    expect(matchesMagicBytes(".docx", zip)).toBe(true);
    expect(matchesMagicBytes(".xlsx", zip)).toBe(true);
    expect(matchesMagicBytes(".pptx", zip)).toBe(true);
    expect(matchesMagicBytes(".zip", zip)).toBe(true);
  });

  it("accepts RAR and 7z signatures", () => {
    expect(matchesMagicBytes(".rar", bytes(0x52, 0x61, 0x72, 0x21, 0x1a))).toBe(true);
    expect(matchesMagicBytes(".7z", bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27))).toBe(true);
  });

  it("does not check text formats (no binary signature)", () => {
    expect(matchesMagicBytes(".txt", new TextEncoder().encode("Hallo"))).toBe(true);
    expect(matchesMagicBytes(".md", new TextEncoder().encode("# Titel"))).toBe(true);
  });

  it("rejects truncated files shorter than the signature", () => {
    expect(matchesMagicBytes(".pdf", bytes(0x25, 0x50))).toBe(false);
    expect(matchesMagicBytes(".pdf", new Uint8Array(0))).toBe(false);
  });

  it("is case-insensitive on the extension", () => {
    expect(matchesMagicBytes(".PDF", bytes(0x25, 0x50, 0x44, 0x46))).toBe(true);
  });
});
