import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import { allModulesEnabled } from "@/lib/modules";
import { buildNavigation } from "@/lib/navigation";

describe("navigation: Zeiterfassung", () => {
  const hrefs = (role: UserRole, off = false) => {
    const modules = allModulesEnabled();
    if (off) modules.timeTracking = false;
    return buildNavigation(role, modules).map((e) => e.href);
  };

  it("shows the entry to editors and admins", () => {
    expect(hrefs(UserRole.Editor)).toContain("/time");
    expect(hrefs(UserRole.Admin)).toContain("/time");
  });

  it("hides it from viewers", () => {
    expect(hrefs(UserRole.Viewer)).not.toContain("/time");
  });

  it("hides it while the module is off", () => {
    expect(hrefs(UserRole.Admin, true)).not.toContain("/time");
  });

  it("offers the capture and the open-entries page as children", () => {
    const entry = buildNavigation(UserRole.Editor, allModulesEnabled()).find((e) => e.href === "/time");
    expect(entry?.children?.map((c) => c.href)).toEqual(["/time", "/time/open"]);
  });
});
