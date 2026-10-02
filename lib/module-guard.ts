import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getEnabledModules, type ModuleFlags, type ModuleKey } from "@/lib/modules";

export function loadModules(): Promise<ModuleFlags> {
  return getEnabledModules(prisma);
}

/**
 * Call at the top of pages and Server Actions that belong to an optional
 * module. A switched-off module is not reachable by URL either.
 */
export async function requireModule(key: ModuleKey): Promise<void> {
  if (!(await loadModules())[key]) redirect("/dashboard");
}

/** For route handlers: a switched-off module answers 404. */
export async function moduleDisabledResponse(key: ModuleKey): Promise<Response | null> {
  if ((await loadModules())[key]) return null;
  return new Response("Dieses Modul ist deaktiviert.", { status: 404 });
}
