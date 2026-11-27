/**
 * The events of a runner session (contracts/session.md): the kinds each
 * request may send before its result, and the text of each cleaned before
 * anyone sees it. Split from session.ts with no change of behaviour
 * (specs/016-build-from-source, contracts/cli.md CL14).
 */
import type { SessionCommand, SessionEvent } from "@workspace/core"

import { sanitize } from "./sanitize"

/** The kinds of event each request may send before its result. */
export const EVENTS: Partial<
  Record<SessionCommand, readonly SessionEvent["event"][]>
> = {
  apply: ["progress"],
  // A version-2 deploy sends Docker's lines as `apply` does (specs/014-deploy-v2, contracts/protocol.md P9); `records` sends none.
  // On protocol 4 it also says which service's health it waits for (specs/015-domains-https, contracts/core.md, "Event").
  // On protocol 6, a deploy that builds says each build's state, the builder's lines and the step that failed
  // (specs/016-build-from-source, contracts/core.md CO11; contracts/cli.md CL7 step 13).
  deploy: ["progress", "health", "build", "build_line", "build_error"],
  logs: ["log"],
  // Protocol 6 (specs/016-build-from-source, contracts/core.md CO12): each command it adds has its entry, and none sends an event.
  pack: [],
  builds: [],
  builder: [],
}

/**
 * Removes terminal control sequences from the text of an event. Service names
 * and times are held to patterns already. A build's text is the builder's and
 * never trusted: a step can print OSC 52 (the clipboard), OSC 8 (links) or
 * cursor sequences, so `line`, `step` and `error` pass through `sanitize`
 * too (specs/016-build-from-source, contracts/cli.md CL7 step 13, CL14).
 */
export function clean(event: SessionEvent): SessionEvent {
  switch (event.event) {
    case "progress":
      return { event: "progress", line: sanitize(event.line) }
    case "health":
      return { event: "health", service: sanitize(event.service) }
    case "log":
      return {
        event: "log",
        service: sanitize(event.service),
        time: event.time,
        line: sanitize(event.line),
      }
    // No free text: the key is 64 hex digits and the state one of four words, held to them by the schema (CO11).
    case "build":
      return { event: "build", key: event.key, state: event.state }
    case "build_line":
      return { event: "build_line", key: event.key, line: sanitize(event.line) }
    case "build_error":
      return {
        event: "build_error",
        key: event.key,
        step: sanitize(event.step),
        error: sanitize(event.error),
      }
  }
}
