import { describe, it, expect } from "vitest";
import { actionToastFor } from "@/lib/action-toast";

describe("actionToastFor", () => {
  it("shows an error returned without _ts on the first submit", () => {
    // createTask/createSubscription return { error } without _ts; this used to be swallowed.
    const state = { error: "Bitte eine gültige Fälligkeit angeben." };
    expect(actionToastFor(state, {}, "Aufgabe erstellt")).toEqual({
      kind: "error",
      message: "Bitte eine gültige Fälligkeit angeben.",
    });
  });

  it("shows a second, identical error as a new state object", () => {
    const first = { error: "Titel ist erforderlich" };
    const second = { error: "Titel ist erforderlich" };
    expect(actionToastFor(second, first, "x")).toEqual({ kind: "error", message: "Titel ist erforderlich" });
  });

  it("does not repeat a toast for the same state object (re-render, Strict Mode effect re-run)", () => {
    const state = { success: true, _ts: 1 };
    expect(actionToastFor(state, undefined, "Gespeichert")).toEqual({ kind: "success", message: "Gespeichert" });
    expect(actionToastFor(state, state, "Gespeichert")).toBeNull();
  });

  it("ignores the initial empty state and a missing state", () => {
    expect(actionToastFor({}, undefined, "Gespeichert")).toBeNull();
    expect(actionToastFor(undefined, undefined, "Gespeichert")).toBeNull();
  });

  it("can leave errors to an inline message", () => {
    expect(actionToastFor({ error: "Fehler" }, {}, "x", { toastErrors: false })).toBeNull();
    expect(actionToastFor({ success: true }, {}, "Ok", { toastErrors: false })).toEqual({
      kind: "success",
      message: "Ok",
    });
  });
});
