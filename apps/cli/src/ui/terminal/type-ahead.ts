/**
 * Keys typed before a question is on the screen are not an answer to it. A
 * `y` typed while the keychain was asking for permission, or while zekno was
 * starting, must never answer "Use it here?" (the security review of the
 * signed link, K12): the person had not read the question yet.
 *
 * At a terminal in line mode a key waits in the terminal until Enter, and is
 * handed over as soon as raw mode is turned on, which is what a question
 * does first. So what has arrived is taken and thrown away in raw mode, for
 * a moment, before the question is drawn.
 *
 * Input is read the way Ink reads it, and as detectBackground reads it
 * (background.ts): a `readable` listener that takes what has arrived. It is
 * never switched to a flowing `data` stream and never paused: in Bun, a
 * terminal's input that has flowed and been paused takes no key afterwards.
 */

/** How long what arrives is thrown away. Far longer than a terminal takes to hand over what it holds. */
export const TYPED_AHEAD_MS = 50

type Input = Pick<
  NodeJS.ReadStream,
  "isTTY" | "on" | "removeListener" | "read"
> & {
  isRaw?: boolean
  setRawMode?: (mode: boolean) => unknown
  ref?: () => unknown
  unref?: () => unknown
}

/**
 * Throws away whatever was typed and not read yet, and what arrives in the
 * next `ms`. Raw mode is put back as it was, and nothing is left listening.
 * Does nothing where the input is not a terminal.
 */
export async function discardTypedAhead(
  input: Input = process.stdin,
  ms = TYPED_AHEAD_MS
): Promise<void> {
  if (!input.isTTY || typeof input.setRawMode !== "function") return
  const wasRaw = input.isRaw === true
  const drop = () => {
    try {
      while (input.read() !== null) {
        // Typed before the question was drawn: never looked at.
      }
    } catch {
      // The terminal went away. There is nothing left to throw away.
    }
  }
  try {
    input.setRawMode(true)
    input.ref?.()
    input.on("readable", drop)
    drop()
    await new Promise((resolve) => setTimeout(resolve, ms))
    drop()
  } catch {
    // The terminal went away: nothing can have been typed on it.
  } finally {
    input.removeListener("readable", drop)
    try {
      input.setRawMode(wasRaw)
    } catch {
      // The terminal went away. There is nothing left to put back.
    }
    // Nothing here keeps the program running. The question takes the input again when it is drawn.
    input.unref?.()
  }
}
