/**
 * Which Docker engine the stand-in's scripts talk to (`endpoint.ts`;
 * specs/016-build-from-source, T008; LC8): only a socket of this machine is
 * taken, the variables that choose an engine are named, and a call's own
 * DOCKER_CONFIG holds the CLI's plugin folders and nothing else of the
 * host's configuration. Nothing here runs Docker or reads the host's own
 * Docker configuration: each test makes its own in a temporary folder.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkEndpoint,
  configJson,
  CONTEXT_ENDPOINT,
  ENDPOINT_VARIABLES,
  hostPluginDirs,
  isLocalSocket,
} from "./endpoint"

describe("the engine", () => {
  test("a socket of this machine, and nothing else", () => {
    for (const endpoint of [
      "unix:///var/run/docker.sock",
      "unix:///Users/maintainer/.docker/run/docker.sock",
    ]) {
      expect(isLocalSocket(endpoint)).toBe(true)
      expect(checkEndpoint(endpoint)).toBe(endpoint)
    }
    for (const endpoint of [
      "ssh://maintainer@server.invalid",
      "tcp://127.0.0.1:2375",
      "npipe:////./pipe/docker_engine",
      "unix://docker.sock",
      "unix:///var/run/docker.sock extra",
      "",
    ]) {
      expect(isLocalSocket(endpoint)).toBe(false)
      expect(() => checkEndpoint(endpoint)).toThrow(
        /^Docker's engine at .* is not a socket of this machine/
      )
    }
  })

  test("the variables no call takes from the shell, and the one read of the context", () => {
    expect([...ENDPOINT_VARIABLES]).toEqual([
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_TLS",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
    ])
    expect(CONTEXT_ENDPOINT).toEqual([
      "docker",
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ])
  })
})

describe("a call's own DOCKER_CONFIG", () => {
  test("the plugin folders: the configuration's own and those its config.json adds, nothing else of it", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-docker-config-"))
    try {
      writeFileSync(
        join(folder, "config.json"),
        JSON.stringify({
          auths: { "https://index.docker.io/v1/": { auth: "c2VjcmV0" } },
          credsStore: "desktop",
          currentContext: "server",
          cliPluginsExtraDirs: [
            "/Applications/Docker.app/Contents/Resources/cli-plugins",
            "relative",
            7,
          ],
        })
      )
      const dirs = hostPluginDirs({ DOCKER_CONFIG: folder }, "/nowhere")
      expect(dirs).toEqual([
        join(folder, "cli-plugins"),
        "/Applications/Docker.app/Contents/Resources/cli-plugins",
      ])
      expect(configJson(dirs)).not.toContain("auth")
      expect(configJson(dirs)).not.toContain("credsStore")
      expect(configJson(dirs)).not.toContain("currentContext")
      writeFileSync(join(folder, "config.json"), "{")
      expect(hostPluginDirs({ DOCKER_CONFIG: folder })).toEqual([
        join(folder, "cli-plugins"),
      ])
      expect(hostPluginDirs({}, folder)).toEqual([
        join(folder, ".docker", "cli-plugins"),
      ])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  test("its config.json names the plugin folders, or nothing", () => {
    expect(configJson([])).toBe("{}\n")
    expect(JSON.parse(configJson(["/a/cli-plugins"]))).toEqual({
      cliPluginsExtraDirs: ["/a/cli-plugins"],
    })
  })
})
