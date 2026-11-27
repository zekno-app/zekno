/**
 * The pure part of the server stand-in (specs/016-build-from-source,
 * research/map-checks.md part 6, steps 1 to 4; quickstart.md, "Where things
 * run"; rule LC8). From pins.json and the options `--engine`, `--store` and
 * `--memory 1g`, it gives the exact argument lists that make, set up and
 * remove one stand-in, and runs nothing: `server.ts` runs them.
 *
 * The stand-in is a privileged `ubuntu:24.04` container, pinned by digest,
 * with Docker's packages at exact versions from Docker's signed apt
 * repository, the repository key's fingerprint checked first (option C of
 * map-checks part 4). Everything it makes is named `zekno-check-<id>-*`;
 * only the server is privileged; nothing is published but sshd, on
 * 127.0.0.1 (`sshd.ts`).
 */
import { isAbsolute } from "node:path"

import { keyCheck } from "./apt-key"
import {
  ENGINE_NAMES,
  ENGINE_PACKAGES,
  type EngineName,
  type Pins,
  UBUNTU_PACKAGES,
} from "../pins"
import { inContainer, q } from "./shell"
import { checkPort, clientKeyCommand, hostKeyCommand } from "./sshd"

export const STORES = ["containerd", "overlay2"] as const
export type Store = (typeof STORES)[number]

export type Options = {
  readonly engine: EngineName
  readonly store: Store
  /** Holds the stand-in to 1 GB with no swap, for the out-of-memory check. */
  readonly memory: boolean
}

/**
 * Each store's `daemon.json`. The containerd store is what a fresh data
 * folder gets on these engines; overlay2's is the map's, byte for byte.
 */
export const DAEMON_JSON: Readonly<Record<Store, string>> = {
  containerd: "{}",
  overlay2:
    '{"features":{"containerd-snapshotter":false},"storage-driver":"overlay2"}',
}

const ID_LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789"
const KEY_FILE = "/etc/apt/keyrings/docker.asc"
const SOURCES_FILE = "/etc/apt/sources.list.d/docker.list"
const DOCKERD_PID = "/run/zekno-check-dockerd.pid"
const DOCKERD_LOG = "/var/log/zekno-check-dockerd.log"
const APT_INSTALL = "apt-get install --yes --no-install-recommends"

/** Reads `--engine <name> --store <store> [--memory 1g]`; anything else throws. */
export function readOptions(args: readonly string[]): Options {
  const given = new Map<string, string | undefined>()
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at]!
    if (!["--engine", "--store", "--memory"].includes(flag))
      throw new Error(`${flag} is not an option`)
    if (given.has(flag)) throw new Error(`${flag} is given twice`)
    given.set(flag, args[at + 1])
  }
  const value = (flag: string, allowed: readonly string[], words: string) => {
    if (!given.has(flag)) throw new Error(`${flag} is missing`)
    const found = given.get(flag)
    if (found === undefined || !allowed.includes(found))
      throw new Error(
        `${flag} takes ${words}, not ${found === undefined ? "nothing" : JSON.stringify(found)}`
      )
    return found
  }
  const engine = value(
    "--engine",
    ENGINE_NAMES,
    `${ENGINE_NAMES.slice(0, -1).join(", ")} or ${ENGINE_NAMES.at(-1)}`
  ) as EngineName
  const store = value("--store", STORES, "containerd or overlay2") as Store
  if (given.has("--memory")) value("--memory", ["1g"], "1g")
  return { engine, store, memory: given.has("--memory") }
}

/** A run id: 8 random lowercase letters and digits, drawn without bias. */
export function newId(
  random: (count: number) => Uint8Array = (count) =>
    crypto.getRandomValues(new Uint8Array(count))
): string {
  let id = ""
  // 252 is the largest multiple of 36 a byte holds; bytes above it are drawn again.
  while (id.length < 8)
    for (const byte of random(16))
      if (byte < 252 && id.length < 8) id += ID_LETTERS[byte % 36]
  return id
}

export type Names = {
  readonly server: string
  /** The volume on the server's `/var/lib/docker`. */
  readonly data: string
  readonly net: string
  readonly client: string
}

export function namesOf(id: string): Names {
  if (!/^[a-z0-9]{8}$/.test(id))
    throw new Error(
      `the run id ${JSON.stringify(id)} is not 8 lowercase letters and digits`
    )
  const name = (part: string) => `zekno-check-${id}-${part}`
  return {
    server: name("server"),
    data: name("data"),
    net: name("net"),
    client: name("client"),
  }
}

function engineOf(pins: Pins, engine: EngineName) {
  if (!ENGINE_NAMES.includes(engine) || !(engine in pins.engines))
    throw new Error(
      `the engine ${JSON.stringify(engine)} is not one of pins.json's`
    )
  return pins.engines[engine]
}

/** `name=version` for each package, as `apt-get install` takes an exact version. */
const exact = (packages: Readonly<Record<string, string>>) =>
  Object.entries(packages).map(([name, version]) => `${name}=${version}`)

/** Starts dockerd in the background and waits for it to answer. */
const START_DOCKERD = [
  `setsid dockerd --config-file /etc/docker/daemon.json --pidfile ${DOCKERD_PID} > ${DOCKERD_LOG} 2>&1 < /dev/null &`,
  "i=0",
  "until docker info > /dev/null 2>&1; do",
  "  i=$((i + 1))",
  `  if [ "$i" -gt 60 ]; then echo "dockerd did not answer within 60 seconds; its log is ${DOCKERD_LOG}" >&2; exit 1; fi`,
  "  sleep 1",
  "done",
]

/** The apt lines: curl and the certificates, Docker's key checked, then every package exactly. */
function installLines(pins: Pins, engine: EngineName): string[] {
  const { url, suite, component } = pins.dockerRepository
  const ubuntu = Object.fromEntries(
    UBUNTU_PACKAGES.map((name) => [name, pins.ubuntu[name]])
  )
  const { "ca-certificates": certificates, curl, ...rest } = ubuntu
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    // No package starts a service of its own: dockerd and sshd are started by the plan.
    "printf '#!/bin/sh\\nexit 101\\n' > /usr/sbin/policy-rc.d",
    "chmod 0755 /usr/sbin/policy-rc.d",
    "apt-get update",
    `${APT_INSTALL} ${exact({ "ca-certificates": certificates!, curl: curl! }).join(" ")}`,
    "install -d -m 0755 /etc/apt/keyrings",
    `curl --fail --silent --show-error --proto =https --tlsv1.2 --output ${KEY_FILE} ${q(pins.dockerKey.url)}`,
    keyCheck(KEY_FILE, pins.dockerKey.compact),
    `chmod 0644 ${KEY_FILE}`,
    // Each value of pins.json is one quoted word; only dpkg's answer is read by the shell.
    `printf 'deb [arch=%s signed-by=%s] %s %s %s\\n' "$(dpkg --print-architecture)" ${KEY_FILE} ${[url, suite, component].map(q).join(" ")} > ${SOURCES_FILE}`,
    "apt-get update",
    `${APT_INSTALL} ${[...exact(rest), ...exact(engineOf(pins, engine).packages)].join(" ")}`,
  ]
}

export type StandIn = {
  readonly id: string
  readonly port: number
  readonly names: Names
  readonly options: Options
  readonly volume: readonly string[]
  readonly network: readonly string[]
  /** The privileged server, with sshd's port on 127.0.0.1 only. */
  readonly server: readonly string[]
  /** Ubuntu's packages and the engine, at exact versions. */
  readonly install: readonly string[]
  /** `daemon.json`, the move into a child cgroup, dockerd started. */
  readonly daemon: readonly string[]
  /** Run on this machine: the client's key, made in the run's temporary folder. */
  readonly clientKey: readonly string[]
  /** Reads the server's own host key, made by `sshdCommand`, for known_hosts. */
  readonly hostKey: readonly string[]
  readonly client: readonly string[]
  readonly clientInstall: readonly string[]
  /** By exact name: the containers, then the network and the volume. */
  readonly remove: readonly (readonly string[])[]
}

/**
 * The argument lists of one stand-in. `run.keyFolder` is the temporary
 * folder `server.ts` made on this machine for the client's key.
 */
export function planStandIn(
  pins: Pins,
  options: Options,
  run: { id: string; port: number; keyFolder: string }
): StandIn {
  const names = namesOf(run.id)
  const port = checkPort(run.port)
  engineOf(pins, options.engine)
  if (!STORES.includes(options.store))
    throw new Error(
      `the store ${JSON.stringify(options.store)} is neither containerd nor overlay2`
    )
  if (!isAbsolute(run.keyFolder))
    throw new Error(`the key folder ${run.keyFolder} is not an absolute path`)
  const label = ["--label", `zekno-check=${run.id}`]
  const image = pins.images.ubuntu.image
  const { iproute2, "openssh-client": sshClient } = pins.ubuntu
  const container = (name: string) => [
    ...["docker", "run", "--detach", "--init"],
    ...["--name", name, "--hostname", name, ...label],
  ]
  return {
    id: run.id,
    port,
    names,
    options,
    volume: ["docker", "volume", "create", ...label, names.data],
    network: ["docker", "network", "create", ...label, names.net],
    server: [
      ...container(names.server),
      ...["--privileged", "--cgroupns=private"],
      ...["--volume", `${names.data}:/var/lib/docker`],
      ...["--network", names.net],
      ...(options.memory ? ["--memory", "1g", "--memory-swap", "1g"] : []),
      ...["--publish", `127.0.0.1:${port}:22`],
      ...[image, "sleep", "infinity"],
    ],
    install: inContainer(names.server, installLines(pins, options.engine)),
    daemon: inContainer(names.server, [
      "install -d -m 0755 /etc/docker",
      `printf '%s' ${q(DAEMON_JSON[options.store])} > /etc/docker/daemon.json`,
      // cgroup v2: move every process out of the root group, then enable the
      // controllers for the groups dockerd makes, as moby's hack/dind does.
      "if [ -f /sys/fs/cgroup/cgroup.controllers ]; then",
      "  mkdir -p /sys/fs/cgroup/init",
      "  xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs || :",
      "  sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers > /sys/fs/cgroup/cgroup.subtree_control",
      "fi",
      ...START_DOCKERD,
    ]),
    clientKey: clientKeyCommand(run.keyFolder, names.client),
    hostKey: hostKeyCommand(names.server),
    client: [
      ...container(names.client),
      ...["--network", names.net],
      ...["--cap-add", "NET_ADMIN"],
      ...[image, "sleep", "infinity"],
    ],
    clientInstall: inContainer(names.client, [
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update",
      `${APT_INSTALL} ${exact({ iproute2, "openssh-client": sshClient }).join(" ")}`,
    ]),
    remove: [
      ["docker", "rm", "--force", names.client],
      ["docker", "rm", "--force", names.server],
      ["docker", "network", "rm", names.net],
      ["docker", "volume", "rm", names.data],
    ],
  }
}

/**
 * Swaps the engine of a running stand-in (map-checks T5): dockerd stopped,
 * the pinned packages installed and every other engine package removed in
 * one apt run, dockerd started again on the same data folder and store.
 */
export function engineSwap(
  pins: Pins,
  names: Names,
  engine: EngineName
): string[] {
  const packages = engineOf(pins, engine).packages
  // `filter` gives a new list, so sorting it changes nothing of pins.ts's.
  const others = ENGINE_PACKAGES.filter((name) => !(name in packages))
    .sort()
    .map((name) => `${name}-`)
  return inContainer(names.server, [
    "export DEBIAN_FRONTEND=noninteractive",
    `if [ -f ${DOCKERD_PID} ]; then`,
    `  pid=$(cat ${DOCKERD_PID})`,
    '  kill "$pid" 2> /dev/null || :',
    "  i=0",
    '  while kill -0 "$pid" 2> /dev/null; do',
    "    i=$((i + 1))",
    '    if [ "$i" -gt 60 ]; then echo "dockerd did not stop within 60 seconds" >&2; exit 1; fi',
    "    sleep 1",
    "  done",
    "fi",
    `${APT_INSTALL} --allow-downgrades ${[...exact(packages), ...others].join(" ")}`,
    ...START_DOCKERD,
  ])
}
