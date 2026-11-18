import { wipe } from "../crypto/encoding"
import {
  decodeKey,
  serverIdOf,
  serverPublicKeyOf,
  tryDecodeKey,
  type ServerSecretKey,
} from "../crypto/keys"
import { ok, refuse, type OpenRefusal, type Result } from "../protocol/result"
import { openSealedSecret, type SealedSecret } from "../secrets/secrets"
import type { VerifiedDeploy } from "./deploy"
import type { VerifiedDeployV2 } from "./deploy-v2"

/**
 * Deploys that came out of a verifier, with the sealed secrets that were
 * checked. Private to this file: only a verifier registers a deploy, so no
 * caller can make an object whose secrets open.
 */
const verified = new WeakMap<object, readonly SealedSecret[]>()

/** Called by a verifier, and only once every check has passed. */
export function registerVerified(
  deploy: object,
  sealed: readonly SealedSecret[]
): void {
  verified.set(deploy, sealed)
}

/**
 * Decrypts the secrets of a verified deploy. Accepts only an object returned
 * by `verifyDeploy` or `verifyDeployV2`, so there is no path to plaintext that
 * skips the checks. Either every secret opens or none is returned.
 */
export function openSecrets(
  deploy: VerifiedDeploy | VerifiedDeployV2,
  serverSecretKey: ServerSecretKey
): Result<Record<string, string>, OpenRefusal> {
  const sealed = verified.get(deploy)
  if (!sealed) {
    return refuse(
      "not_verified",
      "Secrets can only be opened for a deploy returned by verifyDeploy."
    )
  }
  const secretKey = tryDecodeKey("serverSecret", serverSecretKey)
  if (!secretKey)
    return refuse("wrong_server_key", "Expected this server's secret key.")
  try {
    const publicKey = serverPublicKeyOf(secretKey)
    if (serverIdOf(publicKey) !== deploy.deploy.serverId) {
      return refuse(
        "wrong_server_key",
        "This key does not belong to the server the deploy is addressed to."
      )
    }
    const publicKeyBytes = decodeKey("serverPublic", publicKey)
    // No prototype, so a secret named "__proto__" or "constructor" is just a key.
    const values: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >
    for (const secret of sealed) {
      const opened = openSealedSecret(
        secret,
        { serverId: deploy.deploy.serverId, app: deploy.deploy.app },
        publicKeyBytes,
        secretKey
      )
      if (!opened.ok) return opened
      values[secret.name] = opened.value
    }
    return ok(values)
  } finally {
    wipe(secretKey)
  }
}
