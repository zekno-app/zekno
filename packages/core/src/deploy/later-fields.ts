/**
 * The pre-deploy command of the signed deploy's version 2, the field a runner
 * carries out in a later step. Its whole format is fixed now, as the design's
 * part 5 gives it (specs/010-app-settings/deploy-v2.md) and
 * contracts/message.md states it (F31 to F34), so a later feature adds
 * behaviour and never changes the format. Every rule here is checked in
 * full; `carried-out.ts` then refuses a deploy that uses it
 * (`unsupported_version`, CO7). Builds were a later field too: their rules
 * are in `builds.ts`. The health check and routes were later fields until
 * feature 015 carried them out: their rules are in `routes-and-checks.ts`.
 */
import { z } from "zod"

import { isWellFormed, utf8 } from "../crypto/encoding"
import { LIMITS } from "../protocol/limits"
import { SERVICE_NAME } from "../protocol/service-name"
import type { Health, Route } from "./routes-and-checks"

const seconds = (max: number) => z.number().int().min(1).max(max)
const service = z.string().regex(SERVICE_NAME)

const bytesOf = (text: string) => utf8(text).length

/** Text handed to a program as it is: no lone surrogate, no NUL. */
const plainText = (text: string) =>
  isWellFormed(text) && !text.includes("\u0000")

/** True when each name comes after the one before it, so the list is sorted and has no repeat. */
const sortedAndUnique = (names: readonly string[]) =>
  names.every((name, index) => index === 0 || names[index - 1]! < name)

/** A command run once, before the new version starts, in a container of the new version (part 4.4). */
export const PredeploySchema = z.strictObject({
  service,
  /** Separate words, never handed to a shell. */
  command: z
    .array(z.string().max(LIMITS.predeployWordLength).refine(plainText))
    .min(1)
    .max(LIMITS.predeployWords),
  timeout: seconds(LIMITS.predeploySeconds),
})
export type Predeploy = z.infer<typeof PredeploySchema>

/**
 * The rules across fields (F6) of the pre-deploy command, the health check
 * and routes: the byte total of the pre-deploy command, and sorted, unique
 * lists of health-checked services and of routed domains. Those of builds
 * are `buildsAreConsistent` in `builds.ts`.
 */
export function laterFieldsAreConsistent(deploy: {
  readonly predeploy: Predeploy | null
  readonly health: Health | null
  readonly routes: readonly Route[]
}): boolean {
  if (
    deploy.predeploy &&
    deploy.predeploy.command.reduce((total, word) => total + bytesOf(word), 0) >
      LIMITS.predeployBytes
  )
    return false
  if (
    deploy.health &&
    !sortedAndUnique(deploy.health.services.map((entry) => entry.service))
  )
    return false
  return sortedAndUnique(deploy.routes.map((route) => route.domain))
}
