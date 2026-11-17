import { describe, it, expect } from "vitest";
import { MAX_TOPIC_LENGTH, normalizeTopic } from "@/lib/document-topic";

describe("normalizeTopic", () => {
  it("keeps one trimmed line", () => {
    expect(normalizeTopic("  Hosting\r\n  2027\t")).toBe("Hosting 2027");
  });

  it("turns empty and missing values into null", () => {
    expect(normalizeTopic("   ")).toBeNull();
    expect(normalizeTopic(null)).toBeNull();
    expect(normalizeTopic(undefined)).toBeNull();
  });

  it("cuts to the maximum length without a trailing space", () => {
    expect(normalizeTopic("a".repeat(MAX_TOPIC_LENGTH + 20))).toHaveLength(MAX_TOPIC_LENGTH);
    expect(normalizeTopic(`${"a".repeat(MAX_TOPIC_LENGTH - 1)} b`)).toBe("a".repeat(MAX_TOPIC_LENGTH - 1));
  });
});
