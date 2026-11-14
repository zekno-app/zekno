/**
 * The e2e engine for the full-screen app: `zekno` in a real pseudo-terminal
 * (terminal.ts), its screen read as a small tree (screen-tree.ts), driven
 * by the keyboard alone. The agent and a test can press keys and type text,
 * and fill a text box (the hidden prompt included, for a secret the model
 * never sees); nothing else. There is no pointer, no navigation, no shell.
 *
 * The app is not started by the engine: a test opens it with the `terminal`
 * fixture this engine contributes, once its world (world.ts) is ready, since
 * the app reads its profile only when it starts.
 */
import {
  ConfigurationError,
  defineEngine,
  EngineError,
  parseKey,
  resolveExpression,
  type EngineHandle,
  type SemanticNode,
} from "e2e/engine"

import { screenTree, type ScreenTree } from "./screen-tree"
import { startTerminal, type Launch, type TerminalProcess } from "./terminal"

/** The bytes a terminal sends for each named key of the contract's grammar. */
const NAMED: Record<string, string> = {
  Enter: "\r",
  Escape: "\x1b",
  Tab: "\t",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  Insert: "\x1b[2~",
  Space: " ",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
}

/** What a terminal sends for `key` (`Enter`, `Escape`, `d`, `Control+c`, `Shift+Tab`), or a refusal for one it has no bytes for. */
export function keyBytes(key: string): string {
  const parsed = parseKey(key)
  if (!parsed) throw new EngineError("UNSUPPORTED_CAPABILITY", `"${key}" is not a key a terminal can send`, { retryable: false })
  const modifiers = new Set<string>(parsed.modifiers.map((modifier) => (modifier === "ControlOrMeta" ? "Control" : modifier)))
  if (modifiers.has("Meta")) throw new EngineError("UNSUPPORTED_CAPABILITY", "a terminal has no Meta key", { retryable: false })
  if (parsed.key.kind === "named") {
    const name = parsed.key.name
    if (name === "Tab" && modifiers.has("Shift")) return "\x1b[Z"
    const bytes = NAMED[name]
    if (bytes === undefined || modifiers.has("Control") || (modifiers.has("Shift") && name !== "Space")) {
      throw new EngineError("UNSUPPORTED_CAPABILITY", `the terminal engine cannot send ${key}`, { retryable: false })
    }
    return modifiers.has("Alt") ? `\x1b${bytes}` : bytes
  }
  let char = parsed.key.char
  if (modifiers.has("Shift")) char = char.toUpperCase()
  if (modifiers.has("Control")) {
    const code = char.toLowerCase().charCodeAt(0)
    if (code < 97 || code > 122) throw new EngineError("UNSUPPORTED_CAPABILITY", `the terminal engine cannot send ${key}`, { retryable: false })
    char = String.fromCharCode(code - 96)
  }
  return modifiers.has("Alt") ? `\x1b${char}` : char
}

/** Finds a node by id in a tree. */
function findNode(node: SemanticNode, id: string): SemanticNode | undefined {
  if (node.ref.id === id) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

/** How long one character of typing takes, so the app reads keys, not a paste. */
const KEY_GAP_MS = 8

/** What a test does with the app through the `terminal` fixture. */
export type Terminal = {
  /** Starts the app in a new pseudo-terminal and waits for its first frame. A running one is stopped first. */
  open(launch: Launch): Promise<void>
  /** Presses one key, in the grammar of `locator.press` (`Enter`, `Escape`, `d`, `ArrowDown`, `Control+c`). */
  press(key: string): Promise<void>
  /** Types text one key at a time. */
  type(text: string): Promise<void>
  /** Waits for the app to exit and returns its exit status. */
  exited(): Promise<number>
  /** Stops the app if it is running. */
  close(): Promise<void>
  /** The screen as it is now, one string per row. */
  lines(): string[]
  /** Everything the app wrote to the terminal so far, escape sequences included. */
  output(): string
}

/** The engine, for `targets` in e2e.config.ts. */
export function zeknoTerminal(): EngineHandle {
  let current: TerminalProcess | undefined

  const open = (): TerminalProcess => {
    if (!current) throw new EngineError("INVALID_STATE", "the app is not open: a test opens it with terminal.open()", { retryable: false })
    return current
  }

  /** The screen as a tree, once it holds still (or between two frames of a spinner). */
  async function read(maxMs: number): Promise<ScreenTree> {
    const terminal = open()
    await terminal.settle({ quietMs: 50, maxMs })
    return screenTree(Array.from({ length: terminal.screen.rows }, (_, row) => terminal.screen.row(row)))
  }

  /** Sends bytes as keys, then lets the app answer them. */
  async function send(bytes: string): Promise<void> {
    const terminal = open()
    if (!terminal.running()) throw new EngineError("INVALID_STATE", "the app has exited", { retryable: false })
    terminal.write(bytes)
    await terminal.settle({ quietMs: 80, minMs: 80, maxMs: 2000 })
  }

  /** Types text one key at a time, as a person does, so the app reads keys rather than a paste. */
  async function typeText(text: string): Promise<void> {
    const terminal = open()
    if (!terminal.running()) throw new EngineError("INVALID_STATE", "the app has exited", { retryable: false })
    for (const char of text) {
      terminal.write(char)
      await Bun.sleep(KEY_GAP_MS)
    }
    await terminal.settle({ quietMs: 80, minMs: 80, maxMs: 2000 })
  }

  /** Stops the app and lets the terminal go, whatever state the test left it in. */
  async function close(): Promise<void> {
    const terminal = current
    current = undefined
    if (terminal) await terminal.stop()
  }

  const surface = (): Terminal => ({
    async open(launch) {
      await close()
      const terminal = startTerminal(launch)
      current = terminal
      try {
        await terminal.until(() => terminal.screen.frames > 0 && terminal.screen.alternate, "the app's first frame", 20_000)
      } catch (error) {
        // What the app wrote instead, for the report: often the reason it stopped.
        const said = terminal.screen.lines().filter(Boolean).join("\n").slice(-2000)
        throw new Error(`${(error as Error).message}. The terminal showed:\n${said}`)
      }
      await terminal.settle({ quietMs: 100, minMs: 150, maxMs: 3000 })
    },
    press: async (key) => send(keyBytes(key)),
    type: typeText,
    exited: async () => open().exited,
    close,
    lines: () => open().screen.lines(),
    output: () => open().raw(),
  })

  return defineEngine({
    name: "zekno-terminal",
    version: "0.1.0",
    spiVersion: 1,
    platform: "terminal",
    validateApp(app, { targetName }) {
      if (app.url !== undefined || app.bundleId !== undefined || app.appPath !== undefined) {
        throw new ConfigurationError("INVALID_CONFIG", `target "${targetName}": the terminal engine opens the app with terminal.open(), so it takes no app`)
      }
    },
    async observe() {
      const terminal = open()
      const tree = await read(600)
      return {
        location: tree.location,
        root: tree.root,
        viewport: { width: terminal.screen.cols, height: terminal.screen.rows },
        keyboardVisible: false,
      }
    },
    async locate(expression) {
      const tree = await read(300)
      return resolveExpression(expression, tree.root.children ?? [])
    },
    actions: ["press", "fill"],
    async perform(ref, action) {
      const tree = await read(300)
      const node = findNode(tree.root, ref.id)
      if (!node) throw new EngineError("NODE_STALE", `${ref.id} is no longer on the screen`, { retryable: true })
      if (action.kind === "press") return send(keyBytes(action.key))
      if (action.kind === "fill") {
        if (node.role !== "textbox") throw new EngineError("NOT_ACTIONABLE", "only a question's text box takes typing", { retryable: false })
        // A fill replaces what the box shows: what was typed is taken back first. A hidden value shows nothing to take back.
        const shown = [...(node.value ?? "")].length
        if (shown > 0) await typeText(NAMED.Backspace!.repeat(shown))
        return typeText(action.value)
      }
      throw new EngineError("UNSUPPORTED_CAPABILITY", `the terminal engine cannot ${action.kind}`, { retryable: false })
    },
    keyboard: {
      async type(text) {
        await typeText(text)
      },
      async press(key) {
        await send(keyBytes(key))
      },
    },
    fixtures: {
      terminal: (context) =>
        context.fixture("terminal", surface(), {
          open: { kind: "resource", label: (launch) => `${launch.cols}x${launch.rows}`, timeout: 30_000 },
          press: { kind: "resource", label: (key) => key },
          type: { kind: "resource", label: (text) => `${[...text].length} characters` },
          exited: { kind: "resource", timeout: 30_000 },
          close: { kind: "resource", timeout: 15_000 },
        }),
    },
    async startAttempt(context) {
      context.environment({ surface: "pseudo-terminal", runtime: `bun ${Bun.version}` })
    },
    async endAttempt() {
      await close()
    },
    async dispose() {
      await close()
    },
  })
}
