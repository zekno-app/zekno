import { z } from "zod"

import release from "./runner-release.json"

/**
 * The runner this CLI installs: its version, and the SHA-256 of each file as
 * published. These values are how a server knows the runner it downloaded is
 * the right one, so they come from here and never from the download. They are
 * recorded in the repository after a release is published; `null` means no
 * release has been published for this version yet.
 */
const ReleaseSchema = z.strictObject({
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  files: z.strictObject({
    "linux-x64": z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable() }),
    "linux-arm64": z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable() }),
  }),
})

export type RunnerArch = "x64" | "arm64"

export const RUNNER_RELEASE = ReleaseSchema.parse(release)

export function expectedSha256(arch: RunnerArch): string | null {
  return RUNNER_RELEASE.files[`linux-${arch}`].sha256
}

/** Where a release file is published. Nothing in the address varies but the version and the architecture. */
export function releaseUrl(version: string, arch: RunnerArch): string {
  return `https://github.com/zekno-app/zekno-monorepo/releases/download/runner-v${version}/zekno-runner-linux-${arch}.gz`
}
