/**
 * What a person is told when the install stops: the sentence for each way the
 * script can fail, for an answer that is not the script's, and for SSH that
 * could not connect at all.
 */
import type { InstallRequest } from "./checks"
import type { InstallFailure } from "./lines"

export const INSTALL_UNEXPECTED = "The installer on the server did not answer as expected, so nothing more was done."

/** Said when an install is needed and this build of zekno holds no checksum to check a download against. */
export const NO_RELEASE =
  "This build of zekno has no published runner to install. For development, add `--runner-file <path>`. Or install the runner by hand as the runner's README describes (apps/runner/README.md), then add the server with `--runner-path <path>`."

/** The last sentence of a failed update: the old runner was not touched. */
const STILL_THERE = "The runner that was there is still in place."

/**
 * The sentence for each way the install can stop (specs/004-cli-app/contracts/commands.md,
 * "Installing the runner over SSH"; `tools`, `space`, `libc` and `cpu` from
 * specs/005-runner-release/contracts/versions.md).
 */
export function installFailure(reason: InstallFailure, request: InstallRequest, where: { destination: string; server?: string }): string {
  const file = request.source.kind === "file"
  const nothing = request.mode === "update" ? STILL_THERE : "Nothing was installed."
  switch (reason) {
    case "docker":
      return "Docker with Compose was not found on the server. Install Docker with its Compose plugin there, then try again."
    case "home":
      return "The user zekno logs in as on the server has no home folder, so there is nowhere to put the runner."
    case "missing":
      return `There is no runner at ${request.mode === "update" ? request.runnerPath : "that path"} on ${where.server ?? where.destination}.`
    case "platform":
      return "This kind of server is not supported yet. The runner is built for Linux on x86-64 and ARM64."
    case "release":
      return NO_RELEASE
    case "download":
      return file
        ? "The runner file did not arrive whole on the server. Nothing was installed."
        : "The server could not download the runner. It needs curl or wget, gzip, and to reach github.com over HTTPS."
    case "tools":
      return `The server has neither sha256sum nor shasum to check the runner with, so nothing was downloaded or installed.${request.mode === "update" ? ` ${STILL_THERE}` : ""}`
    case "space":
      return `The server ran out of disk space for the runner. It needs at least 256 MiB free in /usr/local/bin as root, or in ~/.local/bin for another user. ${nothing}`
    case "libc":
      return `This server does not have the GNU C library (glibc) 2.17 or newer that the runner needs. Alpine and other Linux systems with musl are not supported yet. ${nothing}`
    case "cpu":
      return `This server's processor cannot run the runner. On x86-64 it needs SSE4.2: Intel Nehalem, AMD Bulldozer or newer. ${nothing}`
    case "checksum":
      return file
        ? "The runner file that arrived did not match the one sent. It was deleted and nothing was installed."
        : "The downloaded runner did not match the checksum this zekno holds. It was deleted and nothing was installed."
    case "install":
      return "The runner could not be put in place on the server. Check that the user zekno logs in as can write there."
    case "version":
      return `The runner did not start on the server: it did not answer with version ${request.version}.`
    case "folder":
      return "The runner's folder could not be created on the server."
    case "name":
      return notNamedRunner(request.mode === "update" ? request.runnerPath : "that path", where.server ?? where.destination)
    case "newer":
      return `The runner on ${where.server ?? where.destination} is newer than the ${request.version} this zekno carries, so it was left as it is. Update zekno instead.`
    case "usage":
      return INSTALL_UNEXPECTED
  }
}

/** Said when the runner an update was asked to replace is not a file named `zekno-runner`. */
export const notNamedRunner = (path: string, server: string): string =>
  `zekno only replaces a runner whose file is named zekno-runner. The runner for ${server} is at ${path}. Replace that one by hand.`

/** Said when SSH itself could not connect: nothing of the script ran. */
export const unreachable = (destination: string): string =>
  `${destination} could not be reached over SSH. Check that \`ssh ${destination}\` works from this machine.`
