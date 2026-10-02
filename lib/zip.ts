import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

export type ZipAdd = (name: string, data: Uint8Array, options?: { store?: boolean }) => Promise<void>;

/** True once the consumer cancelled the stream (e.g. the client closed the download). */
export type ZipAborted = () => boolean;

/**
 * Streams a ZIP archive. `produce` adds files one by one via `add`; `add`
 * waits while the consumer is slower than the producer, so a large archive
 * never piles up in memory. If `produce` throws, the stream errors and the
 * download ends without a valid central directory (an incomplete ZIP cannot
 * pass as complete). `add` throws once the consumer cancelled, and `aborted`
 * lets `produce` check before side effects that must only follow a complete
 * archive.
 */
export function zipStream(produce: (add: ZipAdd, aborted: ZipAborted) => Promise<void>): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        const zip = new Zip((err, chunk, final) => {
          if (err) {
            controller.error(err);
            return;
          }
          controller.enqueue(chunk);
          if (final) controller.close();
        });

        const add: ZipAdd = async (name, data, options) => {
          if (cancelled) throw new Error("Download abgebrochen");
          const file = options?.store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
          zip.add(file);
          file.push(data, true);
          while (!cancelled && (controller.desiredSize ?? 1) <= 0) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          if (cancelled) throw new Error("Download abgebrochen");
        };

        try {
          await produce(add, () => cancelled);
          zip.end();
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    new CountQueuingStrategy({ highWaterMark: 16 })
  );
}
