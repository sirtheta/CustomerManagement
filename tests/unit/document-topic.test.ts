import { describe, it, expect } from "vitest";
import { MAX_TOPIC_LENGTH, normalizeTopic, removeEmptyPlaceholder, resolveTopic, subscriptionPeriodLabel, workEntriesTopic } from "@/lib/document-topic";

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

describe("subscriptionPeriodLabel", () => {
  const d = (y: number, m: number, day = 1) => new Date(y, m - 1, day);

  it("names a month", () => {
    expect(subscriptionPeriodLabel(d(2026, 11, 15), "Monthly")).toBe("November 2026");
  });

  it("names calendar quarters and years", () => {
    expect(subscriptionPeriodLabel(d(2027, 1), "Quarterly")).toBe("Q1 2027");
    expect(subscriptionPeriodLabel(d(2027, 10, 20), "Quarterly")).toBe("Q4 2027");
    expect(subscriptionPeriodLabel(d(2027, 1, 31), "Yearly")).toBe("2027");
  });

  it("names the month range of other quarters and years", () => {
    expect(subscriptionPeriodLabel(d(2027, 2), "Quarterly")).toBe("Februar–April 2027");
    expect(subscriptionPeriodLabel(d(2026, 11), "Quarterly")).toBe("November 2026 – Januar 2027");
    expect(subscriptionPeriodLabel(d(2026, 11), "Yearly")).toBe("November 2026 – Oktober 2027");
  });
});

describe("resolveTopic", () => {
  it("fills {period}", () => {
    expect(resolveTopic("Hosting {period}", "2027")).toBe("Hosting 2027");
    expect(resolveTopic("{period}: Wartung", "Q1 2027")).toBe("Q1 2027: Wartung");
  });

  it("removes {period} with its separator when there is no period", () => {
    expect(resolveTopic("Hosting {period}")).toBe("Hosting");
    expect(resolveTopic("Hosting – {period}")).toBe("Hosting");
    expect(resolveTopic("Wartung ({period})")).toBe("Wartung");
  });

  it("returns null without a template or for a bare {period}", () => {
    expect(resolveTopic(null, "2027")).toBeNull();
    expect(resolveTopic("{period}")).toBeNull();
  });

  it("cuts a filled topic to the maximum length", () => {
    expect(resolveTopic(`${"a".repeat(95)} {period}`, "November 2026 – Oktober 2027")).toHaveLength(MAX_TOPIC_LENGTH);
  });
});

describe("removeEmptyPlaceholder", () => {
  it("works for any key", () => {
    expect(removeEmptyPlaceholder("Rechnung – {period} – Firma", "period")).toBe("Rechnung – Firma");
    expect(removeEmptyPlaceholder("Rechnung – {topic}", "period")).toBe("Rechnung – {topic}");
  });
});

describe("workEntriesTopic", () => {
  const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("names one month", () => {
    expect(workEntriesTopic(utc("2026-11-03"), utc("2026-11-28"))).toBe("Arbeiten November 2026");
  });

  it("names a month range, across a year end too", () => {
    expect(workEntriesTopic(utc("2026-10-30"), utc("2026-11-02"))).toBe("Arbeiten Oktober–November 2026");
    expect(workEntriesTopic(utc("2026-12-15"), utc("2027-01-10"))).toBe("Arbeiten Dezember 2026 – Januar 2027");
  });

  it("reads calendar days in UTC", () => {
    expect(workEntriesTopic(utc("2026-12-01"), utc("2026-12-31"))).toBe("Arbeiten Dezember 2026");
  });
});
