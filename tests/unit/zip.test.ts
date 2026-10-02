import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { zipStream } from "@/lib/zip";

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const text = (s: string) => new TextEncoder().encode(s);

describe("zipStream", () => {
  it("packs compressed and stored files into a readable archive", async () => {
    const bytes = await collect(
      zipStream(async (add) => {
        await add("a/journal.csv", text("Datum,Betrag\n01.01.2026,10.00"));
        await add("a/rechnungen/x.pdf", new Uint8Array([1, 2, 3, 4]), { store: true });
      })
    );
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["a/journal.csv", "a/rechnungen/x.pdf"]);
    expect(strFromU8(files["a/journal.csv"])).toBe("Datum,Betrag\n01.01.2026,10.00");
    expect(Array.from(files["a/rechnungen/x.pdf"])).toEqual([1, 2, 3, 4]);
  });

  it("keeps non-ASCII content intact", async () => {
    const bytes = await collect(
      zipStream(async (add) => {
        await add("a/kunden.csv", text("Müller, Zoë"));
      })
    );
    expect(strFromU8(unzipSync(bytes)["a/kunden.csv"])).toBe("Müller, Zoë");
  });

  it("errors the stream when the producer fails", async () => {
    const stream = zipStream(async (add) => {
      await add("a.txt", text("x"));
      throw new Error("boom");
    });
    await expect(collect(stream)).rejects.toThrow("boom");
  });

  it("streams many entries without loss", async () => {
    const payload = new Uint8Array(20_000).map((_, i) => (i * 31) % 251);
    const bytes = await collect(
      zipStream(async (add) => {
        for (let i = 0; i < 300; i++) await add(`f/${i}.bin`, payload, { store: true });
      })
    );
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toHaveLength(300);
    expect(files["f/299.bin"]).toEqual(payload);
  });

  it("does not let the last add succeed after the consumer cancelled while it waited", async () => {
    let outcome: "pending" | "returned" | "threw" = "pending";
    let aborted = () => false;
    // Without a reader the queue fills up after a few files, so the last add of a
    // run this long is the one waiting for backpressure when the consumer cancels.
    const stream = zipStream(async (add, isAborted) => {
      aborted = isAborted;
      try {
        for (let i = 0; i < 8; i++) await add(`f${i}.bin`, new Uint8Array(10), { store: true });
        outcome = "returned";
      } catch (err) {
        outcome = "threw";
        throw err;
      }
    });
    const reader = stream.getReader();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(aborted()).toBe(true);
    expect(outcome).toBe("threw");
  });
});
