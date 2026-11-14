/**
 * Compiles the CLI into one executable: `bun run compile`, or
 * `bun build.ts <outfile>` to put it elsewhere than dist/zekno.
 *
 * Ink has an optional import of React's developer tools, used only when
 * DEV=true and the tools are installed. They are not part of this program,
 * and a single-file build needs every import to resolve, so that one import
 * is pointed at an empty stand-in. Nothing else is changed.
 *
 * A compiled Bun program reads `.env` and `bunfig.toml` from the folder it is
 * started in, unless it was built not to, and `bunfig.toml` can preload a
 * script. zekno is started inside project folders, which may be cloned from
 * anyone, so both are turned off: such a folder can neither run code in zekno
 * nor change its environment (specs/005-runner-release/research.md, R16).
 * `tsconfig.json` and `package.json` are not read at run time either; that is
 * Bun's default, said here so it stays so.
 */
import { join, resolve } from "node:path"

const outfile = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dir, "dist/zekno")

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/main.ts")],
  compile: {
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
    autoloadTsconfig: false,
    autoloadPackageJson: false,
  },
  plugins: [
    {
      name: "no-react-devtools",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: join(import.meta.dir, "src/ui/devtools-stub.ts"),
        }))
      },
    },
  ],
})
for (const log of result.logs) console.error(log)
if (!result.success) process.exit(1)
console.log(outfile)
