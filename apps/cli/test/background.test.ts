import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"

import { answered, backgroundFrom, detectBackground, isLateAnswer, parseBackgroundAnswer, QUERY } from "../src/ui/background"
import { discardTypedAhead } from "../src/ui/type-ahead"

const BEL = "\x07"
const ST = "\x1b\\"
const DA1 = "\x1b[?62;22c"
const osc = (body: string, end = BEL) => `\x1b]11;${body}${end}`

describe("reading a terminal's answer", () => {
  test("rgb: with four hex digits per part, ended by BEL or by ST", () => {
    expect(parseBackgroundAnswer(osc("rgb:ffff/ffff/ffff"))).toEqual({ r: 1, g: 1, b: 1 })
    expect(parseBackgroundAnswer(osc("rgb:0000/0000/0000", ST))).toEqual({ r: 0, g: 0, b: 0 })
    const grey = parseBackgroundAnswer(osc("rgb:1e1e/1e1e/1e1e"))!
    expect(grey.r).toBeCloseTo(0x1e1e / 0xffff, 6)
  })

  test("two, three and one hex digits per part are scaled to the same range", () => {
    expect(parseBackgroundAnswer(osc("rgb:ff/80/00"))).toEqual({ r: 1, g: 0x80 / 0xff, b: 0 })
    expect(parseBackgroundAnswer(osc("rgb:fff/000/fff", ST))).toEqual({ r: 1, g: 0, b: 1 })
    expect(parseBackgroundAnswer(osc("rgb:f/0/f"))).toEqual({ r: 1, g: 0, b: 1 })
    expect(parseBackgroundAnswer(osc("rgb:FDF6/E3E3/0000"))!.r).toBeCloseTo(0xfdf6 / 0xffff, 6)
  })

  test("rgba: with four parts, the last ignored", () => {
    expect(parseBackgroundAnswer(osc("rgba:ffff/ffff/ffff/8000"))).toEqual({ r: 1, g: 1, b: 1 })
  })

  test("the answer is found among the DA1 answer and anything typed before it", () => {
    expect(parseBackgroundAnswer(`ab${osc("rgb:0b0b/0d0d/1010")}${DA1}`)!.b).toBeCloseTo(0x1010 / 0xffff, 6)
  })

  test("anything else is not an answer", () => {
    for (const garbage of [
      "",
      DA1,
      "\x1b]11;rgb:ffff/ffff/ffff",
      osc("rgb:ffff/ffff"),
      osc("rgb:ffff/ffff/ffff/ffff"),
      osc("rgba:ffff/ffff/ffff"),
      osc("rgb:fffff/ffff/ffff"),
      osc("rgb:gggg/0000/0000"),
      osc("rgb:/ffff/ffff"),
      osc("#ffffff"),
      osc("cmyk:0/0/0/0"),
      "\x1b]10;rgb:ffff/ffff/ffff\x07",
      "rgb:ffff/ffff/ffff",
      "\u0000ÿ\u001b]]11;;\u0007\u0007",
    ]) {
      expect(parseBackgroundAnswer(garbage)).toBeUndefined()
    }
  })
})

describe("dark or light", () => {
  test("light grounds are light, dark grounds are dark", () => {
    expect(backgroundFrom(osc("rgb:ffff/ffff/ffff"))).toBe("light")
    expect(backgroundFrom(osc("rgb:fdfd/f6f6/e3e3"))).toBe("light") // Solarized light
    expect(backgroundFrom(osc("rgb:bfbf/bfbf/bfbf"))).toBe("light")
    expect(backgroundFrom(osc("rgb:0b0b/0d0d/1010"))).toBe("dark") // the canvas
    expect(backgroundFrom(osc("rgb:0000/2b2b/3636"))).toBe("dark") // Solarized dark
    expect(backgroundFrom(osc("rgb:2e2e/3434/4040"))).toBe("dark") // Nord
    expect(backgroundFrom(osc("rgb:55/55/55"))).toBe("dark")
  })

  test("no answer, or one that makes no sense, is dark", () => {
    expect(backgroundFrom("")).toBe("dark")
    expect(backgroundFrom(DA1)).toBe("dark")
    expect(backgroundFrom(osc("rgb:zzzz/ffff/ffff"))).toBe("dark")
  })

  test("the DA1 answer marks the end of what the terminal sends", () => {
    expect(answered(`${osc("rgb:ffff/ffff/ffff")}${DA1}`)).toBe(true)
    expect(answered("\x1b[?1;2c")).toBe(true)
    expect(answered(osc("rgb:ffff/ffff/ffff"))).toBe(false)
    expect(answered("\x1b[?62;22")).toBe(false)
  })

  test("pieces of a late answer are recognised, typing is not", () => {
    for (const piece of ["11;rgb:ffff/ffff/ffff", "11;rgb:0b0b/0d0d/1010\x07", "rgb:ff/ff/ff", "[?62;22c", "[?1;2c"]) {
      expect(isLateAnswer(piece)).toBe(true)
    }
    for (const typing of ["q", "rgb", "deploy@203.0.113.7", "11", "[", "c", "ada"]) expect(isLateAnswer(typing)).toBe(false)
  })
})

/** A stand-in terminal: input that can answer when the question is written, and records what was done to it. */
function terminal(options: { tty?: boolean; outTty?: boolean; raw?: boolean; answer?: string[]; every?: number; rawThrows?: boolean } = {}) {
  const input = new EventEmitter() as EventEmitter & {
    isTTY: boolean
    isRaw: boolean
    setRawMode: (mode: boolean) => void
    read: () => Buffer | null
    resume: () => void
    pause: () => void
  }
  const modes: boolean[] = []
  const calls: string[] = []
  input.isTTY = options.tty ?? true
  input.isRaw = options.raw ?? false
  input.setRawMode = (mode) => {
    if (options.rawThrows) throw new Error("not a terminal")
    modes.push(mode)
    input.isRaw = mode
  }
  input.resume = () => void calls.push("resume")
  input.pause = () => void calls.push("pause")
  // What has arrived and not been read yet. Input is read as Ink reads it: `readable`, then `read()` until null.
  const arrived: Buffer[] = []
  input.read = () => arrived.shift() ?? null
  const arrive = (piece: string) => {
    arrived.push(Buffer.from(piece, "latin1"))
    input.emit("readable")
  }
  const written: string[] = []
  const output = {
    isTTY: options.outTty ?? true,
    write(text: string) {
      written.push(text)
      // The terminal answers a moment later, in pieces.
      const every = options.every ?? 5
      ;(options.answer ?? []).forEach((piece, index) => setTimeout(() => arrive(piece), 5 + index * every))
      return true
    },
  }
  return {
    input: input as never,
    output: output as never,
    modes,
    calls,
    written,
    listeners: () => input.listenerCount("readable") + input.listenerCount("data"),
    /** Keys typed: they arrive as a terminal hands them over. */
    type: arrive,
    /** What has arrived and not been read. */
    unread: () => arrived.map((piece) => piece.toString("latin1")),
  }
}

const quick = { quietMs: 30, answeringMs: 150 }

describe("asking the terminal", () => {
  test("not a terminal: nothing is asked, nothing is changed, and it is dark", async () => {
    for (const options of [{ tty: false }, { outTty: false }]) {
      const t = terminal({ ...options, answer: [osc("rgb:ffff/ffff/ffff"), DA1] })
      expect(await detectBackground(t.input, t.output, quick)).toBe("dark")
      expect(t.written).toEqual([])
      expect(t.modes).toEqual([])
      expect(t.calls).toEqual([])
    }
  })

  test("a light terminal that answers: light, raw mode put back, nothing left listening", async () => {
    const t = terminal({ answer: [osc("rgb:ffff/ffff/ffff", ST), DA1] })
    expect(await detectBackground(t.input, t.output, quick)).toBe("light")
    expect(t.written).toEqual([QUERY])
    expect(t.modes).toEqual([true, false])
    expect(t.listeners()).toBe(0)
  })

  test("input is never made to flow and never paused, so the app that opens next still hears keys", async () => {
    // In Bun, a terminal's input that has flowed and been paused takes no key afterwards.
    for (const answer of [[osc("rgb:ffff/ffff/ffff", ST), DA1], [], ["x".repeat(2000)]]) {
      const t = terminal({ answer })
      await detectBackground(t.input, t.output, quick)
      expect(t.calls).toEqual([])
    }
  })

  test("an answer that arrives in pieces is read whole", async () => {
    const answer = `${osc("rgb:ffff/ffff/ffff")}${DA1}`
    const t = terminal({ answer: [answer.slice(0, 3), answer.slice(3, 11), answer.slice(11, 30), answer.slice(30)] })
    expect(await detectBackground(t.input, t.output, quick)).toBe("light")
  })

  test("a terminal already in raw mode is left in raw mode", async () => {
    const t = terminal({ raw: true, answer: [osc("rgb:0000/0000/0000"), DA1] })
    expect(await detectBackground(t.input, t.output, quick)).toBe("dark")
    expect(t.modes).toEqual([true, true])
  })

  test("a terminal that says nothing: dark, after the short wait", async () => {
    const t = terminal()
    const started = Date.now()
    expect(await detectBackground(t.input, t.output, quick)).toBe("dark")
    expect(Date.now() - started).toBeLessThan(quick.answeringMs)
    expect(t.modes).toEqual([true, false])
    expect(t.listeners()).toBe(0)
  })

  test("a terminal that answers only DA1 is dark at once", async () => {
    const t = terminal({ answer: [DA1] })
    const started = Date.now()
    expect(await detectBackground(t.input, t.output, { quietMs: 1000, answeringMs: 2000 })).toBe("dark")
    expect(Date.now() - started).toBeLessThan(500)
  })

  test("a terminal that has begun to answer is waited for past the short wait, up to the longer limit", async () => {
    // The first piece comes before the short wait is over, the rest after it, and DA1 never.
    const answer = osc("rgb:ffff/ffff/ffff")
    const t = terminal({ answer: [answer.slice(0, 4), answer.slice(4)], every: 80 })
    const started = Date.now()
    expect(await detectBackground(t.input, t.output, { quietMs: 40, answeringMs: 300 })).toBe("light")
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
  })

  test("a terminal that sends far more than an answer is not read on and on", async () => {
    const t = terminal({ answer: ["x".repeat(2000)] })
    const started = Date.now()
    expect(await detectBackground(t.input, t.output, { quietMs: 1000, answeringMs: 2000 })).toBe("dark")
    expect(Date.now() - started).toBeLessThan(500)
    expect(t.listeners()).toBe(0)
  })

  test("a terminal that cannot be put in raw mode is dark", async () => {
    const t = terminal({ rawThrows: true, answer: [osc("rgb:ffff/ffff/ffff"), DA1] })
    expect(await detectBackground(t.input, t.output, quick)).toBe("dark")
    expect(t.listeners()).toBe(0)
  })
})

describe("keys typed before a question is on the screen (the signed link's review, K12)", () => {
  test("a question throws away what was typed before it, and what arrives while it is being drawn; raw mode is put back", async () => {
    const t = terminal()
    // Typed while the keychain was asking: it has arrived, and nothing has read it.
    t.type("y")
    setTimeout(() => t.type("y"), 10)
    await discardTypedAhead(t.input, 30)
    expect(t.unread()).toEqual([])
    expect(t.modes).toEqual([true, false])
    expect(t.listeners()).toBe(0)
    // Never made to flow, never paused: the question drawn next still hears keys.
    expect(t.calls).toEqual([])
    // What comes after is left for the question.
    t.type("n")
    expect(t.unread()).toEqual(["n"])
  })

  test("raw mode already on stays on; input that is not a terminal is not touched; one that went away is no error", async () => {
    const raw = terminal({ raw: true })
    raw.type("y")
    await discardTypedAhead(raw.input, 10)
    expect(raw.modes).toEqual([true, true])
    expect(raw.unread()).toEqual([])
    const piped = terminal({ tty: false })
    piped.type("y")
    await discardTypedAhead(piped.input, 10)
    expect(piped.modes).toEqual([])
    expect(piped.unread()).toEqual(["y"])
    const gone = terminal({ rawThrows: true })
    await discardTypedAhead(gone.input, 10)
    expect(gone.listeners()).toBe(0)
  })

  test("the app asks the terminal for its background after the keychain: a key typed before is read with the answer and thrown away", async () => {
    const t = terminal({ answer: [osc("rgb:ffff/ffff/ffff"), DA1] })
    t.type("y")
    expect(await detectBackground(t.input, t.output, quick)).toBe("light")
    expect(t.unread()).toEqual([])
  })
})
