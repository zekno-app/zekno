/**
 * What `docker buildx build --help` and `docker buildx prune --help` print
 * (specs/016-build-from-source, T059; contracts/runner.md RB5, RB14): the
 * runner reads from them whether this buildx has `--policy` (E09) and
 * `--max-used-space` (FR-068), since the contract names no other way to
 * know. Each text lists its flag only when the stand-in's script says so,
 * the way an older buildx lacks it.
 */

const BUILD_BEFORE_POLICY = `
Usage:  docker buildx build [OPTIONS] PATH | URL | -

Start a build

Aliases:
  docker buildx build, docker buildx b

Options:
      --add-host strings              Add a custom host-to-IP mapping (format: "host:ip")
      --allow strings                 Allow extra privileged entitlement (e.g., "network.host", "security.insecure")
      --annotation stringArray        Add annotation to the image
      --attest stringArray            Attestation parameters (format: "type=sbom,generator=image")
      --build-arg stringArray         Set build-time variables
      --build-context stringArray     Additional build contexts (e.g., name=path)
      --builder string                Override the configured builder instance (default "default")
      --cache-from stringArray        External cache sources (e.g., "user/app:cache", "type=local,src=path/to/dir")
      --cache-to stringArray          Cache export destinations (e.g., "user/app:cache", "type=local,dest=path/to/dir")
      --call string                   Set method for evaluating build ("check", "outline", "targets") (default "build")
      --cgroup-parent string          Set the parent cgroup for the "RUN" instructions during build
      --check                         Shorthand for "--call=check" (default )
  -D, --debug                         Enable debug logging
  -f, --file string                   Name of the Dockerfile (default: "PATH/Dockerfile")
      --iidfile string                Write the image ID to a file
      --label stringArray             Set metadata for an image
      --load                          Shorthand for "--output=type=docker"
      --metadata-file string          Write build result metadata to a file
      --network string                Set the networking mode for the "RUN" instructions during build (default "default")
      --no-cache                      Do not use cache when building the image
      --no-cache-filter stringArray   Do not cache specified stages
  -o, --output stringArray            Output destination (format: "type=local,dest=path")
      --platform stringArray          Set target platform for build
`

const POLICY = `      --policy stringArray            Policy configuration (format: "filename=path", "reset=true")
`

const BUILD_AFTER_POLICY = `      --progress string               Set type of progress output ("auto", "none", "plain", "quiet", "rawjson", "tty"). Use plain to show container output (default "auto")
      --provenance string             Shorthand for "--attest=type=provenance"
      --pull                          Always attempt to pull all referenced images
      --push                          Shorthand for "--output=type=registry"
  -q, --quiet                         Suppress the build output and print image ID on success
      --sbom string                   Shorthand for "--attest=type=sbom"
      --secret stringArray            Secret to expose to the build (format: "id=mysecret[,src=/local/secret]")
      --shm-size bytes                Shared memory size for build containers
      --ssh stringArray               SSH agent socket or keys to expose to the build (format: "default|<id>[=<socket>|<key>[,<key>]]")
  -t, --tag stringArray               Image identifier (format: "[registry/]repository[:tag]")
      --target string                 Set the target build stage to build
      --ulimit ulimit                 Ulimit options (default [])
`

/** `docker buildx build --help`, with `--policy` when this buildx has it. */
export const buildHelp = (policy: boolean): string =>
  `${BUILD_BEFORE_POLICY}${policy ? POLICY : ""}${BUILD_AFTER_POLICY}`

const PRUNE_START = `
Usage:  docker buildx prune

Remove build cache

Options:
  -a, --all                    Include internal/frontend images
      --builder string         Override the configured builder instance (default "default")
  -D, --debug                  Enable debug logging
      --filter filter          Provide filter values (e.g., "until=24h")
  -f, --force                  Do not prompt for confirmation
`

/** The flags of a buildx that has `--max-used-space`, which replaced `--keep-storage`. */
const SPACE_FLAGS = `      --max-used-space bytes   Maximum amount of disk space allowed to keep for cache
      --min-free-space bytes   Target amount of free disk space after pruning
      --reserved-space bytes   Amount of disk space always allowed to keep for cache
`

const KEEP_STORAGE = `      --keep-storage bytes     Amount of disk space to keep for cache
`

const PRUNE_END = `      --verbose                Provide a more verbose output
`

/** `docker buildx prune --help`, with `--max-used-space` when this buildx has it, else `--keep-storage`. */
export const pruneHelp = (maxUsedSpace: boolean): string =>
  `${PRUNE_START}${maxUsedSpace ? SPACE_FLAGS : KEEP_STORAGE}${PRUNE_END}`
