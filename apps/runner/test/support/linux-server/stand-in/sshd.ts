/**
 * sshd in the server stand-in (specs/016-build-from-source,
 * research/map-checks.md part 6, step 3; rule LC9): its port, published on
 * 127.0.0.1 only, above 1024 and never 3000 or 3100; a client key made on
 * this machine in the run's temporary folder; a host key made in the
 * stand-in; and a configuration of its own that lets root in by key only.
 * No private key crosses into or out of a container.
 */
import { join } from "node:path"

import { inContainer, q } from "./shell"

/** The ports the repository's apps use on this machine; the stand-in never takes them. */
const NEVER = [3000, 3100]
const PORT_LOW = 20_000
const PORT_HIGH = 60_000
export const HOST_KEY = "/etc/ssh/ssh_host_ed25519_key"
const SSHD_CONFIG = "/etc/ssh/zekno-check-sshd_config"
const SSHD_LOG = "/var/log/zekno-check-sshd.log"
const ED25519 = /^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [A-Za-z0-9@._-]+)?$/

/** `port` when the stand-in may publish sshd on it: above 1024, and never 3000 or 3100. */
export function checkPort(port: number): number {
  if (NEVER.includes(port)) throw new Error(`port ${port} is never used`)
  if (!Number.isInteger(port) || port <= 1024 || port > 65_535)
    throw new Error(`the stand-in's port ${port} is not a port above 1024`)
  return port
}

/** A port for sshd on 127.0.0.1, between 20000 and 59999; `server.ts` checks it is free. */
export function choosePort(random: () => number = Math.random): number {
  return checkPort(PORT_LOW + Math.floor(random() * (PORT_HIGH - PORT_LOW)))
}

/** `ssh-keygen` on this machine: the client's key, in the run's temporary folder. */
export function clientKeyCommand(keyFolder: string, comment: string): string[] {
  const file = join(keyFolder, "client_ed25519")
  return [
    "ssh-keygen",
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    comment,
    "-f",
    file,
  ]
}

/** One ssh-ed25519 public key line, or a throw. */
function publicKey(line: string): string {
  const key = line.trim()
  if (!ED25519.test(key))
    throw new Error("the key is not one ssh-ed25519 public key")
  return key
}

/**
 * sshd in `server`: the client's public key authorized for root, a host key
 * made now in the stand-in, a configuration checked, then sshd started.
 */
export function sshdCommand(server: string, clientPublicKey: string): string[] {
  const config = [
    "Port 22",
    `HostKey ${HOST_KEY}`,
    "PermitRootLogin prohibit-password",
    "AuthenticationMethods publickey",
    "PubkeyAuthentication yes",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "UsePAM no",
    "AllowUsers root",
    "AuthorizedKeysFile .ssh/authorized_keys",
    "PidFile /run/sshd.pid",
  ]
  return inContainer(server, [
    "install -d -m 0700 /root/.ssh",
    `printf '%s\\n' ${q(publicKey(clientPublicKey))} > /root/.ssh/authorized_keys`,
    "chmod 0600 /root/.ssh/authorized_keys",
    "rm -f /etc/ssh/ssh_host_*",
    `ssh-keygen -q -t ed25519 -N '' -C ${q(server)} -f ${HOST_KEY} < /dev/null`,
    `printf '%s\\n' ${config.map(q).join(" ")} > ${SSHD_CONFIG}`,
    "install -d -m 0755 /run/sshd",
    `/usr/sbin/sshd -t -f ${SSHD_CONFIG}`,
    `/usr/sbin/sshd -f ${SSHD_CONFIG} -E ${SSHD_LOG}`,
  ])
}

/** Reads the server's host key, made by `sshdCommand`, for known_hosts. */
export function hostKeyCommand(server: string): string[] {
  return ["docker", "exec", server, "cat", `${HOST_KEY}.pub`]
}

/** The known_hosts line for the server's key, reached at 127.0.0.1:`port`. */
export function knownHostsLine(port: number, hostPublicKey: string): string {
  const [kind, key] = publicKey(hostPublicKey).split(" ")
  return `[127.0.0.1]:${checkPort(port)} ${kind} ${key}`
}
