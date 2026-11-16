# Settings File Contract: `zekno.app.json`

User Stories 1 to 4 (FR-001 to FR-007, FR-022 to FR-024). design.md's decisions 1, 2 and 6 and the
board `SettingsFile` are binding. The reader is `apps/cli/src/settings/` (`file.ts` reads the
bytes, `json.ts` reads JSON, `schema.ts` checks the settings, `values.ts` holds each value's
rule); the writer is `settings/text.ts` and `settings/write.ts`.

## Which commands read it

`zekno deploy` (when it deploys a settings file, contracts/deploy.md), `zekno settings`,
`zekno settings set`, `zekno settings unset`, `zekno settings compose`, and the app's settings
screen and `d`. Each reads it whole, once, before it does anything with it, and stops at the first
fault, before anything is written, signed or sent (SC-005).

## Reading the file

1. **Where.** A file whose name is exactly `zekno.app.json` is a settings file; any other name is
   a Compose file (research R3). It is read from one of:
   - **this folder**: `zekno.app.json` in the folder the command runs in (or the app was started
     in), as `compose.yaml` is read today (`readInside`, `project/compose-read.ts`): found by its
     real path, which must be inside the folder (SR9); opened with
     `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; `fstat` must say a regular file (SR2), with one name on
     the disk (SR7), owned by this user (SR8); then its real path is found again and must still
     be inside the folder and be the very file read (SR6);
   - **the file `zekno.json` names**, inside that file's folder, the same way;
   - **`-f <path>`** (`zekno deploy` only), the person's path: links followed, opened with
     `O_RDONLY | O_NONBLOCK`, a regular file (SR2), as `readGiven` does.
2. **Size.** At most 65,536 bytes, checked by `fstat` and while reading from that one descriptor
   (SR3).
3. **Text.** Decoded as UTF-8 with `fatal: true` (SR4). A byte order mark (EF BB BF) at the very
   start is dropped.
4. **One read.** The bytes are read once; their SHA-256, device, inode and mode are kept for a
   later write (R5 of research.md). The text is never read again for the same command.

## The JSON it must be

RFC 8259 JSON, read by zekno's own reader (`settings/json.ts`), which knows the line of every key:

- whitespace is space, tab, line feed and carriage return; nothing else;
- no comment, no trailing comma, no single quote, no `NaN` or `Infinity`: SJ1, naming the line;
- one object at the top (SJ5);
- no object holds the same key twice, compared after the escapes are read (SJ2, naming both lines);
- objects and lists nested at most 6 deep (SJ3);
- every string, key or value, at most 4,096 characters once read (SJ4);
- a number keeps the text it was written with, for `cpus` (research R1).

## The settings

```text
{
  "zekno": 1,
  "services": {
    "<service>": {
      "source":     { "image": <image> }                              (required)
      "deploy":     { "start": <command>, "restart": <restart>,
                      "memory": <size>, "cpus": <processors> }        (each optional)
      "networking": { "port": <port>, "publish": <port> }             (each optional)
      "variables":  { "secrets": [<secret name>, ...],
                      "plain": { "<NAME>": <value>, ... } }            (each optional)
      "volumes":    { "<volume>": <mount path>, ... }                 (optional)
    }, ...
  }
}
```

A section may be left out, or be empty. The order of keys in the file does not matter; zekno
writes them in the order above (see "How zekno writes it").

### Each value

```text
service     = %x61-7A *62( %x61-7A / DIGIT / "-" )                   ; a-z first, at most 63
image       = [ host "/" ] path [ ":" tag ] [ "@sha256:" 64HEXLOWER ] ; at most 255 characters
host        = hostpart *( "." hostpart ) [ ":" 1*5DIGIT ]
hostpart    = ALNUM / ALNUM *( ALNUM / "-" ) ALNUM
path        = component *( "/" component )
component   = 1*LOWERNUM *( separator 1*LOWERNUM )
separator   = "." / "_" / "__" / 1*"-"
tag         = ( ALNUM / "_" ) *127( ALNUM / "_" / "." / "-" )
command     = see "The start command" below
restart     = "no" / "on-failure" / "always"
size        = %x31-39 *4DIGIT ( "m" / "g" )                          ; and at least 6m
processors  = ( "0" / %x31-39 *3DIGIT ) [ "." 1*2DIGIT ]              ; JSON number, > 0, <= 1024
port        = JSON integer from 1 to 65535
secret name = ( ALPHA / "_" ) *( ALPHA / DIGIT / "_" )               ; at most 128, not reserved
NAME        = as secret name, reserved names allowed                  ; a plain variable
value       = a JSON string, at most 4,096 characters, may be empty
volume      = %x61-7A *62( %x61-7A / DIGIT / "-" / "_" )
mount path  = 1*( "/" 1*( ALNUM / "." / "_" / "@" / "+" / "-" ) )     ; no "." or ".." part, at most 255
```

The host part of an image is the first part when it holds a `.` or a `:`, or is `localhost`, as
Docker reads it. Every string a setting holds is well formed and has no character of Unicode
category `Cc`, and no U+2028, U+2029, U+FEFF, U+FFFE or U+FFFF.

### The start command

```text
command = *SP word *( 1*SP word ) *SP          ; 1 to 4,096 characters, 1 to 256 words
word    = 1*( bare / single / double )
bare    = any character but SP, "'", DQUOTE, "\" and ; & | < > ( ) $ `
single  = "'" *( any character but "'" ) "'"
double  = DQUOTE *( any character but DQUOTE and "\" / "\" ( DQUOTE / "\" ) ) DQUOTE
```

The words are what runs: no shell reads them on this machine or on the server. A word's quotes
are taken off; inside single quotes everything is as written, inside double quotes `\"` and `\\`
are a quote and a backslash. To use a shell, the command starts with `sh -c` and quotes the rest:
`sh -c 'bun run migrate && bun run start'`.

| Command | Words |
|---|---|
| `bun run start` | `bun`, `run`, `start` |
| `  node   server.js  ` | `node`, `server.js` |
| `sh -c 'echo $PORT && exit 0'` | `sh`, `-c`, `echo $PORT && exit 0` |
| `node -e "console.log(\"hi\")"` | `node`, `-e`, `console.log("hi")` |
| `echo it's` | refused: a quote does not close (SV9b) |
| `npm run a && npm run b` | refused: `&` outside quotes (SV9c) |
| `echo $HOME` | refused: `$` outside quotes (SV9c) |
| (empty, or spaces only) | refused (SV9a) |

### Rules across settings

- `publish` needs `port` in the same service (SV15).
- No two services publish the same port (SV16).
- A plain variable is not also a secret of the same service (SV25).
- No two volumes of a service are mounted at the same path (SV30).
- The services read at most 256 different secret names together (SV32).
- The Compose text the settings turn into is at most 262,144 bytes (SV33).

## The order of checks

The first fault stops the command; tests name one sentence per file:

1. Reading the bytes (SR1 to SR9).
2. JSON, in the order of the text (SJ1 to SJ4); then the top is one object (SJ5).
3. `zekno` (SV1, or SL0 for a later version).
4. Every key, in the order of the text: a key this zekno does not know (SV6) or a later setting
   (SL1 to SL5), whichever comes first in the file.
5. Each value, in the order of the text (SV2 to SV31).
6. The rules across settings, in the order listed above (SV15, SV16, SV25, SV30, SV32), then the
   size of the Compose text (SV33).

## What it can never hold (FR-003, FR-005)

| Never | Because |
|---|---|
| A secret's value | `secrets` is a list of names; a value there is not a list of names (SV17, SV18) |
| A path outside the project | no setting takes a path on this machine; `build` is refused (SL1) |
| A folder of the server | a volume is a name held to its rule, written as `type: "volume"`; a path in its place is refused (SV28) |
| A command on the developer's machine | nothing in the file is run by zekno; `start` runs in the container |
| Another file | JSON has no include; `env_file`, `extends`, `include` are unknown keys (SV6) |

## How zekno writes it

`zekno settings set`, `unset`, `init` and the screen write the whole file in one form
(`settingsText`, research R5): JSON with two spaces of indent; keys in the order of "The
settings" above; services, plain variables and volumes in the file's order; a section, a list or
an object with nothing in it left out; an object or a list on one line when that line, with its
indent, its key and a comma after it, is at most 80 characters, except the file, `services` and
each service, which always open on their own line; one line feed at the end. For the design's
example this is byte for byte the text in design.md. A file written by hand in another layout
gets this layout the first time zekno changes it; nothing in its meaning changes.

## Sentences

`<file>` is the file as a sentence names it: relative to the folder the command runs in when the
file is inside it, else its path, cleaned (`shownFile`, `commands/deploy.ts`). `<svc>` is a
service's name, `<NAME>` a variable's, `<vol>` a volume's, each shown only after it passed its
rule. `<n>` and `<m>` are line numbers. In the tables, `\|` is the character `|`.

### Reading (status 1)

| Id | Sentence |
|----|----------|
| SR1 | `No settings file at <file>.` (`-f`); `<zekno.json> names zekno.app.json, and there is no such file in <folder>.` (named by a link) |
| SR2 | `<file> is not a file.` |
| SR3 | `<file> is larger than the 64 KiB a settings file may be.` |
| SR4 | `<file> is not UTF-8 text.` |
| SR5 | `<file> could not be read.` |
| SR6 | `<file> was changed while zekno read it. Try again.` |
| SR7 | `<file> has more than one name on this disk (a hard link), so zekno cannot tell that it stays inside its folder.` |
| SR8 | `<file> belongs to another user, so zekno does not use it.` |
| SR9 | `<file> leads outside the folder that holds it. zekno does not follow it there.` |

### Not in the right form (status 1)

Every one is said as `<file> could not be read as settings.` followed by `<place>: <rule>` (design,
"Not in the right form"). At a terminal the first sentence is bold and the rest dim on the next
line, set in by two columns (`ErrorLine`); in plain output it is one line on standard error.

| Id | Place and rule |
|----|----------------|
| SJ1 | `line <n>: this is not JSON.` |
| SJ2 | `line <m>: the same name as line <n>.` |
| SJ3 | `line <n>: nested deeper than settings go.` |
| SJ4 | `line <n>: a text longer than 4096 characters.` |
| SJ5 | `line 1: settings are one JSON object.` |
| SV1 | `zekno: use 1, the version of settings this zekno reads.` |
| SV2 | `services: name at least one service, such as "web".` |
| SV3 | `services: at most 32 services.` |
| SV4 | `services: a service name is lowercase letters, digits and hyphens, and starts with a letter (line <n>).` |
| SV5 | `<svc>: use an object of sections.` / `<svc>, <section>: use an object.` |
| SV6 | `<svc>, <section>: a setting this zekno does not know (line <n>).` (design); `<svc>: a setting this zekno does not know (line <n>).`; at the top, `A setting this zekno does not know (line <n>).` |
| SV7 | `<svc>, source.image: a service needs an image, such as ghcr.io/acme/web:1.4.2.` |
| SV8 | `<svc>, source.image: use an image reference, such as ghcr.io/acme/web:1.4.2.` |
| SV9 | `<svc>, deploy.start:` then (a) `use a command, or leave start out to run the image's own.` (b) `a quote does not close.` (c) `it runs without a shell, so put ; & \| < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.` (d) `use at most 4096 characters and 256 words.` (e) `use one line with no control character.` (f) `use a command in quotes, such as "bun run start".` |
| SV10 | `<svc>, deploy.restart: use no, on-failure or always.` |
| SV11 | `<svc>, deploy.memory: use a size such as 512m or 1g.` (design) |
| SV12 | `<svc>, deploy.cpus: use a number of processors, such as 0.5 or 2.` |
| SV13 | `<svc>, networking.port: use a port from 1 to 65535.` |
| SV14 | `<svc>, networking.publish: use a port from 1 to 65535.` |
| SV15 | `<svc>, networking.publish: set networking.port too, the port it reaches.` |
| SV16 | `<svc>, networking.publish: <other svc> publishes the same port.` |
| SV17 | `<svc>, variables.secrets: use a list of names, such as ["DATABASE_URL"].` |
| SV18 | `<svc>, variables.secrets: a secret name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line <n>).` |
| SV19 | `<svc>, variables.secrets: <NAME> is a name zekno keeps for itself.` |
| SV20 | `<svc>, variables.secrets: a name is there twice (line <n>).` |
| SV21 | `<svc>, variables.secrets: at most 256 names.` |
| SV22 | `<svc>, variables.plain: use an object of names and values, such as { "NODE_ENV": "production" }.` |
| SV23 | `<svc>, variables.plain: a variable name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line <n>).` |
| SV24 | `<svc>, variables.plain.<NAME>: use a value in quotes, one line with no control character, at most 4096 characters.` |
| SV25 | `<svc>, variables.plain.<NAME>: it is a secret of <svc> too. Keep it in one place.` |
| SV26 | `<svc>, variables.plain: at most 128 variables.` |
| SV27 | `<svc>, volumes: use an object of volume names and mount paths, such as { "data": "/data" }.` |
| SV28 | `<svc>, volumes: a volume name is lowercase letters, digits, hyphens and underscores, and starts with a letter (line <n>).` |
| SV29 | `<svc>, volumes.<vol>: use an absolute path in the container, such as /data. A folder of the server cannot be mounted from settings.` |
| SV30 | `<svc>, volumes: two volumes are mounted at the same path.` |
| SV31 | `<svc>, volumes: at most 16 volumes.` |
| SV32 | `services: they read more than 256 secrets, more than one deploy carries.` |
| SV33 | `services: they turn into Compose text larger than the 256 KiB a deploy carries.` |

### A later setting (status 1)

Said as two sentences, the first bold at a terminal (design, "A later setting"; board
`SettingsDeploy`):

| Id | First | Second |
|----|-------|--------|
| SL0 | `<file> is written for a later version of zekno.` | `Update zekno to use it.` |
| SL1 | `<file> sets a build for <svc>.` | `Building from source is not in this version of zekno yet.` |
| SL2 | `<file> sets a pre-deploy command for <svc>.` | `A pre-deploy command is not in this version of zekno yet.` |
| SL3 | `<file> sets a health check for <svc>.` | `Health checks are not in this version of zekno yet.` |
| SL4 | `<file> sets replicas for <svc>.` | `Several copies of a service are not in this version of zekno yet.` |
| SL5 | `<file> sets a domain for <svc>.` (design) | `Domains are not in this version of zekno yet.` (design) |

### What the sentences never hold

A value from the file, a key the reader does not know, a name that did not pass its rule, or any
piece of a line. The tests put the marker `zk_SENTINEL_7c1e` in the wrong place of every faulty
file (a value, an unknown key, a bad name, a comment) and look for it in standard output,
standard error, the error's message and stack, and every frame Ink draws (SC-004, SC-005).
