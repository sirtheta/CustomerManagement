import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Mobile list cards are stretched links: the CardLink's ::after covers the whole
// <li>. Every other link/button in the card has to be lifted above that overlay
// (cardInteractiveClass), otherwise it silently stops working. Rendering would
// not catch that, so this scans the page sources.

const root = path.resolve(__dirname, "../..");
const helperSource = fs.readFileSync(path.join(root, "components/ui/list-card.tsx"), "utf8");

const files = (fs.readdirSync(path.join(root, "app"), { recursive: true }) as string[])
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => path.join(root, "app", f))
  .filter((f) => /<(ListCard|ListRow)\b/.test(fs.readFileSync(f, "utf8")));

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

describe("ListCard stretched-link pattern", () => {
  it("finds the converted pages", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("isolates the card so lifted elements stay below the sticky header", () => {
    expect(helperSource.match(/"relative isolate /g)?.length).toBe(2); // ListCard + ListRow
    expect(helperSource).toContain('cardInteractiveClass = "relative z-10"');
  });

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const blocks = listCardBlocks(fs.readFileSync(file, "utf8"));

    it(`${rel}: every card has exactly one CardLink`, () => {
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block.match(/<CardLink\b/g)?.length ?? 0).toBe(1);
      }
    });

    it(`${rel}: other links and buttons sit above the overlay`, () => {
      for (const block of blocks) {
        let skipUntil = 0;
        for (const m of block.matchAll(/<(Link|Button|a|SubscriptionRowActions|DeleteExpenseButton)\b/g)) {
          const at = m.index ?? 0;
          if (at < skipUntil) continue; // nested inside a tag already checked (render={<Link />})
          const tag = openingTag(block, at);
          skipUntil = at + tag.length;
          const context = block.slice(Math.max(0, at - 300), at) + tag;
          expect(context, `${rel}: ${tag.slice(0, 80)}`).toContain("cardInteractiveClass");
        }
      }
    });
  }
});
