/**
 * `materials.ts` (specs/016-build-from-source, T016; plan item 17), branch
 * by branch: the materials read from a build's metadata in both of SLSA's
 * forms, the words a record says of them, item 17 (c)'s two policy files
 * and the way each reaches a build, and the committed image with an
 * `ONBUILD` line. A stand-in function answers for the stand-in; nothing
 * here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import type { Answer, RunOptions } from "../host/host-docker"
import {
  committedImage,
  DENY_RESERVED_REGO,
  materialsOf,
  materialWords,
  policyArgs,
  policyFileKey,
  policyLine,
  RESERVED,
  SOURCE_POLICY,
  SOURCE_POLICY_VARIABLE,
  withBuildEnv,
  withBuildEnvRun,
} from "./materials"
import type { InStandIn } from "../build-runs/rb7"

const OTHER = "zekno.invalid/check-other"
const ID = `sha256:${"cd".repeat(32)}`
const local = {
  uri: `pkg:docker/${OTHER}@k1?platform=linux%2Famd64`,
  digest: { sha256: "cd".repeat(32) },
}
const busybox = {
  uri: "pkg:docker/busybox@1.36.1?platform=linux%2Famd64",
  digest: { sha256: "ef".repeat(32) },
}

describe("materialsOf", () => {
  test("reads SLSA 0.2's materials", () => {
    expect(
      materialsOf({
        "buildx.build.provenance": {
          buildType: "x",
          materials: [local, busybox],
        },
      })
    ).toEqual({
      provenance: true,
      materials: [
        { uri: local.uri, digests: [ID] },
        { uri: busybox.uri, digests: [`sha256:${"ef".repeat(32)}`] },
      ],
    })
  })

  test("reads SLSA 1.0's resolved dependencies", () => {
    expect(
      materialsOf({
        "buildx.build.provenance": {
          buildDefinition: { resolvedDependencies: [local] },
        },
      }).materials
    ).toEqual([{ uri: local.uri, digests: [ID] }])
  })

  test("no provenance, provenance with no list, and entries that are not materials", () => {
    expect(materialsOf(undefined)).toEqual({ provenance: false, materials: [] })
    expect(materialsOf({ "buildx.build.ref": "a/b/c" })).toEqual({
      provenance: false,
      materials: [],
    })
    expect(materialsOf({ "buildx.build.provenance": "text" })).toEqual({
      provenance: false,
      materials: [],
    })
    expect(materialsOf({ "buildx.build.provenance": {} })).toEqual({
      provenance: true,
      materials: [],
    })
    expect(
      materialsOf({
        "buildx.build.provenance": {
          buildDefinition: { resolvedDependencies: "x" },
        },
      })
    ).toEqual({ provenance: true, materials: [] })
    expect(
      materialsOf({
        "buildx.build.provenance": {
          materials: [
            null,
            { uri: 7 },
            { uri: "a" },
            { uri: "b", digest: { sha256: 1 } },
          ],
        },
      }).materials
    ).toEqual([
      { uri: "a", digests: [] },
      { uri: "b", digests: [] },
    ])
  })
})

describe("materialWords", () => {
  const read = (...items: unknown[]) =>
    materialsOf({ "buildx.build.provenance": { materials: items } })

  test("says whether there are materials, and whether they name the local image", () => {
    expect(materialWords(materialsOf(undefined), OTHER)).toBe(
      "no buildx.build.provenance in its metadata"
    )
    expect(materialWords(read(), OTHER)).toBe("provenance with no materials")
    expect(materialWords(read(busybox, local), OTHER, [ID])).toBe(
      `materials name ${OTHER} (${local.uri})`
    )
    expect(
      materialWords(
        read({ uri: "pkg:docker/x@y", digest: local.digest }),
        OTHER,
        [ID]
      )
    ).toBe(
      `materials hold ${OTHER}'s digest under another name (pkg:docker/x@y)`
    )
    expect(materialWords(read(busybox), OTHER, [ID])).toBe(
      `materials (1) do not name ${OTHER}: ${busybox.uri}`
    )
  })

  test("shows at most three", () => {
    const many = ["a", "b", "c", "d", "e"].map((name) => ({
      uri: `pkg:docker/${name}`,
    }))
    expect(materialWords(read(...many), OTHER)).toBe(
      `materials (5) do not name ${OTHER}: pkg:docker/a, pkg:docker/b, pkg:docker/c and 2 more`
    )
  })
})

describe("item 17 (c)'s policy", () => {
  test("as Rego: every source but an image under zekno.invalid/, in L2's decision form", () => {
    expect(RESERVED).toBe("zekno.invalid/")
    expect(DENY_RESERVED_REGO).toContain("package docker\n")
    expect(DENY_RESERVED_REGO).toContain("default allow := true\n")
    expect(DENY_RESERVED_REGO).toContain(
      'allow := false if contains(json.marshal(input.image), "zekno.invalid/")'
    )
    expect(DENY_RESERVED_REGO).toContain('decision := {"allow": allow}')
  })

  test("as BuildKit's source policy: DENY of docker-image://zekno.invalid/*, a wildcard", () => {
    expect(SOURCE_POLICY_VARIABLE).toBe("EXPERIMENTAL_BUILDKIT_SOURCE_POLICY")
    expect(JSON.parse(SOURCE_POLICY)).toEqual({
      rules: [
        {
          action: 1,
          selector: { identifier: "docker-image://zekno.invalid/*" },
        },
      ],
    })
  })

  test("buildx's option takes the file under the key its help names, else filename", () => {
    const help = [
      "Options:",
      "      --platform stringArray   Set target platform for build",
      '      --policy stringArray     Policy configuration (format: "filename=path[,reset=true|false]")',
    ].join("\n")
    expect(policyLine(help)).toStartWith("--policy stringArray")
    expect(policyFileKey(help)).toBe("filename")
    expect(
      policyFileKey(
        "  --policy stringArray  Policy (format: file=<path>,reset=bool)"
      )
    ).toBe("file")
    expect(policyFileKey("  --policy stringArray  Policy configuration")).toBe(
      "filename"
    )
    expect(policyLine("  --platform x")).toBeUndefined()
    expect(policyArgs(help, "/tmp/zekno-check-x/policy/deny.rego")).toEqual([
      "--policy",
      "filename=/tmp/zekno-check-x/policy/deny.rego",
    ])
    expect(() => policyArgs(help, "relative.rego")).toThrow(
      "not a plain absolute path"
    )
    expect(() => policyArgs(help, "/a b")).toThrow("not a plain absolute path")
  })

  test("the source-policy file reaches a build's environment right after env -i, and nothing else", () => {
    const build = [
      "timeout",
      "-k",
      "5",
      "300",
      "env",
      "-i",
      "PATH=/bin",
      "docker",
      "buildx",
      "build",
      "-",
    ]
    expect(withBuildEnv(build, SOURCE_POLICY_VARIABLE, "/tmp/p.json")).toEqual([
      "timeout",
      "-k",
      "5",
      "300",
      "env",
      "-i",
      "EXPERIMENTAL_BUILDKIT_SOURCE_POLICY=/tmp/p.json",
      "PATH=/bin",
      "docker",
      "buildx",
      "build",
      "-",
    ])
    for (const other of [
      ["env", "-i", "PATH=/bin", "docker", "buildx", "version"],
      ["rm", "-rf", "/tmp/zekno-check-x"],
      ["env", "PATH=/bin", "docker", "buildx", "build", "-"],
    ])
      expect(withBuildEnv(other, SOURCE_POLICY_VARIABLE, "/p")).toEqual(other)
    expect(() => withBuildEnv(build, "lower", "/p")).toThrow("not a variable")
    expect(() => withBuildEnv(build, "A", "x\ny")).toThrow("not a variable")
  })

  test("withBuildEnvRun hands the changed call to the stand-in", async () => {
    const seen: (readonly string[])[] = []
    const run: InStandIn = async (args) => {
      seen.push(args)
      return { code: 0, stdout: "", stderr: "" }
    }
    await withBuildEnvRun(
      run,
      "A",
      "1"
    )(["env", "-i", "docker", "buildx", "build", "-"])
    expect(seen).toEqual([
      ["env", "-i", "A=1", "docker", "buildx", "build", "-"],
    ])
  })
})

describe("committedImage", () => {
  function fakeRun(fail?: string) {
    const calls: { args: readonly string[]; options?: RunOptions }[] = []
    const run: InStandIn = async (args, options) => {
      calls.push({ args, options })
      const failing = fail !== undefined && args.join(" ").startsWith(fail)
      return {
        code: failing ? 1 : 0,
        stdout: "",
        stderr: failing ? "refused" : "",
      } satisfies Answer
    }
    return { run, calls }
  }
  const INPUT = {
    name: "zekno-check-onbuild:1",
    base: `busybox@sha256:${"ab".repeat(32)}`,
    container: "zekno-check-onbuild",
    changes: [`ONBUILD COPY --from=${OTHER}:k1 /bin/busybox /x`],
  }

  test("creates a container that never starts, commits it with the change, removes it by name", async () => {
    const { run, calls } = fakeRun()
    const image = await committedImage(run, INPUT)
    expect(image.name).toBe(INPUT.name)
    expect(calls.map((call) => call.args)).toEqual([
      ["docker", "rm", "--force", INPUT.container],
      ["docker", "create", "--name", INPUT.container, INPUT.base],
      [
        "docker",
        "commit",
        "--change",
        INPUT.changes[0]!,
        INPUT.container,
        INPUT.name,
      ],
      ["docker", "rm", "--force", INPUT.container],
    ])
    await image.remove()
    expect(calls.at(-1)!.args).toEqual(["docker", "image", "rm", INPUT.name])
  })

  test("removes the container when the commit fails, and says what failed", async () => {
    const { run, calls } = fakeRun("docker commit")
    await expect(committedImage(run, INPUT)).rejects.toThrow(
      `docker commit as ${INPUT.name} failed (exit 1): refused`
    )
    expect(calls.at(-1)!.args).toEqual([
      "docker",
      "rm",
      "--force",
      INPUT.container,
    ])
  })

  test("an image no longer there is no fault; another failure is", async () => {
    const gone: InStandIn = async (args) =>
      args[2] === "rm" && args[1] === "image"
        ? { code: 1, stdout: "", stderr: `Error: No such image: ${INPUT.name}` }
        : { code: 0, stdout: "", stderr: "" }
    await (await committedImage(gone, INPUT)).remove()
    const { run } = fakeRun("docker image rm")
    const other = await committedImage(run, INPUT)
    await expect(other.remove()).rejects.toThrow(
      `the removal of ${INPUT.name} failed: refused`
    )
  })
})
