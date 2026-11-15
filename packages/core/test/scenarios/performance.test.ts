import { expect, test } from "bun:test"

import { openSecrets, verifyDeploy } from "../src/index"
import { publish, setup } from "./helpers"

test("SC-004: a runner verifies and opens a deploy with 50 secrets in under 100 ms", async () => {
  const { founder, relay, server, trust } = await setup()
  const values = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`SECRET_${index}`, `demo-value-${index}-${"x".repeat(200)}`]))
  const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, values })

  // Warm up once, then take the best of five to keep the test steady on a busy machine.
  const run = () => {
    const started = performance.now()
    const verified = verifyDeploy({ ...deploy, state: server.state })
    if (!verified.ok) throw new Error("expected acceptance")
    const opened = openSecrets(verified.value, server.secretKey)
    if (!opened.ok) throw new Error("expected the secrets to open")
    return performance.now() - started
  }
  run()
  const best = Math.min(...Array.from({ length: 5 }, run))
  console.log(`verify + open, 50 secrets: ${best.toFixed(2)} ms`)
  expect(best).toBeLessThan(100)
})
