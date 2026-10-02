import type { Session } from "next-auth";

/**
 * Actor for work done without a logged-in user (daily jobs, external API).
 * Audit, payment and archive rows need a user; id "0" marks "no real user",
 * `name` is what the audit log shows.
 */
export function systemActor(name: string, email = ""): Session {
  return {
    user: { id: "0", name, email, role: "Admin" },
    expires: "9999-12-31T23:59:59.999Z",
  } as Session;
}

/** Documents the subscription job sends on its own (autoSend). */
export const SYSTEM_ACTOR = systemActor("System (Abo)");

/** Payments booked through `POST /api/external/payments` (Budget app). */
export const BUDGET_IMPORT_ACTOR = systemActor("Budget-Import", "system@budget");
