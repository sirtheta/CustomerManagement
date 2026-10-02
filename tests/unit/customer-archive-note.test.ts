import { describe, it, expect } from "vitest";
import { archiveSubscriptionNote } from "@/lib/customer-archive";

describe("archiveSubscriptionNote", () => {
  it("is empty without active subscriptions", () => {
    expect(archiveSubscriptionNote(0)).toBe("");
  });

  it("warns that active subscriptions are no longer billed", () => {
    expect(archiveSubscriptionNote(3)).toBe(
      "Dieser Kunde hat 3 aktive Abos. Sie werden nicht mehr verrechnet, solange er archiviert ist."
    );
  });

  it("uses the singular for one subscription", () => {
    expect(archiveSubscriptionNote(1)).toBe(
      "Dieser Kunde hat 1 aktives Abo. Es wird nicht mehr verrechnet, solange er archiviert ist."
    );
  });
});
