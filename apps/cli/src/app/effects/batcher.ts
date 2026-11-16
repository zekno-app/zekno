/** Lines handed to the reducer in small batches: Docker's lines during a deploy, and an app's logs. */

/** How long log lines are gathered before they are drawn together, so a burst is drawn once and not line by line. */
export const LOG_BATCH_MS = 50

/**
 * Gathers items and hands them on together, `LOG_BATCH_MS` after the first,
 * so a burst is drawn once. Once `limit` are waiting, `add` returns a promise
 * that settles when they are handed on: the session waits for it before it
 * reads the next line, so a runner that sends faster than the screen draws
 * is slowed down in the connection, not held in this process.
 */
export function batcher<T>(limit: number, handOn: (items: T[]) => void) {
  let items: T[] = []
  let waiting: (() => void)[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    const taken = items
    const released = waiting
    items = []
    waiting = []
    if (taken.length > 0) handOn(taken)
    for (const resolve of released) resolve()
  }
  return {
    add(item: T): Promise<void> | undefined {
      items.push(item)
      timer ??= setTimeout(flush, LOG_BATCH_MS)
      return items.length < limit
        ? undefined
        : new Promise((resolve) => waiting.push(resolve))
    },
    flush,
  }
}
