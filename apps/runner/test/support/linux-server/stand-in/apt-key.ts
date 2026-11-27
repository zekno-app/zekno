/**
 * The check of Docker's apt key, as `sh` lines the stand-in runs before
 * Docker's repository is added (specs/016-build-from-source, plan item 2
 * (C); research/map-checks.md part 4): the key file must hold exactly one
 * primary key, and that key's version 4 fingerprint must be the one
 * pins.json names. Anything else stops the install with one line.
 *
 * Ubuntu's image carries no `gpg`, and none is installed for this: the
 * lines walk the OpenPGP packets with `od` and hash the primary key with
 * `sha1sum`, which coreutils carries. A version 4 fingerprint is the SHA-1
 * of the key packet written with the byte 0x99 and a two-byte length, the
 * form Docker's key has, so it is the hash of the file's first packet as it
 * stands. Counting primary keys keeps a key appended to the file from
 * being trusted with it.
 */

/** The `sh` lines that check `path` against `fingerprint` (forty upper-case hex digits). */
export function keyCheck(path: string, fingerprint: string): string {
  if (!/^[0-9A-F]{40}$/.test(fingerprint))
    throw new Error("the fingerprint is not forty upper-case hex digits")
  if (!/^\/?[A-Za-z0-9._/-]+$/.test(path))
    throw new Error(`the key's path ${path} holds a character sh would read`)
  return [
    `key=${path}`,
    "bin=$(mktemp)",
    `fail() { echo "Docker's apt key: $1" >&2; rm -f "$bin"; exit 1; }`,
    // The armor: the header lines up to the first empty one, then base64 up
    // to the checksum line or the end line.
    `tr -d '\\r' < "$key" | sed -e '1,/^$/d' -e '/^=/,$d' -e '/^-----END/,$d' | base64 -d > "$bin" 2> /dev/null || fail "it is not an armored key"`,
    'size=$(wc -c < "$bin")',
    '[ "$size" -gt 0 ] || fail "it holds no packet"',
    "off=0",
    "keys=0",
    'while [ "$off" -lt "$size" ]; do',
    // Six bytes at most make a header; the zeros stand in past the end.
    '  set -- $(od -An -tu1 -j "$off" -N 6 "$bin") 0 0 0 0 0',
    "  b=$1",
    '  [ $((b & 128)) -ne 0 ] || fail "byte $off does not start a packet"',
    "  if [ $((b & 64)) -ne 0 ]; then",
    "    tag=$((b & 63))",
    '    if [ "$2" -lt 192 ]; then hdr=2; len=$2',
    '    elif [ "$2" -lt 224 ]; then hdr=3; len=$((($2 - 192) * 256 + $3 + 192))',
    '    elif [ "$2" -eq 255 ]; then hdr=6; len=$(((($3 * 256 + $4) * 256 + $5) * 256 + $6))',
    '    else fail "the packet at byte $off has a partial length"; fi',
    "  else",
    "    tag=$(((b >> 2) & 15))",
    "    case $((b & 3)) in",
    "      0) hdr=2; len=$2 ;;",
    "      1) hdr=3; len=$(($2 * 256 + $3)) ;;",
    "      2) hdr=5; len=$(((($2 * 256 + $3) * 256 + $4) * 256 + $5)) ;;",
    '      *) fail "the packet at byte $off has no length" ;;',
    "    esac",
    "  fi",
    '  [ "$tag" -ne 6 ] || keys=$((keys + 1))',
    "  off=$((off + hdr + len))",
    "done",
    '[ "$off" -eq "$size" ] || fail "its last packet runs past its end"',
    '[ "$keys" -eq 1 ] || fail "it holds $keys primary keys, not one"',
    'set -- $(od -An -tu1 -N 4 "$bin") 0 0 0 0',
    '[ "$1" -eq 153 ] && [ "$4" -eq 4 ] || fail "its first packet is not a version 4 public key with a two-byte length"',
    'fpr=$(head -c $((3 + $2 * 256 + $3)) "$bin" | sha1sum | cut -c1-40 | tr abcdef ABCDEF)',
    `[ "$fpr" = ${fingerprint} ] || fail "its fingerprint is $fpr, not the pinned ${fingerprint}"`,
    'rm -f "$bin"',
  ].join("\n")
}
