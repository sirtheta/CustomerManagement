import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { computeAuditHash, GENESIS_HASH } from "@/lib/audit-chain";

const base = {
  prevHash: GENESIS_HASH,
  userId: 1,
  userName: "Admin",
  action: "CREATE",
  entityType: "Customer",
  entityId: 5,
  entityRef: "K-5",
  details: '{"a":1}',
  createdAt: new Date("2026-09-30T10:15:00.123Z"),
};

describe("computeAuditHash", () => {
  it("is a 64 char hex SHA-256 over the canonical JSON array", () => {
    const expected = createHash("sha256")
      .update(JSON.stringify(["GENESIS", 1, "Admin", "CREATE", "Customer", 5, "K-5", '{"a":1}', "2026-09-30T10:15:00.123Z"]))
      .digest("hex");
    expect(computeAuditHash(base)).toBe(expected);
    expect(computeAuditHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any single field changes", () => {
    const h = computeAuditHash(base);
    const variants = [
      { prevHash: "x" },
      { userId: 2 },
      { userName: "Other" },
      { action: "DELETE" },
      { entityType: "Invoice" },
      { entityId: 6 },
      { entityRef: "K-6" },
      { details: null },
      { createdAt: new Date("2026-09-30T10:15:00.124Z") },
    ];
    for (const v of variants) expect(computeAuditHash({ ...base, ...v })).not.toBe(h);
  });

  it("distinguishes null from an empty or 'null' string", () => {
    const a = computeAuditHash({ ...base, entityRef: null });
    expect(computeAuditHash({ ...base, entityRef: "" })).not.toBe(a);
    expect(computeAuditHash({ ...base, entityRef: "null" })).not.toBe(a);
  });
});
