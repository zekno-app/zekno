/** Every size and count limit, in one place. Sizes are in bytes unless named otherwise. */
export const LIMITS = {
  /** Secrets in one deploy. */
  secretsPerDeploy: 256,
  /** One secret value, as UTF-8. */
  secretValueBytes: 64 * 1024,
  /** Characters in a secret name. */
  secretNameLength: 128,
  /** The service definition carried by a deploy, as UTF-8. */
  composeBytes: 256 * 1024,
  /** Members in a team list. */
  members: 64,
  /** Characters in a member's or a server's display name. */
  memberNameLength: 64,
  /** Servers in a team list. */
  servers: 256,
  /** How far a deploy number may be above the last one accepted for its app. */
  sequenceStep: 2 ** 20,
  /** The signed payload of an envelope. */
  payloadBytes: 1024 * 1024,
  /** Any message read from outside, as received. */
  messageBytes: 32 * 1024 * 1024,
  /** Secret records and removals considered when working out an app's current secrets. */
  secretHistory: 4096,
  /** Deploys in one "pending deploys" response. */
  pendingDeploys: 64,
  /** Team lists in one chain response. */
  rosterChain: 1024,
  /** Apps one runner holds deploys of. A runner refuses a deploy of one more. */
  appsPerServer: 1024,
  /** Secrets one runner remembers a version of, across its apps ("app/NAME"). A runner refuses a deploy that would make it more. */
  secretsPerServer: 8192,
  /** Services of one app in an answer about what is running. */
  servicesPerApp: 256,
  /** Services across all apps in an answer about what is running. A runner leaves out the apps past it. */
  servicesPerServer: 4096,
  /** Characters in the Compose file's path a signed link names, relative to the linked folder. */
  linkComposeLength: 255,

  // The signed deploy's version 2 (contracts/message.md, "New limits"). The
  // limits of its later fields are fixed now with the format, though a runner
  // carries those fields out only in later steps.

  /** Builds in one deploy. */
  buildsPerDeploy: 8,
  /** One build's source pack, before it is cut into chunks. */
  packBytes: 512 * 1024 * 1024,
  /** One chunk of a pack, before it is sealed. A pack has exactly ceil(size / chunkBytes) chunks. */
  chunkBytes: 8 * 1024 * 1024,
  /** Distinct chunks across all builds of one deploy. */
  chunksPerDeploy: 64,
  /** Build arguments of one build. */
  argsPerBuild: 32,
  /** One build argument's value, as UTF-8. */
  argValueBytes: 4 * 1024,
  /** Every build argument's value of one deploy together, as UTF-8. */
  argBytesPerDeploy: 64 * 1024,
  /** Secrets one build may read. */
  buildSecretsPerBuild: 32,
  /** Characters in a build's Dockerfile path, inside its pack. */
  dockerfileLength: 255,
  /** Seconds one build may take. */
  buildSeconds: 7200,
  /** Words of the pre-deploy command. */
  predeployWords: 64,
  /** Characters in one word of the pre-deploy command. */
  predeployWordLength: 4096,
  /** Every word of the pre-deploy command together, as UTF-8. */
  predeployBytes: 16 * 1024,
  /** Seconds the pre-deploy command may take. */
  predeploySeconds: 3600,
  /** Services one health check looks at. */
  healthServices: 16,
  /** Characters in a health check's HTTP path. */
  healthPathLength: 1024,
  /** Seconds a health check may wait for every service. */
  healthSeconds: 1800,
  /** Routes in one deploy. */
  routesPerDeploy: 64,
  /** Characters in a routed domain. */
  domainLength: 253,
  /** Domains in force on one server, across its apps (specs/015-domains-https, contracts/core.md). A runner refuses a deploy that would make it more. */
  domainsPerServer: 1024,
  /**
   * The health checks in force on one server, by app, as the answer to
   * `status` with routes writes them (specs/015-domains-https,
   * contracts/core.md), so that answer always fits its frame. A runner
   * refuses a deploy that would make it more.
   */
  healthBytesPerServer: 256 * 1024,
  /** Sealed secret records one runner keeps, across its apps, as stored. A runner refuses a deploy that would make it more. */
  recordBytesPerServer: 64 * 1024 * 1024,
  /**
   * Characters of a secret statement's signed payload, as base64url, where a
   * runner takes a supplied record (K13), where it answers `records`, and
   * what a client keeps in `held/`. A real statement is under 1 KiB of JSON:
   * the longest names, version and time make about 600 characters. A longer
   * one is padding, which a runner would keep and hand out at every `records`
   * read (security review S2).
   */
  statementPayloadLength: 4096,
  /** How far after the runner's clock a deploy's expiry may be, in milliseconds. */
  expiryWindowMs: 7 * 24 * 60 * 60 * 1000,
} as const

/** Longest base64url text that can encode `bytes` bytes. */
export function base64UrlLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3)
}
