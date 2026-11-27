/**
 * Samples of the builder's output for the tests of `progress.ts`
 * (specs/016-build-from-source, T075): buildx's `--progress=rawjson` lines
 * shaped as map-runner E06 recorded them, a stream cut in chunks as a pipe
 * gives it, and a reader that collects what `readProgress` hands on.
 */
import { readProgress, type BuilderSeen } from "../../src/builder/progress"

export const encoder = new TextEncoder()
export const b64 = (text: string) =>
  Buffer.from(text, "utf8").toString("base64")
const json = (value: unknown) => JSON.stringify(value)

/** A stream that gives each part as one chunk, as a pipe may cut them. */
export function streamOf(
  ...parts: (string | Uint8Array)[]
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts)
        controller.enqueue(
          typeof part === "string" ? encoder.encode(part) : part
        )
      controller.close()
    },
  })
}

/** Reads `parts` as standard error and gives every line handed on, and what was kept. */
export async function read(
  ...parts: (string | Uint8Array)[]
): Promise<{ lines: string[]; seen: BuilderSeen }> {
  const lines: string[] = []
  const seen = await readProgress(streamOf(...parts), (line) => {
    lines.push(line)
  })
  return { lines, seen }
}

/** One rawjson line per status, as buildx prints them. */
export const rawjson = (...statuses: unknown[]) =>
  statuses.map((status) => `${json(status)}\n`).join("")

/** A time `ms` milliseconds after the build began, as BuildKit writes it (nine digits). */
export const at = (ms: number) =>
  new Date(Date.UTC(2026, 10, 27, 10, 0, 0) + ms)
    .toISOString()
    .replace("Z", "000000Z")

export const DIGEST64 =
  "73aaf090f3d85aa34ee199857f03fa3a95c4b3c2a1b0a9f8e7d6c5b4a3928170"
