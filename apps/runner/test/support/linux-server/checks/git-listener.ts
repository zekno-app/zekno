/**
 * A listener in the Linux stand-in that writes down the HTTP requests it
 * gets, for check L14 (specs/016-build-from-source, T018; FR-037b): a build
 * that holds a secret named `GIT_AUTH_TOKEN` and `ADD`s a git address on
 * 127.0.0.1 shows whether the builder sends that secret when it fetches.
 * A few lines of Perl (Ubuntu's `perl-base`, in every Ubuntu image), on
 * 127.0.0.1 only, that log each request's line and headers to a file in
 * the check's folder and answer 404. The check reads the log and says only
 * whether a request carried the value, never the value. Every command runs
 * in the stand-in, through `gate.ts`.
 */
import { firstLine } from "../host/host-lists"
import type { InStandIn } from "../build-runs/rb7"
import { q } from "../stand-in/shell"

/** The listener's port: neither 3000 nor 3100, nor the registry's 5000. */
export const LISTENER_PORT = 9480

/** Logs each request's line and headers, then `--`, and answers 404. */
export const LISTENER_PERL = [
  "use strict;",
  "use warnings;",
  "use IO::Socket::INET;",
  "my ($port, $log) = @ARGV;",
  'my $server = IO::Socket::INET->new(LocalAddr => "127.0.0.1", LocalPort => $port, Proto => "tcp", Listen => 8, ReuseAddr => 1) or die "listen: $!\\n";',
  'open(my $out, ">>", $log) or die "log: $!\\n";',
  "$out->autoflush(1);",
  "while (my $client = $server->accept) {",
  "  while (defined(my $line = <$client>)) {",
  "    $line =~ s/\\r?\\n\\z//;",
  '    last if $line eq "";',
  '    print $out "$line\\n";',
  "  }",
  '  print $out "--\\n";',
  '  print $client "HTTP/1.1 404 Not Found\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n";',
  "  close($client);",
  "}",
].join("\n")

const FOLDER = /^\/tmp\/zekno-check-[a-z0-9-]+(?:\/[a-z0-9-]+)*$/

export function listenerFiles(folder: string) {
  if (!FOLDER.test(folder))
    throw new Error(`${JSON.stringify(folder)} is not a folder of a check`)
  return {
    log: `${folder}/requests.log`,
    errors: `${folder}/listener.err`,
    pid: `${folder}/listener.pid`,
  }
}

/** Starts the listener, waits until it answers, and empties its log of that first request. */
export function startListenerScript(folder: string, port: number): string {
  const files = listenerFiles(folder)
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 3100, 5000].includes(port)
  )
    throw new Error(`${port} is not a port the listener may take`)
  return [
    "set -eu",
    `mkdir -p ${folder}`,
    `: > ${files.log}`,
    `setsid perl -e ${q(LISTENER_PERL)} ${port} ${files.log} > ${files.errors} 2>&1 < /dev/null &`,
    `echo "$!" > ${files.pid}`,
    "i=0",
    "while :; do",
    `  code=$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:${port}/zekno-check-ready || :)`,
    '  if [ "$code" = 404 ]; then break; fi',
    `  if ! kill -0 "$(cat ${files.pid})" 2> /dev/null; then echo "the listener stopped: $(head -c 300 ${files.errors})" >&2; exit 1; fi`,
    "  i=$((i + 1))",
    '  if [ "$i" -gt 20 ]; then echo "the listener did not answer within 20 seconds" >&2; exit 1; fi',
    "  sleep 1",
    "done",
    `: > ${files.log}`,
  ].join("\n")
}

/** Stops the listener its pid file names, if that process is perl, and removes the pid file. */
export function stopListenerScript(folder: string): string {
  const files = listenerFiles(folder)
  return [
    "set -eu",
    `if [ -f ${files.pid} ]; then`,
    `  pid=$(cat ${files.pid})`,
    '  if [ "$(cat "/proc/$pid/comm" 2> /dev/null || :)" = perl ]; then kill "$pid" 2> /dev/null || :; fi',
    `  rm -f ${files.pid}`,
    "fi",
  ].join("\n")
}

/** The request lines the log holds, `GET /x.git/info/refs?... HTTP/1.1`. */
export function requestLinesOf(log: string): string[] {
  return log
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z]+ \S+ HTTP\/[0-9.]+$/.test(line))
}

/** Whether a request carried `value`: as it is, or in a base64 credential of an Authorization header. */
export function carriesValue(log: string, value: string): boolean {
  if (value === "") throw new Error("a value is looked for")
  if (log.includes(value)) return true
  for (const line of log.split("\n")) {
    const found = /^authorization:\s*\S+\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(
      line.trim()
    )
    if (found === null) continue
    const decoded = Buffer.from(found[1]!, "base64").toString("utf8")
    if (decoded.includes(value)) return true
  }
  return false
}

/** For the record line: the requests, and whether any carried the value; never the value. */
export function listenerWords(log: string | undefined, value: string): string {
  if (log === undefined) return "the listener's log could not be read"
  const requests = requestLinesOf(log)
  if (requests.length === 0) return "the listener got no request"
  const shown = requests.slice(0, 3).join(", ")
  const more = requests.length > 3 ? ` and ${requests.length - 3} more` : ""
  const carried = carriesValue(log, value)
    ? "the value reached it as a credential"
    : "none carried the value"
  return `the listener got ${requests.length} (${shown}${more}); ${carried}`
}

/** Starts the listener in the stand-in. */
export async function startListener(
  run: InStandIn,
  folder: string,
  port: number = LISTENER_PORT
): Promise<void> {
  const answer = await run(["sh", "-c", startListenerScript(folder, port)], {
    timeoutMs: 60_000,
  })
  if (answer.code !== 0)
    throw new Error(
      `starting the listener failed (exit ${answer.code}): ${firstLine(answer)}`
    )
}

/** Stops the listener in the stand-in. */
export async function stopListener(
  run: InStandIn,
  folder: string
): Promise<void> {
  const answer = await run(["sh", "-c", stopListenerScript(folder)])
  if (answer.code !== 0)
    throw new Error(
      `stopping the listener failed (exit ${answer.code}): ${firstLine(answer)}`
    )
}
