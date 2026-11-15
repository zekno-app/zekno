/**
 * The installer's script: the fixed text `runInstaller` (install.ts) sends to
 * a server on standard input, held to the rules at the top of install.ts. Its
 * length and SHA-256 are pinned by a test (test/server/install/script.test.ts),
 * which also reads it from this file's own text.
 */
/**
 * The script. It is one `{ ... }` block, so the shell has read all of it
 * before it runs any of it: whatever is sent after the script (the runner
 * file, or the requests of the session the script hands over to) is read
 * by the commands meant for it, never by the shell as more script. That
 * holds for shells that read their input ahead, such as dash.
 *
 * Its arguments, as `installWords` builds them:
 *   add <version> release [<arch> <sha256>]...
 *   add <version> file <sha256>
 *   update <version> <runner path> release [<arch> <sha256>]...
 *
 * It never uses `sudo`, never runs a downloaded file before its checksum
 * matched, and works in a private temporary folder that is removed on exit.
 * A runner is put in place only after it answered with its version from that
 * folder, so one that cannot run on this server never replaces one that can.
 * An update replaces only a file named `zekno-runner`, and never a runner
 * newer than the one it carries.
 *
 * What the server lacks is said before anything is downloaded or created
 * (`old_libc`): `getconf GNU_LIBC_VERSION` naming glibc below 2.17, or, when
 * it names none, `ldd --version` naming musl. What those print is the
 * server's text: its first line, cut to 64 characters, is only matched
 * against a strict shape (`glibc <x>.<y>`, numbers as the version's), never
 * run, never a path or a command, and anything of another shape is no
 * answer. Then the runner's own answer after the checksum decides
 * (`not_started`): exit status 127 or `GLIBC_` in what it wrote is the C
 * library, 132 an instruction the processor lacks, anything else `version`;
 * the first line it wrote, cut to 200 characters, is passed on on standard
 * error, which the CLI cleans as all of it.
 * Written with no `${` and no backquote, so the template below cannot
 * interpolate anything.
 *
 * It sets the C locale first, and exports it, whatever locale SSH passed on:
 * in a UTF-8 locale bash 4.2's `[0-9]` also matched digits of other scripts,
 * so `is_version` took versions JavaScript refuses (specs/005-runner-release/
 * security-review.md, RV8), and `expr` and `sed` read characters there
 * rather than bytes.
 */
export const INSTALL_SCRIPT = String.raw`{
set -eu
LC_ALL=C
export LC_ALL
umask 077
say() { printf '%s\n' "$*"; }
fail() { say "fail $1"; exit 1; }
tmp=
cleanup() { if [ -n "$tmp" ]; then rm -rf "$tmp"; tmp=; fi; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

say connected

is_count() {
  case $1 in ''|0*|*[!0-9]*) return 1 ;; esac
  [ "$(expr "x$1" : '.*')" -le 10 ]
}
is_number() {
  [ "$1" = 0 ] || is_count "$1"
}
is_version() {
  case $1 in ''|*[!0-9.dev-]*) return 1 ;; esac
  core=$(printf '%s' "$1" | cut -d - -f 1)
  case $1 in
    "$core") ;;
    "$core-dev."*) is_count "$(printf '%s' "$1" | cut -d - -f 2- | cut -c 5-)" || return 1 ;;
    *) return 1 ;;
  esac
  case $core in *[!0-9.]*|*.*.*.*) return 1 ;; *.*.*) ;; *) return 1 ;; esac
  is_number "$(printf '%s' "$core" | cut -d . -f 1)" &&
    is_number "$(printf '%s' "$core" | cut -d . -f 2)" &&
    is_number "$(printf '%s' "$core" | cut -d . -f 3)"
}
is_sha() {
  case $1 in ''|*[!0-9a-f]*) return 1 ;; esac
  [ "$(expr "x$1" : '.*')" -eq 65 ]
}
is_path() {
  case $1 in ''|-*) return 1 ;; esac
  return 0
}
is_newer() {
  for part in 1 2 3; do
    ours=$(printf '%s' "$2" | cut -d - -f 1 | cut -d . -f "$part")
    theirs=$(printf '%s' "$1" | cut -d - -f 1 | cut -d . -f "$part")
    if [ "$theirs" -gt "$ours" ]; then return 0; fi
    if [ "$theirs" -lt "$ours" ]; then return 1; fi
  done
  ours=
  theirs=
  case $2 in *-*) ours=$(printf '%s' "$2" | cut -d . -f 4) ;; esac
  case $1 in *-*) theirs=$(printf '%s' "$1" | cut -d . -f 4) ;; esac
  if [ -z "$theirs" ]; then [ -n "$ours" ]; return; fi
  [ -n "$ours" ] && [ "$theirs" -gt "$ours" ]
}
pick() {
  want=$1
  shift
  while [ "$#" -ge 2 ]; do
    if [ "$1" = "$want" ]; then printf '%s' "$2"; return 0; fi
    shift 2
  done
  return 1
}
old_libc() {
  if command -v getconf >/dev/null 2>&1; then
    libc=$(getconf GNU_LIBC_VERSION </dev/null 2>/dev/null | head -n 1 | cut -c 1-64) || libc=
    case $libc in
      'glibc '*)
        libc=$(printf '%s' "$libc" | cut -c 7-)
        case $libc in *[!0-9.]*|*.*.*) return 1 ;; ?*.?*) ;; *) return 1 ;; esac
        major=$(printf '%s' "$libc" | cut -d . -f 1)
        minor=$(printf '%s' "$libc" | cut -d . -f 2)
        is_number "$major" && is_number "$minor" || return 1
        [ "$major" -lt 2 ] && return 0
        [ "$major" -eq 2 ] && [ "$minor" -lt 17 ] && return 0
        return 1 ;;
    esac
  fi
  command -v ldd >/dev/null 2>&1 || return 1
  libc=$(ldd --version </dev/null 2>&1 | head -n 1 | cut -c 1-64) || libc=
  case $libc in 'musl libc'*) return 0 ;; esac
  return 1
}
not_started() {
  said=$(head -n 1 "$tmp/err" | cut -c 1-200) || said=
  if [ -n "$said" ]; then printf '%s\n' "$said" >&2; fi
  rm -f "$tmp/zekno-runner"
  case $1 in 127) fail libc ;; 132) fail cpu ;; esac
  case $(head -c 4096 "$tmp/err" | tr '\n' ' ') in *GLIBC_*) fail libc ;; esac
  fail version
}
lost() {
  if command -v df >/dev/null 2>&1; then
    free=$(df -Pk "$dir" </dev/null 2>/dev/null | tail -n 1 | tr -s ' ' | cut -d ' ' -f 4) || free=
    case $free in ''|*[!0-9]*) ;; *) if [ "$free" -lt 262144 ] 2>/dev/null; then fail space; fi ;; esac
  fi
  fail download
}
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl --proto =https --proto-redir =https --tlsv1.2 -fsSL --max-filesize 268435456 -o "$2" "$1" </dev/null >&2
    return
  fi
  command -v wget >/dev/null 2>&1 || return 1
  next=$1
  hops=0
  while :; do
    case $next in https://*) ;; *) return 1 ;; esac
    if wget -q -S --max-redirect=0 -O "$2" "$next" </dev/null 2>"$tmp/headers"; then return 0; fi
    hops=$((hops + 1))
    [ "$hops" -le 5 ] || return 1
    next=$(sed -n 's/^ *[Ll]ocation: *\([^ ]*\).*$/\1/p' "$tmp/headers" | tail -n 1 | tr -d '\r')
    [ -n "$next" ] || return 1
  done
}

[ "$#" -ge 3 ] || fail usage
mode=$1
version=$2
shift 2
is_version "$version" || fail usage
target=
case $mode in
  add) ;;
  update)
    target=$1
    shift
    is_path "$target" || fail usage
    case $target in zekno-runner|*/zekno-runner) ;; *) fail name ;; esac ;;
  *) fail usage ;;
esac
[ "$#" -ge 1 ] || fail usage
source=$1
shift
expected=
case $source in
  file)
    [ "$mode" = add ] && [ "$#" -eq 1 ] && is_sha "$1" || fail usage
    expected=$1 ;;
  release)
    arch_next=1
    for word in "$@"; do
      if [ "$arch_next" = 1 ]; then
        case $word in x64|arm64) ;; *) fail usage ;; esac
        arch_next=0
      else
        is_sha "$word" || fail usage
        arch_next=1
      fi
    done
    [ "$arch_next" = 1 ] || fail usage ;;
  *) fail usage ;;
esac

command -v docker >/dev/null 2>&1 || fail docker
docker compose version </dev/null >/dev/null 2>&1 || fail docker
compose=$(docker compose version --short </dev/null 2>/dev/null | head -n 1 | cut -c 1-32) || compose=
case $compose in ''|*[!0-9A-Za-z.+-]*) compose=unknown ;; esac
say "docker ok $compose"

set +u
home=$HOME
set -u
if [ "$(id -u)" = 0 ]; then
  bin=/usr/local/bin
  folder=/var/lib/zekno
  mine=system
else
  case $home in /*) ;; *) fail home ;; esac
  bin=$home/.local/bin
  folder=$home/.local/state/zekno
  mine=user
fi

runner=
where=
if [ "$mode" = update ]; then
  case $target in
    '~/'*) runner=$home/$(printf '%s' "$target" | cut -c 3-) ;;
    */*) runner=$target ;;
    *) runner=$(command -v "$target" 2>/dev/null) || runner= ;;
  esac
  case $runner in */*) ;; *) runner= ;; esac
  [ -n "$runner" ] && [ -f "$runner" ] && [ -x "$runner" ] || fail missing
  where=target
elif [ -f "$bin/zekno-runner" ] && [ -x "$bin/zekno-runner" ]; then
  runner=$bin/zekno-runner
  where=$mine
elif found=$(command -v zekno-runner 2>/dev/null); then
  case $found in /*) runner=$found; where=path ;; esac
fi

found=none
if [ -n "$runner" ]; then
  answer=$("$runner" version </dev/null 2>/dev/null | head -n 1 | cut -c 1-200) || answer=
  found=$(printf '%s\n' "$answer" | sed -n 's/^{"version":"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\(-dev\.[0-9][0-9]*\)\{0,1\}\)",.*$/\1/p')
  is_version "$found" || found=unknown
  say "runner found $where $found"
else
  say "runner none"
fi
if [ "$mode" = update ] && [ "$found" != unknown ] && is_newer "$found" "$version"; then fail newer; fi

install=yes
if [ -n "$runner" ]; then
  if [ "$mode" = add ] || [ "$found" = "$version" ]; then install=no; fi
fi
if [ "$mode" = add ]; then
  dest=$bin/zekno-runner
  [ -n "$runner" ] || where=$mine
else
  dest=$runner
fi
final=$runner

if [ "$install" = yes ]; then
  platform=$(uname -sm 2>/dev/null) || platform=
  case $platform in
    'Linux x86_64'|'Linux amd64') arch=x64 ;;
    'Linux aarch64'|'Linux arm64') arch=arm64 ;;
    *) fail platform ;;
  esac
  say "platform ok $arch"
  if old_libc; then fail libc; fi
  if [ "$source" = release ]; then expected=$(pick "$arch" "$@") || fail release; fi
  if command -v sha256sum >/dev/null 2>&1; then
    hasher=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    hasher=shasum
  else
    fail tools
  fi
  dir=$(dirname "$dest")
  mkdir -p "$dir" || fail install
  [ ! -d "$dest" ] || fail install
  tmp=$(mktemp -d "$dir/.zekno-install.XXXXXX") || fail install
  if [ "$source" = file ]; then
    say ready
    head -c 268435457 > "$tmp/zekno-runner" || lost
  else
    url=https://github.com/zekno-app/zekno/releases/download/runner-v$version/zekno-runner-linux-$arch.gz
    fetch "$url" "$tmp/zekno-runner.gz" || lost
    gzip -t "$tmp/zekno-runner.gz" </dev/null >&2 || lost
    gzip -dc "$tmp/zekno-runner.gz" </dev/null | head -c 268435457 > "$tmp/zekno-runner" || lost
    rm -f "$tmp/zekno-runner.gz"
  fi
  size=$(wc -c < "$tmp/zekno-runner" | tr -d ' ')
  [ "$size" -gt 0 ] && [ "$size" -le 268435456 ] || fail download
  say "download ok $size"
  if [ "$hasher" = sha256sum ]; then
    actual=$(sha256sum "$tmp/zekno-runner" </dev/null | cut -d ' ' -f 1)
  else
    actual=$(shasum -a 256 "$tmp/zekno-runner" </dev/null | cut -d ' ' -f 1)
  fi
  if [ "$actual" != "$expected" ]; then
    rm -f "$tmp/zekno-runner"
    fail checksum
  fi
  say checksum ok
  chmod 755 "$tmp/zekno-runner" || fail install
  started=0
  "$tmp/zekno-runner" version </dev/null >"$tmp/out" 2>"$tmp/err" || started=$?
  answer=$(head -n 1 "$tmp/out" | cut -c 1-200) || answer=
  case $answer in "{\"version\":\"$version\","*) ;; *) not_started "$started" ;; esac
  mv -f "$tmp/zekno-runner" "$dest" || fail install
  cleanup
  final=$dest
  say install ok
fi

if [ "$install" = yes ] || [ "$found" = "$version" ]; then
  answer=$("$final" version </dev/null 2>/dev/null | head -n 1 | cut -c 1-200) || answer=
  case $answer in "{\"version\":\"$version\","*) ;; *) fail version ;; esac
  say version ok
fi

if [ ! -d "$folder" ]; then
  mkdir -p "$(dirname "$folder")" && mkdir -m 700 "$folder" || fail folder
fi
say folder ok
say "done $where"
trap - EXIT HUP INT TERM
if [ "$mode" = add ] && [ "$source" = release ]; then exec "$final" session; fi
exit 0
}
`
