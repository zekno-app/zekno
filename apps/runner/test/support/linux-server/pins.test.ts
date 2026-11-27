/**
 * The stand-in's pin file (specs/016-build-from-source, plan items 2 (C),
 * 3 (a) and 26; research/map-checks.md part 4; rule LC10): what it holds,
 * and how strictly it is read. `digests.test.ts` holds the registry reader
 * of `digests.ts`. Nothing here runs Docker or reaches the network.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { PROXY_IMAGE } from "../../../src/proxy/image"
import { ENGINE_NAMES, loadPins, PINS_PATH, readPins } from "./pins"

const FOLDER = import.meta.dir
const committed = () => JSON.parse(readFileSync(PINS_PATH, "utf8"))

/** The committed file with one change made by `change`, as text. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON file of any shape
function edited(change: (pins: Record<string, any>) => void): string {
  const pins = committed()
  change(pins)
  return JSON.stringify(pins)
}

/** The one line `readPins` throws for `text`. */
function refusal(text: string): string {
  try {
    readPins(text)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("readPins accepted the file")
}

describe("the committed pins.json", () => {
  test("reads", () => {
    const pins = loadPins()
    expect(Object.keys(pins.engines).sort()).toEqual([...ENGINE_NAMES].sort())
    expect(pins.images.ubuntu.tag).toBe("ubuntu:24.04")
  })

  test("the floor is 29.5.0 with buildx 0.34.1, and the newest 29.10.1 with buildx 0.39.1", () => {
    const { floor, newest } = loadPins().engines
    expect([floor.engine, floor.buildx]).toEqual(["29.5.0", "0.34.1"])
    expect([newest.engine, newest.buildx]).toEqual(["29.10.1", "0.39.1"])
  })

  test("the engines the plan names", () => {
    const { engines } = loadPins()
    expect(engines["floor-no-buildx"]).toMatchObject({
      engine: "29.5.0",
      buildx: undefined,
    })
    expect(engines.older.engine).toBe("29.4.3")
    expect(engines.distro).toMatchObject({
      repository: "ubuntu",
      engine: "29.1.3",
      buildx: "0.30.1",
    })
    expect(engines["distro-no-buildx"].buildx).toBeUndefined()
    expect(engines.newest.compose).toBe("5.8.0")
    expect(engines.floor.packages["containerd.io"]).toStartWith("2.4.2-4~")
    expect(loadPins().ubuntu["docker-registry"]).toStartWith("2.8.2+")
  })

  test("every image is name@sha256:<64 hex>", () => {
    for (const image of Object.values(loadPins().images))
      expect(image.image).toMatch(
        /^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[0-9a-f]{64}$/
      )
    expect(loadPins().images.ubuntu.image).toBe(
      "ubuntu@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b"
    )
  })

  test("Docker's apt key is named by its fingerprint", () => {
    const { dockerKey } = loadPins()
    expect(dockerKey.fingerprint).toBe(
      "9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88"
    )
    expect(dockerKey.compact).toBe("9DC858229FC7DD38854AE2D88D81803C0EBFCD88")
  })

  test("no file under linux-server/ names the Caddy image's digest", () => {
    const digest = PROXY_IMAGE.slice(PROXY_IMAGE.indexOf(":") + 1)
    const under = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? under(path) : [path]
      })
    const naming = under(FOLDER).filter((path) =>
      readFileSync(path, "utf8").includes(digest)
    )
    expect(naming).toEqual([])
    expect(JSON.stringify(committed())).not.toContain("caddy")
  })
})

describe("the reader refuses, in one line naming the key", () => {
  const cases: [string, string, string][] = [
    ["a file that is not JSON", "{", "pins.json is not JSON"],
    ["a list", "[]", "pins.json is not an object"],
    [
      "an unknown key at the top",
      edited((p) => (p.extra = 1)),
      "pins.json: extra is not a known key",
    ],
    [
      "a missing key",
      edited((p) => delete p.ubuntu),
      "pins.json: ubuntu is missing",
    ],
    [
      "a date that is not a day",
      edited((p) => (p.lookedUp = "yesterday")),
      "pins.json: lookedUp",
    ],
    [
      "a part that is not an object",
      edited((p) => (p.images = "ubuntu:24.04")),
      "pins.json: images is not an object",
    ],
    [
      "an engine with no package",
      edited((p) => (p.engines.older = {})),
      "pins.json: engines.older names no engine",
    ],
    [
      "an unknown image",
      edited((p) => (p.images.caddy = p.images.ubuntu)),
      "pins.json: images.caddy is not a known key",
    ],
    [
      "an unknown key in an image",
      edited((p) => (p.images.ubuntu.platform = "linux/amd64")),
      "pins.json: images.ubuntu.platform is not a known key",
    ],
    [
      "a tag without a digest",
      edited((p) => (p.images.ubuntu.image = "ubuntu:24.04")),
      "pins.json: images.ubuntu.image",
    ],
    [
      "a short digest",
      edited((p) => (p.images.ubuntu.image = "ubuntu@sha256:5621")),
      "pins.json: images.ubuntu.image",
    ],
    [
      "the tag latest",
      edited((p) => (p.images.fixtures.tag = "busybox:latest")),
      "pins.json: images.fixtures.tag",
    ],
    [
      "a tag with no version",
      edited((p) => (p.images.fixtures.tag = "busybox")),
      "pins.json: images.fixtures.tag",
    ],
    [
      "an image of another name than its tag",
      edited(
        (p) =>
          (p.images.fixtures.image = p.images.fixtures.image.replace(
            "busybox",
            "alpine"
          ))
      ),
      "pins.json: images.fixtures.image",
    ],
    [
      "a fingerprint written otherwise",
      edited((p) => (p.dockerKey.fingerprint = "9dc858229fc7dd38")),
      "pins.json: dockerKey.fingerprint",
    ],
    [
      "a key fetched over plain HTTP",
      edited(
        (p) => (p.dockerKey.url = "http://download.docker.com/linux/ubuntu/gpg")
      ),
      "pins.json: dockerKey.url",
    ],
    [
      "a repository over plain HTTP",
      edited(
        (p) =>
          (p.dockerRepository.url = "http://download.docker.com/linux/ubuntu")
      ),
      "pins.json: dockerRepository.url",
    ],
    ...[
      'https://download.docker.com/linux/ubuntu" ; touch /x ; echo "',
      "https://download.docker.com/linux/$(touch /x)",
      "https://download.docker.com/linux/`touch /x`",
      "https://download.docker.com/linux/ubuntu stable",
      "https://download.docker.com:8443/linux/ubuntu",
      "https://user@download.docker.com/linux/ubuntu",
      "https://download.docker.com/linux/ubuntu?x=1",
      "https://download.docker.com/linux/ubuntu/",
    ].flatMap((url): [string, string, string][] => [
      [
        `a repository address with more than a host and plain path parts: ${url}`,
        edited((p) => (p.dockerRepository.url = url)),
        "pins.json: dockerRepository.url",
      ],
      [
        `a key address with more than a host and plain path parts: ${url}`,
        edited((p) => (p.dockerKey.url = url)),
        "pins.json: dockerKey.url",
      ],
    ]),
    [
      "a suite with a space",
      edited((p) => (p.dockerRepository.suite = "noble main")),
      "pins.json: dockerRepository.suite",
    ],
    [
      "an unknown Ubuntu package",
      edited((p) => (p.ubuntu.gpg = "2.4.4-2ubuntu17.6")),
      "pins.json: ubuntu.gpg is not a known key",
    ],
    [
      "a version range",
      edited((p) => (p.ubuntu.curl = ">= 8.5.0")),
      'pins.json: ubuntu.curl is ">= 8.5.0", not an exact apt version',
    ],
    [
      "a wildcard",
      edited((p) => (p.engines.floor["docker-ce"] = "5:29.5.*")),
      "pins.json: engines.floor.docker-ce",
    ],
    [
      "a range written with a caret",
      edited((p) => (p.engines.floor["docker-ce"] = "^5:29.5.0")),
      "pins.json: engines.floor.docker-ce",
    ],
    [
      "two versions",
      edited((p) => (p.ubuntu.iproute2 = "6.1.0-1ubuntu6.4 || 6.1.0-1ubuntu6")),
      "pins.json: ubuntu.iproute2",
    ],
    [
      "latest as a version",
      edited((p) => (p.engines.newest["docker-ce"] = "latest")),
      "pins.json: engines.newest.docker-ce",
    ],
    [
      "a version that is not text",
      edited((p) => (p.ubuntu.strace = 6.8)),
      "pins.json: ubuntu.strace",
    ],
    [
      "an unknown engine",
      edited((p) => (p.engines.nightly = p.engines.newest)),
      "pins.json: engines.nightly is not a known key",
    ],
    [
      "a missing engine",
      edited((p) => delete p.engines.older),
      "pins.json: engines.older is missing",
    ],
    [
      "an unknown package in an engine",
      edited(
        (p) => (p.engines.floor["docker-ce-rootless-extras"] = "5:29.5.0-1")
      ),
      "pins.json: engines.floor.docker-ce-rootless-extras is not a known key",
    ],
    [
      "an engine from both repositories",
      edited((p) => (p.engines.floor["docker.io"] = "29.1.3-0ubuntu3~24.04.2")),
      "pins.json: engines.floor",
    ],
    [
      "an engine missing a package of its own",
      edited((p) => delete p.engines.floor["containerd.io"]),
      "pins.json: engines.floor.containerd.io is missing",
    ],
    [
      "an engine of Ubuntu missing containerd",
      edited((p) => delete p.engines.distro.containerd),
      "pins.json: engines.distro.containerd is missing",
    ],
    [
      "a client and an engine of two versions",
      edited(
        (p) =>
          (p.engines.floor["docker-ce-cli"] = "5:29.5.1-1~ubuntu.24.04~noble")
      ),
      "pins.json: engines.floor.docker-ce-cli",
    ],
    [
      "buildx in an engine named without it",
      edited(
        (p) =>
          (p.engines["floor-no-buildx"]["docker-buildx-plugin"] =
            "0.34.1-1~ubuntu.24.04~noble")
      ),
      "pins.json: engines.floor-no-buildx",
    ],
    [
      "no buildx in an engine named with it",
      edited((p) => delete p.engines.distro["docker-buildx"]),
      "pins.json: engines.distro",
    ],
  ]

  for (const [what, text, start] of cases)
    test(what, () => {
      const line = refusal(text)
      expect(line).toStartWith(start)
      expect(line).not.toContain("\n")
    })
})
