/**
 * The runner versions every test of the version grammar uses
 * (specs/005-runner-release/tasks.md, "The version grammar"). The CLI's tests
 * use the same lists, so the installer's shell copy of the order is checked
 * against the TypeScript one on exactly these.
 */

/** Valid versions, oldest first. */
export const ORDERED_VERSIONS = [
  "0.0.9",
  "0.1.0-dev.1",
  "0.1.0-dev.2",
  "0.1.0-dev.10",
  "0.1.0",
  "0.1.1-dev.1",
  "0.1.1",
  "0.2.0",
  "0.10.0",
  "1.0.0-dev.1",
  "1.0.0",
] as const

/** Not versions, each for its own reason. */
export const REFUSED_VERSIONS = [
  "0.1",
  "0.1.0.1",
  "01.1.0",
  "0.01.0",
  "0.1.00",
  "0.1.0-dev",
  "0.1.0-dev.0",
  "0.1.0-dev.01",
  "0.1.0-dev.1.2",
  "0.1.0-rc.1",
  "0.1.0-DEV.1",
  "0.1.0+1",
  "v0.1.0",
  "1000000000.0.0",
  "0.1.0-dev.1000000000",
  "",
  "0.1.0 ",
  "0.1.0\n",
] as const
