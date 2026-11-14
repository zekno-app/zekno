/**
 * What this machine shows of a destination right now: the processes whose
 * command line names it, and the sockets open to it. Read with `ps` and
 * `netstat`, started with a fixed small environment, never this process's.
 */
const TOOLS_ENV = { PATH: "/bin:/usr/bin:/usr/sbin:/sbin", LC_ALL: "C" }

async function output(argv: string[]): Promise<string[]> {
  const child = Bun.spawn(argv, { env: TOOLS_ENV, stdout: "pipe", stderr: "ignore", stdin: "ignore" })
  const text = await new Response(child.stdout).text()
  await child.exited
  return text.split("\n")
}

export type Sighting = { sshProcesses: string[]; sockets: string[] }

/** Every `ssh` process whose arguments name `host`, and every socket line that names it. */
export async function sightings(host: string): Promise<Sighting> {
  const [processes, sockets] = await Promise.all([output(["ps", "-axo", "command="]), output(["netstat", "-an"])])
  return {
    sshProcesses: processes.filter((line) => /(^|\/)ssh(\s|$)/.test(line.trim().split(/\s+/)[0] ?? "") && line.includes(host)),
    sockets: sockets.filter((line) => line.includes(host)),
  }
}
