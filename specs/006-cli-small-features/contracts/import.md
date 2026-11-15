# Import Contract: `zekno secret import <file>`

User Story 3 (FR-015 to FR-021). Mock-up 4 in [design.md](../design.md) is binding. The reader is
`apps/cli/src/secrets/import-file.ts`; storing is `prepareSecretImport` and `storeSecrets` in
`apps/cli/src/ops/secret.ts`; the command is `secretImport` in `apps/cli/src/commands/secret.ts`.

## Usage

```text
zekno secret import <file> [--app <app>] [--server <name>] [--yes]
```

`<file>` is the path the person typed, resolved from the current folder; it need not be inside the
project folder. `--app` and `--server` as the other secret commands, from `zekno.json` when it is
signed by the team and used here, and asked for at a terminal when still missing
([questions.md](./questions.md)). `--yes` answers the one question in advance, at a terminal and
in a script.

## Reading the file

1. Opened once with `O_RDONLY | O_NONBLOCK`, links followed (as `-f`). `fstat` must say a regular
   file. At most 1,048,576 bytes (1 MiB), checked by `fstat` and while reading.
2. Decoded as UTF-8 with `fatal: true`. A byte order mark (EF BB BF) at the very start is dropped.
3. Split into lines at LF. A CR right before an LF is dropped. A last line without an LF counts.
   Lines are numbered from 1.
4. Each line is read with the grammar below. The first line that does not fit stops the import:
   nothing is stored, and the message names the file and the line's number, never its content.
5. The text and the values are held in memory for the run only. Nothing is written but sealed
   records.

## The grammar

```text
file      = *( line EOL ) [ line ]           ; EOL is LF, or CR LF
line      = blank / comment / entry
blank     = *WS
comment   = *WS "#" *CHAR
entry     = *WS [ "export" 1*WS ] key *WS "=" *WS [ value ] *WS [ tail ]
tail      = "#" *CHAR                          ; only after at least one WS, or right after a closing quote
key       = 1*( ALPHA / DIGIT / "_" / "." / "-" )
value     = unquoted / single / double
unquoted  = ufirst *( *WS uchar )              ; inner WS kept, leading and trailing WS dropped
ufirst    = any uchar except "="
uchar     = any CHAR except WS, '"', "'", "`", "\", "$", "#"
single    = "'" *schar "'"                     ; taken exactly as written
schar     = any CHAR except "'"
double    = DQUOTE *( dchar / escape ) DQUOTE
dchar     = any CHAR except DQUOTE, "\", "$"
escape    = "\" ( "\" / DQUOTE / "n" / "r" / "t" / "$" )
WS        = SP / HTAB
CHAR      = any character but a control character (U+0000 to U+001F, U+007F to U+009F), HTAB allowed
```

What each case means:

| Case | Reading |
|------|---------|
| `NAME=value` | `value` |
| `export NAME=value` | `value` (`export` and at least one space or tab, then the name) |
| `  NAME = value  ` | `value`: spaces and tabs around the name, the `=` and the value are dropped |
| `NAME=two words` | `two words`: spaces inside an unquoted value are kept |
| `NAME=` , `NAME=""`, `NAME=''` | an empty value: left out, `empty` |
| `NAME='a "b" $c #d'` | `a "b" $c #d`: nothing inside single quotes means anything |
| `NAME="a\nb"` | `a`, a line break, `b`. `\\` `\"` `\n` `\r` `\t` `\$` are the only escapes |
| `NAME=value # note`, `NAME="v" # note`, `NAME="v"# note` | `value`, `v`, `v`: a comment after a space or a tab, or right after the closing quote |
| `# a comment`, an empty line, a line of spaces | nothing |
| `NAME=va#lue` | stops: `#` inside an unquoted value (I7) |
| `NAME=$OTHER`, `NAME=${OTHER}`, `NAME="a$b"` | stops: `$` outside single quotes (I6) |
| `NAME="abc` (no closing quote on the line), a value that would span lines | stops (I3) |
| `NAME="a\qb"` | stops: an escape that is not one of the six (I5) |
| `NAME="v" x` | stops: text after the closing quote that is not a comment (I4) |
| `` NAME=`cmd` `` , `NAME=a"b` , `NAME=a\b` | stops: a quote, a backquote or a backslash inside an unquoted value (I2) |
| `NAME==x`, `NAME==`, `QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo1Ng==` | stops: an unquoted value that begins with `=` (I2). It is how the last piece of a value wrapped onto its own line looks, such as base64 ending in `==`, so it is never read as a name and a value (security review S1). `NAME=a=b` is `a=b` |
| A control character anywhere but a tab | stops (I8) |
| `NAME value`, `=value`, `my var=x`, `{`, anything else | stops: not a `NAME=value` line (I2) |
| The same key twice (exactly, letter case counts) | stops, naming both lines (I9) |
| `NAME=#x` | stops (I7): a `#` where the value would start, with no space before it |

**Which sentence a line that does not fit gets.** The first of these that applies, in this order,
so the tests can name one sentence per line:

1. A control character other than a tab anywhere in the line: I8.
2. After the spaces and an optional `export` and its spaces, no key followed by spaces and `=`: I2.
3. After `=` and its spaces, a value that starts with `'`: no closing `'` on the line, I3; after the
   closing `'`, anything but spaces and tabs, then the end or a `#`, I4.
4. A value that starts with `"`: reading it, a `\` followed by anything but `\ " n r t $`, I5; a `$`
   not after `\`, I6; no closing `"` on the line, I3; after the closing `"`, as in 3, I4.
5. Any other value: one that begins with `=`, I2; then, read one character at a time: `$`, I6; `#`
   with no space or tab right before it, I7; `"`, `'`, a backquote or `\`, I2.
6. A line that fits, whose key was already the key of line `<n>`: I9.

## Names

After the whole file is read without a stop, each entry's key is judged:

| Key | Group | Shown as |
|-----|-------|----------|
| fits `SECRET_NAME` (`^[A-Za-z_][A-Za-z0-9_]*$`), at most 128 characters, not reserved, value not empty and at most 64 KiB as UTF-8 | `new` when the app has no current secret of that name; `replaces` when it has | the key |
| reserved (`isReservedSecretName`: PATH, HOME, DOCKER_*, COMPOSE_*, ...) | left out | ``<key> (zekno keeps this name)`` |
| does not fit `SECRET_NAME`, at most 128 characters | left out | ``line <n> (not a valid name)`` |
| longer than 128 characters | left out | ``line <n> (a name longer than 128 characters)`` |
| value empty | left out | ``line <n> (empty)`` |
| value larger than 64 KiB | left out | ``line <n> (larger than 64 KiB)`` |

Only a reserved key is shown: it is a name zekno keeps for itself, not a piece of a value. Every
other key left out is shown by its line's number only, never as written: a key that does not fit,
or whose value is empty or too large, may be the last piece of a value wrapped onto its own line
(security review S1). A key that is shown has only `[A-Za-z0-9_.-]`, so it cannot carry a control
character. The order of names in each group is the file's.

## Limits, before anything is sealed

Each stops the import with "Nothing was stored." (I12 to I14): more than 256 values to store; the
app's current secrets together with the new names more than 256 (the most one deploy carries); the
app's records and removals on this machine plus the new records more than 4096.

## At a terminal

```text
$ zekno secret import .env
  .env, for demo on prod

  new         DATABASE_URL, SESSION_KEY, STRIPE_KEY
  replaces    API_URL
  left out    PATH (zekno keeps this name), line 7 (not a valid name)

? Store 4 values? Values are never shown. (y/N)
✔ Stored 4 values for demo on prod. They take effect on the next deploy.
  .env still holds them in plain text. Delete it, or keep it out of git.
```

The `.env` of this example (and of the tests and the walkthrough) has a comment on line 1, then
`DATABASE_URL`, `SESSION_KEY`, `STRIPE_KEY`, `API_URL`, `PATH` and `my-var` on lines 2 to 7, so
`my-var` is named `line 7`.

- `note(I1)` (dim, set in by two columns, as the board "zekno secret import" draws it), `gap()`,
  then `groups(...)`: two spaces, the label padded to 12 columns, then the names joined with `, `,
  wrapping in their own column (from column 14). A group with no name has no line. `gap()`.
- `confirm(I15, I16)` unless `--yes`. "No" (`n`, Enter, Esc, Ctrl-C): `Nothing was done.`, status
  1, nothing stored.
- Stored: `success(I17)`, its first sentence bold (`Stored 4 values for demo on prod.`), then
  `note(I18)` (dim, set in by two columns), as the board "zekno secret import" draws them.
- No name to store (every name left out): the summary, then I11, status 1, no question.

## With no terminal

Plain lines on standard output, the same words, no symbols, no empty lines:

```text
.env, for demo on prod
new	DATABASE_URL, SESSION_KEY, STRIPE_KEY
replaces	API_URL
left out	PATH (zekno keeps this name), line 7 (not a valid name)
Stored 4 values for demo on prod. They take effect on the next deploy.
.env still holds them in plain text. Delete it, or keep it out of git.
```

Without `--yes`: the summary lines, then I16 on standard error, status 1, nothing stored.

## Order of checks

1. The file argument (I10, status 2), before anything else.
2. The file is read and parsed whole (I2 to I9, I19 to I22, status 1).
3. The app and server: from flags and zekno.json as every secret command; with no terminal a
   missing one is today's `MISSING_SERVER` or `MISSING_APP` (status 2); at a terminal it is asked.
4. The team is verified, the server found, the app name checked (as `secret set`).
5. The groups and the limits; the summary is shown.
6. The question, or `--yes`, or the refusal.
7. One sealing and one write (research R9).

## Sentences

`<file>` is the path as typed, cleaned (`sanitize`). `<n>` and `<m>` are line numbers.

| Id | Sentence | Status |
|----|----------|--------|
| I1 | `<file>, for <app> on <server>` | mock-up |
| I2 | `<file>, line <n>: this is not a NAME=value line. Nothing was stored.` | needs approval |
| I3 | `<file>, line <n>: a quoted value does not end on this line. Write a line break as \n inside double quotes. Nothing was stored.` | needs approval |
| I4 | `<file>, line <n>: there is text after the closing quote. Nothing was stored.` | needs approval |
| I5 | `<file>, line <n>: an escape zekno does not read. Inside double quotes only \\ \" \n \r \t and \$ are read. Nothing was stored.` | needs approval |
| I6 | `<file>, line <n>: a $ that zekno would not expand. Put the value in single quotes to keep it as it is. Nothing was stored.` | needs approval |
| I7 | `<file>, line <n>: a # inside a value. Quote the value to keep it, or put a space before # to start a comment. Nothing was stored.` | needs approval |
| I8 | `<file>, line <n>: a control character. Nothing was stored.` | needs approval |
| I9 | `<file>, line <m>: the same name as line <n>. Nothing was stored.` | needs approval |
| I10 | ``Say which file: `zekno secret import <file>`.`` (a usage error: status 2 and the help line) | needs approval |
| I11 | `No value in <file> can be stored, so nothing was stored.` | needs approval |
| I12 | `<file> has more than 256 values, more than one deploy carries. Nothing was stored.` | needs approval |
| I13 | `<app> on <server> would have more than 256 secrets, more than one deploy carries. Nothing was stored.` | needs approval |
| I14 | `<app> on <server> would have more than 4096 secret records on this machine. Nothing was stored.` | needs approval |
| I15 | `Store 1 value? Values are never shown.` / `Store <k> values? Values are never shown.` | mock-up (the second) |
| I16 | ``There is no terminal to ask on. Add `--yes` to store the values from <file>.`` | needs approval |
| I17 | `Stored 1 value for <app> on <server>. It takes effect on the next deploy.` / `Stored <k> values for <app> on <server>. They take effect on the next deploy.` | mock-up (the second) |
| I18 | `<file> still holds them in plain text. Delete it, or keep it out of git.` (with one value: `still holds it`) | mock-up |
| I19 | `No file at <file>.` | needs approval |
| I20 | `<file> is not a file.` / `<file> could not be read.` | needs approval |
| I21 | `<file> is larger than the 1 MiB an import file may be. Nothing was stored.` | needs approval |
| I22 | `<file> is not UTF-8 text. Nothing was stored.` | needs approval |

The group labels are `new`, `replaces`, `left out` (mock-up).

## Exit statuses

| Status | When |
|--------|------|
| 0 | stored |
| 1 | the file cannot be read or does not fit the grammar; no name to store; a limit; "no" or leaving; no terminal without `--yes`; any failure of the team, the server, sealing or writing |
| 2 | no file argument; anything after `<file>`; with no terminal a missing `--app` or `--server`, or a `zekno.json` not signed by the team or not used here (as every command) |

## What never holds a value

A value read from the file is never put in an argument, a message, an error (its message or its
stack), a log, a line drawn or printed, or a file other than the sealed record. The reader's
errors carry a line number and a fixed reason only, and the reader catches every exception it could
raise itself and turns it into one of I2 to I8 and I19 to I22 (FR-021). The import file itself is
never changed, copied or deleted; I18 reminds the person it is still there.
