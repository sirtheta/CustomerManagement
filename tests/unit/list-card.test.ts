import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Mobile list cards are stretched links: the CardLink's ::after covers the whole
// <li>. Every other interactive element in the card has to be lifted above that
// overlay (cardInteractiveClass, on the element itself or an ancestor inside the
// card), otherwise it silently stops working. Rendering would not catch that, so
// this scans the sources and walks their JSX tags.

const root = path.resolve(__dirname, "../..");
const helperPath = path.join(root, "components/ui/list-card.tsx");
const helperSource = fs.readFileSync(helperPath, "utf8");

const LIFT = "cardInteractiveClass";
// Capitalised components are treated as interactive unless listed here.
const INERT_COMPONENTS = new Set(["Badge", "CardLink", "ListCard", "ListRow", "ExpenseStatus"]);
const NATIVE_INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "form", "label", "summary"]);

function sourceFiles(dir: string): string[] {
  return (fs.readdirSync(path.join(root, dir), { recursive: true }) as string[])
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(root, dir, f))
    .filter((f) => f !== helperPath);
}

const files = [...sourceFiles("app"), ...sourceFiles("components")].filter((f) =>
  /<(ListCard|ListRow|CardLink)\b/.test(fs.readFileSync(f, "utf8")),
);

/** Opening tag from `start` to its closing `>`; braces nest so `render={<Link />}` stays inside. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(start, i + 1);
  }
  return src.slice(start);
}

function listCardBlocks(src: string): string[] {
  return [...src.matchAll(/<(ListCard|ListRow)\b[\s\S]*?<\/\1>/g)].map((m) => m[0]);
}

/** Interactive elements in a card block that are not lifted above the overlay. */
function unliftedInteractive(block: string): string[] {
  const problems: string[] = [];
  const open: { name: string; text: string }[] = [];
  const re = /<(\/?)([A-Za-z][\w.]*)/g;
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(block);
    if (!m) break;
    const [, closing, name] = m;
    if (closing) {
      i = block.indexOf(">", m.index) + 1;
      for (let k = open.length - 1; k >= 0; k--) {
        if (open[k].name === name) {
          open.length = k;
          break;
        }
      }
      continue;
    }
    const text = openingTag(block, m.index);
    i = m.index + text.length; // skips nested tags inside attributes (render={<Link />})
    const interactive = NATIVE_INTERACTIVE.has(name) || (/^[A-Z]/.test(name) && !INERT_COMPONENTS.has(name));
    const lifted = text.includes(LIFT) || open.some((o) => o.text.includes(LIFT));
    if (interactive && !lifted) problems.push(text.replace(/\s+/g, " ").slice(0, 100));
    if (!text.endsWith("/>")) open.push({ name, text });
  }
  return problems;
}

describe("unliftedInteractive (the scanner itself)", () => {
  it("accepts a lifted element and a lifted ancestor", () => {
    const own = `<ListCard><CardLink href="/x">A</CardLink><a href="/y" className={${LIFT}}>B</a></ListCard>`;
    const ancestor = `<ListCard><CardLink href="/x">A</CardLink><div className={${LIFT}}><Button>B</Button><Widget /></div></ListCard>`;
    expect(unliftedInteractive(own)).toEqual([]);
    expect(unliftedInteractive(ancestor)).toEqual([]);
  });

  it("flags an unlifted sibling even if a neighbour is lifted", () => {
    const html = `<ListCard><a href="/y" className={${LIFT}}>B</a><a href="/z">C</a></ListCard>`;
    expect(unliftedInteractive(html)).toHaveLength(1);
  });

  it("flags unknown components, native controls and render-prop links", () => {
    expect(unliftedInteractive(`<ListCard><Widget /></ListCard>`)).toHaveLength(1);
    expect(unliftedInteractive(`<ListCard><button type="button">x</button></ListCard>`)).toHaveLength(1);
    expect(unliftedInteractive(`<ListCard><Button render={<Link href="/a" />}>x</Button></ListCard>`)).toHaveLength(1);
  });

  it("ignores inert elements", () => {
    expect(unliftedInteractive(`<ListCard><Badge>x</Badge><span>y</span><p>z</p></ListCard>`)).toEqual([]);
  });
});

describe("ListCard stretched-link pattern", () => {
  it("finds the converted pages", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it("isolates cards and rows so lifted elements stay below the sticky header", () => {
    // inside class strings only (the doc comment mentions it too): ListCard + ListRow
    expect(helperSource.match(/"[^"\n]*\bisolate\b[^"\n]*"/g)?.length).toBe(2);
    expect(helperSource).toContain(`${LIFT} = "relative z-10"`);
  });

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const src = fs.readFileSync(file, "utf8");
    const blocks = listCardBlocks(src);

    it(`${rel}: every CardLink sits in a card and every card has exactly one`, () => {
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block.match(/<CardLink\b/g)?.length ?? 0).toBe(1);
      }
      // A CardLink outside a card would stretch over the nearest positioned ancestor.
      expect(src.match(/<CardLink\b/g)?.length ?? 0).toBe(blocks.length);
    });

    it(`${rel}: other interactive elements sit above the overlay`, () => {
      for (const block of blocks) {
        expect(unliftedInteractive(block)).toEqual([]);
      }
    });
  }
});
