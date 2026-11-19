/**
 * Work on several items at once, a few at a time: `zekno doctor`'s servers
 * (specs/006-cli-small-features, contracts/doctor.md, four at a time) and the
 * lookups of `zekno domain` and of a deploy's domains (specs/015-domains-https,
 * contracts/cli.md, CL4, eight at a time). Moved out of ops/doctor.ts as it
 * was.
 */

/** Runs `work` on each item, at most `limit` at a time, and gives the results in the items' order. */
export async function atMost<T, R>(
  limit: number,
  items: readonly T[],
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane)
  )
  return results
}
