/**
 * The test switch (specs/015-domains-https, contracts/runner.md, RN6;
 * research R25): `ZEKNO_PROXY_TEST=<http>:<https>` in the runner's own
 * environment makes the proxy publish those two ports on 127.0.0.1 only, in
 * place of 80 and 443, and take its certificates from Caddy's internal
 * authority, so the tests run a real proxy without touching the machine's
 * ports or any certificate authority. It is read from the environment only,
 * as `ZEKNO_DOCKER` is: a deploy cannot set it, and SSH does not carry it.
 */

/** Two ports for the proxy to publish on 127.0.0.1 in place of 80 and 443. */
export type TestPorts = { http: number; https: number }

const isHighPort = (port: number) =>
  Number.isInteger(port) && port > 1023 && port <= 65535

/**
 * The test switch: undefined when it is not set (the proxy publishes 80 and
 * 443), the two ports when it is, or `invalid` when it is set to anything
 * else. A switch that is set wrong starts no proxy at all, so a typo never
 * puts a test's proxy on the machine's own ports.
 */
export function testSwitch(): TestPorts | "invalid" | undefined {
  const value = process.env.ZEKNO_PROXY_TEST
  if (value === undefined || value === "") return undefined
  const match = /^(\d{4,5}):(\d{4,5})$/.exec(value)
  if (!match) return "invalid"
  const ports = { http: Number(match[1]), https: Number(match[2]) }
  return isHighPort(ports.http) &&
    isHighPort(ports.https) &&
    ports.http !== ports.https
    ? ports
    : "invalid"
}

/** The `-p` arguments of the proxy's `docker run`. */
export function publishArgs(ports: TestPorts | undefined): string[] {
  return ports
    ? ["-p", `127.0.0.1:${ports.http}:80`, "-p", `127.0.0.1:${ports.https}:443`]
    : ["-p", "80:80", "-p", "443:443"]
}

/**
 * The port Docker's error text names, as the proxy's own port: 443 when the
 * text names the HTTPS port as published, else 80, which is also the answer
 * when neither can be told (RN6).
 */
export function portNamed(
  text: string,
  ports: TestPorts | undefined
): 80 | 443 {
  const https = ports?.https ?? 443
  const named = [...text.matchAll(/:(\d{1,5})(?!\d)/g)].map((m) => Number(m[1]))
  return named.includes(https) ? 443 : 80
}
