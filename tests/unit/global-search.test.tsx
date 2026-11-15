// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
const searchAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/search/actions", () => ({
  searchAction: (q: string) => searchAction(q),
}));

import { GlobalSearch } from "@/components/global-search";

const RESULTS = {
  customers: [
    {
      customerId: 7,
      company: null,
      contactPerson: "Silvia Jäggi",
      contactInsteadOfCompany: true,
      zipCode: "3612",
      city: "Steffisburg",
    },
  ],
  invoices: [],
  quotes: [],
};

function input() {
  return screen.getByRole("combobox") as HTMLInputElement;
}

async function typeAndWaitForResults(term: string) {
  fireEvent.change(input(), { target: { value: term } });
  await screen.findByRole("option", { name: /Silvia Jäggi/ });
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    // jsdom has no layout: the dropdown scrolls the active option into view
    Element.prototype.scrollIntoView = vi.fn();
    push.mockReset();
    searchAction.mockReset();
    searchAction.mockResolvedValue(RESULTS);
  });
  afterEach(cleanup);

  it("clears the field and closes the dropdown after clicking a result", async () => {
    render(<GlobalSearch size="sm" />);
    await typeAndWaitForResults("sil");
    expect(input().value).toBe("sil");

    fireEvent.click(screen.getByRole("option", { name: /Silvia Jäggi/ }));

    expect(push).toHaveBeenCalledWith("/customers/7");
    expect(input().value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clears the field after choosing a result with the keyboard", async () => {
    render(<GlobalSearch size="sm" />);
    await typeAndWaitForResults("sil");

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/customers/7");
    expect(input().value).toBe("");
  });

  it("keeps the term on Enter without a selection and goes to the full search", async () => {
    render(<GlobalSearch size="sm" />);
    await typeAndWaitForResults("sil");

    fireEvent.submit(input().closest("form")!);

    expect(push).toHaveBeenCalledWith("/search?q=sil");
    expect(input().value).toBe("sil");
  });

  it("keeps the text when Escape closes the dropdown", async () => {
    render(<GlobalSearch size="sm" />);
    await typeAndWaitForResults("sil");

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input().value).toBe("sil");
  });
});
