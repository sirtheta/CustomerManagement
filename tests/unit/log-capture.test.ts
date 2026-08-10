import { describe, expect, it } from "vitest";
import { tee } from "@/lib/log-capture";

describe("tee", () => {
  it("forwards every write to both the original stream and the sink, and returns the original's result", () => {
    const originalCalls: unknown[] = [];
    const sinkCalls: unknown[] = [];
    const stream = {
      write: (chunk: unknown) => {
        originalCalls.push(chunk);
        return true;
      },
    };
    const sink = { write: (chunk: unknown) => sinkCalls.push(chunk) };

    tee(stream, sink);
    const result = stream.write("hello\n");

    expect(result).toBe(true);
    expect(originalCalls).toEqual(["hello\n"]);
    expect(sinkCalls).toEqual(["hello\n"]);
  });

  it("passes extra arguments (encoding, callback) through to the original write only", () => {
    const originalCalls: unknown[][] = [];
    const stream = {
      write: (...args: unknown[]) => {
        originalCalls.push(args);
        return true;
      },
    };
    const sink = { write: () => undefined };

    tee(stream, sink);
    const callback = () => {};
    stream.write("chunk", "utf8", callback);

    expect(originalCalls).toEqual([["chunk", "utf8", callback]]);
  });
});

describe("startLogCapture ordering (regression)", () => {
  it("pino detects an already-tampered stdout/stderr and routes writes through it instead of a raw fd", async () => {
    // This is the actual bug that shipped: pino's default destination writes
    // straight to file descriptor 1/2 via a SonicBoom *unless* process.stdout
    // /stderr have already been reassigned by the time pino() is called
    // (pino's own `hasBeenTampered` check). startLogCapture's docs promise
    // this ordering — verify pino really does honour a pre-existing tamper,
    // independent of the (untestable here) instrumentation.ts call order.
    const originalWrite = process.stdout.write;
    const captured: string[] = [];
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (originalWrite as (...a: unknown[]) => boolean).apply(process.stdout, [chunk, ...rest]);
    }) as typeof process.stdout.write;

    try {
      const pino = (await import("pino")).default;
      const logger = pino();
      logger.info("regression check");
      // pino's SonicBoom flush is async; give the event loop a tick.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(captured.some((line) => line.includes("regression check"))).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
