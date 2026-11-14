/**
 * End-to-end tests of the full-screen app, driven by an agent in a real
 * pseudo-terminal (tests/support/engine.ts). `bun run test:e2e` runs them;
 * they are not part of `bun run test`. See README.md, "End-to-end tests".
 */
import { gateway } from "ai"
import type { E2EConfig } from "e2e"

import { zeknoTerminal } from "./tests/support/engine"
import { GREETING_VALUE } from "./tests/support/values"

/**
 * Claude Sonnet 5.5 through the Vercel AI Gateway, which reads
 * AI_GATEWAY_API_KEY. The id is the one the gateway provider lists for it:
 * `GatewayModelId` in @ai-sdk/gateway 4.0.146 (dist/index.d.ts), the
 * version `ai` 7.0.173 depends on.
 */
export const MODEL_ID = "anthropic/claude-sonnet-5.5"

/** What the app calls things, for every model call: act turns and judgments. */
const CONTEXT = [
  "This is zekno, a full-screen app in a terminal that deploys apps to servers. It is driven with the keyboard only.",
  "The last line of every screen lists the keys that work there and what each does, for example `d deploy`, `esc back`, `enter open`.",
  "A row marked with ❯ is the selected one; ↑ and ↓ move the marker, ← → and tab move between panes.",
  "A line starting with ? is a question being asked: type the answer, then press Enter.",
  "Letters typed while no question is open are commands (d deploy, l logs, s secrets, a add a server, r roll back, q quit).",
].join(" ")

/** How the acting agent works, read only by the act loop. */
const SYSTEM = [
  "Act only by pressing keys and typing text. Press one key at a time and read the screen after each.",
  "Use the keys the screen lists. Never press q unless the goal is to quit.",
  "When a step takes a moment (a spinner, a deploy starting), observe again before you act.",
].join(" ")

/** Typed whole, not inferred: the model's type comes from a package the config does not name. */
const config: E2EConfig = {
  projectId: "zekno-cli",
  targets: [{ name: "terminal", engine: zeknoTerminal() }],
  tests: "tests/**/*.e2e.ts",
  timeout: 180_000,
  retries: 0,
  workers: 3,
  agents: {
    default: {
      model: gateway(MODEL_ID),
      context: CONTEXT,
      system: SYSTEM,
      maxSteps: 20,
      maxModelCalls: 20,
    },
  },
  secrets: {
    // A made-up value for the hidden prompt: the model gets its name, never the value.
    greeting: GREETING_VALUE,
  },
  cache: "read-write",
}

export default config
