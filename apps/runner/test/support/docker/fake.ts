/**
 * A stand-in for the `docker` command. It records how it was called and with
 * what environment, and exits with the status written in its `exit` file.
 *
 * `compose ... up` prints prepared lines and can be held in the middle until
 * the test lets it go, or made never to end (`upNeverEnds`), as an `up`
 * waiting on a container that never exits does. `compose -p <project> ps`
 * prints a prepared file, or hangs when asked to. `compose -p <project> logs`
 * prints a prepared file and, when the test asks and the call has
 * `--follow`, stays alive afterwards the way Docker does.
 *
 * Since feature 015 (contracts/runner.md, "Tests"), `network`, `run`,
 * `exec`, `logs`, `inspect`, `rm`, `start`, `volume`, `image`, `pull` and
 * `compose -p <project> ps -q <service>` are answered by a model of Docker
 * (`stand-in.ts`, `stand-in-proxy.ts`, `model.ts`)
 * that a test can script, and are recorded with the other calls, in order.
 * Every other call still behaves as `up` does, as it always has.
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  changeModel,
  composeLabels,
  newId,
  readModel,
  type FakeContainer,
  type Model,
  type Script,
} from "./model"

/** One call of the stand-in Docker: its arguments, its environment and the folder it was started in. */
export type DockerCall = {
  args: string
  env: Record<string, string>
  cwd: string
}

const STAND_IN = join(import.meta.dir, "stand-in.ts")

function readCalls(log: string): DockerCall[] {
  if (!existsSync(log)) return []
  return readFileSync(log, "utf8")
    .split("END\n")
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.trim().split("\n")
      const env: Record<string, string> = {}
      for (const line of lines.filter((entry) => entry.startsWith("ENV "))) {
        const [name, ...rest] = line.slice(4).split("=")
        env[name!] = rest.join("=")
      }
      const cwd =
        lines.find((entry) => entry.startsWith("CWD "))?.slice(4) ?? ""
      return {
        args: lines.find((entry) => entry.startsWith("ARGS "))!.slice(5),
        env,
        cwd,
      }
    })
}

function pidIn(file: string): number | undefined {
  if (!existsSync(file)) return undefined
  const pid = Number(readFileSync(file, "utf8").trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

export function fakeDocker() {
  const dir = mkdtempSync(join(tmpdir(), "zekno-docker-"))
  const path = join(dir, "docker")
  const log = join(dir, "calls.log")
  const inspectLog = join(dir, "inspect.log")
  const at = (name: string) => join(dir, name)
  const record = `{ echo "ARGS $*"; echo "CWD $(pwd -P)"; env | sed 's/^/ENV /'; echo END; } >> "${log}"`
  // Started from its own folder once the call's folder is recorded: Bun starts slowly in a crowded temporary folder.
  const standIn = `cd "${import.meta.dir}" && exec "${process.execPath}" "${STAND_IN}" "$d" "$@"`
  writeFileSync(
    path,
    `#!/bin/sh
d="${dir}"
case "$1" in
  network|run|exec|logs|inspect|rm|start|volume|image|pull) ${record}; ${standIn} ;;
esac
if [ "$1" = "compose" ] && [ "$4" = "ps" ] && [ "$5" = "-q" ]; then ${record}; ${standIn}; fi
if [ "$4" = "ps" ] || [ "$4" = "logs" ]; then
  { echo "ARGS $*"; echo "CWD $(pwd -P)"; env | sed 's/^/ENV /'; echo END; } >> "${inspectLog}"
else
  ${record}
fi
if [ "$4" = "ps" ]; then
  if [ -f "$d/ps-hang" ]; then echo $$ > "$d/ps.pid"; exec sleep 60; fi
  if [ -f "$d/ps-$3" ]; then cat "$d/ps-$3"; fi
  if [ -f "$d/ps-$3.exit" ]; then exit "$(cat "$d/ps-$3.exit")"; fi
  exit 0
fi
if [ "$4" = "logs" ]; then
  if [ -f "$d/logs-$3" ]; then cat "$d/logs-$3"; fi
  # Like Docker, it stays alive afterwards only when asked to follow.
  case " $* " in *" --follow "*) ;; *) exit 0 ;; esac
  if [ -f "$d/logs-leave-child" ]; then
    # A process left behind that keeps the output open after this one is stopped.
    sleep 60 &
    echo $! > "$d/logs-child.pid"
    echo $$ > "$d/logs.pid"
    wait
  fi
  if [ -f "$d/logs-follow" ]; then echo $$ > "$d/logs.pid"; exec sleep 60; fi
  exit 0
fi
if [ -f "$d/up-stdout" ]; then cat "$d/up-stdout"; fi
if [ -f "$d/up-stderr" ]; then cat "$d/up-stderr" >&2; fi
if [ -f "$d/up-never" ] && [ "$1" = "compose" ]; then
  if [ -f "$d/up-never-child" ]; then
    # A process left behind that keeps both outputs open after this one is stopped.
    sleep 60 &
    echo $! > "$d/up-child.pid"
  fi
  echo $$ > "$d/up.pid"
  if [ -f "$d/up-never-prints" ]; then exec yes " Container zekno-web-web-1  Waiting"; fi
  if [ -f "$d/up-never-child" ]; then wait; fi
  exec sleep 60
fi
if [ -f "$d/up-hold" ]; then
  touch "$d/up-started"
  while [ ! -f "$d/up-go" ]; do sleep 0.05; done
  if [ -f "$d/up-after" ]; then cat "$d/up-after" >&2; fi
fi
touch "$d/up-done"
if [ -f "$d/exit" ]; then exit "$(cat "$d/exit")"; fi
exit 0
`
  )
  chmodSync(path, 0o755)
  return {
    path,
    failWith: (status: number) => writeFileSync(at("exit"), String(status)),
    /** Every call but `compose … ps` (for state) and `compose … logs`, in order: `up` and the calls of feature 015. */
    calls: (): DockerCall[] => readCalls(log),
    /** The `ps` and `logs` calls, in order. */
    inspections: (): DockerCall[] => readCalls(inspectLog),
    /** What `up` prints on standard output and standard error. */
    upPrints(output: { stdout?: string; stderr?: string }) {
      if (output.stdout !== undefined)
        writeFileSync(at("up-stdout"), output.stdout)
      if (output.stderr !== undefined)
        writeFileSync(at("up-stderr"), output.stderr)
    },
    /** Makes `up` stop after its first lines until `releaseUp`, then print `after` on standard error. */
    holdUp: (after = "") => {
      writeFileSync(at("up-after"), after)
      writeFileSync(at("up-hold"), "")
    },
    upStarted: () => existsSync(at("up-started")),
    releaseUp: () => writeFileSync(at("up-go"), ""),
    /** True once an `up` ran to its end. */
    upFinished: () => existsSync(at("up-done")),
    /**
     * Makes `compose … up` never end once it has printed its lines
     * (`upPrints`): it waits for ever, or with `prints` writes a line without
     * pause for ever. With `leaveChild` it first starts a process that keeps
     * both outputs open after `up` itself is stopped, as a process Docker
     * left behind would.
     */
    upNeverEnds: (options: { prints?: boolean; leaveChild?: boolean } = {}) => {
      writeFileSync(at("up-never"), "")
      if (options.prints) writeFileSync(at("up-never-prints"), "")
      if (options.leaveChild) writeFileSync(at("up-never-child"), "")
    },
    /** Lets the next `up` end again, as before `upNeverEnds`. */
    upEndsAgain: () => {
      for (const name of ["up-never", "up-never-prints", "up-never-child"])
        rmSync(at(name), { force: true })
    },
    /** The process id of the last `up` that never ended, once it has started. */
    upPid: (): number | undefined => pidIn(at("up.pid")),
    /** The process id of what `up` left behind with `leaveChild`. */
    upChildPid: (): number | undefined => pidIn(at("up-child.pid")),
    /** What `ps` prints for an app, and the status it exits with. */
    ps: (app: string, output: string, status = 0) => {
      writeFileSync(at(`ps-zekno-${app}`), output)
      writeFileSync(at(`ps-zekno-${app}.exit`), String(status))
    },
    /** Makes every `ps` hang, printing nothing, until it is stopped. */
    psHangs: () => writeFileSync(at("ps-hang"), ""),
    /** The process id of the last `ps` that hung, once it has started. */
    psPid: (): number | undefined => pidIn(at("ps.pid")),
    /**
     * What `logs` prints for an app. With `follow`, a call with `--follow`
     * then stays alive until stopped; one without ends, as Docker's does.
     * With `leaveChild`, a following call starts a process that keeps the
     * output open even after `logs` itself is stopped.
     */
    logs: (
      app: string,
      output: string,
      options: { follow?: boolean; leaveChild?: boolean } = {}
    ) => {
      writeFileSync(at(`logs-zekno-${app}`), output)
      if (options.follow) writeFileSync(at("logs-follow"), "")
      if (options.leaveChild) writeFileSync(at("logs-leave-child"), "")
    },
    /** The process id of the last `logs` that stayed alive, once it has started. */
    logsPid: (): number | undefined => pidIn(at("logs.pid")),
    /** The process id of what `logs` left behind with `leaveChild`. */
    leftChildPid: (): number | undefined => pidIn(at("logs-child.pid")),

    // Feature 015: the model of Docker the new calls are answered from.

    /**
     * Gives the app's services running containers, as `up` would leave them:
     * `count` of each, or the containers described, with Compose's labels.
     * Gives the ids made, by service.
     */
    app(
      app: string,
      services: Record<string, number | Partial<FakeContainer>[]>
    ): Record<string, string[]> {
      return changeModel(dir, (model) => {
        const made: Record<string, string[]> = {}
        for (const [service, wanted] of Object.entries(services)) {
          const list =
            typeof wanted === "number" ? Array(wanted).fill({}) : wanted
          made[service] = list.map((given: Partial<FakeContainer>, index) => {
            const container: FakeContainer = {
              id: newId(),
              name: `zekno-${app}-${service}-${index + 1}`,
              image: "example/web:1",
              labels: composeLabels(app, service),
              networkMode: `zekno-${app}_default`,
              running: true,
              restartCount: 0,
              networks: { [`zekno-${app}_default`]: { aliases: [service] } },
              mounts: [],
              ...given,
            }
            model.containers.push(container)
            return container.id
          })
        }
        return made
      })
    },
    /** Replaces a container by a new one with another id, as `up` does when a service's definition changed. */
    remake(id: string): string {
      return changeModel(dir, (model) => {
        const old = model.containers.find((c) => c.id === id)!
        const fresh: FakeContainer = {
          ...old,
          id: newId(),
          networks: { [old.networkMode]: { aliases: [] } },
        }
        model.containers = model.containers.map((c) => (c === old ? fresh : c))
        return fresh.id
      })
    },
    /** Adds a container as given, such as a proxy another server's runner made. */
    container(container: Partial<FakeContainer> & { name: string }): string {
      return changeModel(dir, (model) => {
        const made: FakeContainer = {
          id: newId(),
          image: "example/other:1",
          labels: {},
          networkMode: "bridge",
          running: true,
          restartCount: 0,
          networks: {},
          mounts: [],
          ...container,
        }
        model.containers.push(made)
        return made.id
      })
    },
    /** Changes a container of the model, found by id or name. */
    change(ref: string, change: Partial<FakeContainer>) {
      changeModel(dir, (model) => {
        const c = model.containers.find(
          (each) => each.id === ref || each.name === ref
        )!
        Object.assign(c, change)
      })
    },
    /** Adds a network, such as one of the runner's names that it did not make. */
    network(name: string, labels: Record<string, string> = {}) {
      changeModel(dir, (model) => model.networks.push({ name, labels }))
    },
    /** Removes a named volume, as `docker volume rm` would. */
    removeVolume(name: string) {
      changeModel(dir, (model) => {
        model.volumes = model.volumes.filter((each) => each !== name)
      })
    },
    /** What the next calls do (`model.ts`, `Script`), added to what was said before. */
    script(change: Script) {
      changeModel(dir, (model) => Object.assign(model.script, change))
    },
    /** The model as it is now. */
    model: (): Model => readModel(dir),
    /** The argument lists of the calls the model answered, in order, each exactly as passed. */
    argv: (): string[][] =>
      existsSync(at("argv.jsonl"))
        ? readFileSync(at("argv.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as string[])
        : [],
  }
}

export type FakeDocker = ReturnType<typeof fakeDocker>
