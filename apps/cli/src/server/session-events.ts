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
  deploy: ["progress", "health"],
  logs: ["log"],
}

/** Removes terminal control sequences from the text of an event. Service names and times are held to patterns already. */
export function clean(event: SessionEvent): SessionEvent {
  if (event.event === "progress")
    return { event: "progress", line: sanitize(event.line) }
  if (event.event === "health")
    return { event: "health", service: sanitize(event.service) }
  return {
    event: "log",
    service: sanitize(event.service),
    time: event.time,
    line: sanitize(event.line),
  }
}
