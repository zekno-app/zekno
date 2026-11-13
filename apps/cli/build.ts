/**
 * Compiles the CLI into one executable: `bun run compile`.
 *
 * Ink has an optional import of React's developer tools, used only when
 * DEV=true and the tools are installed. They are not part of this program,
 * and a single-file build needs every import to resolve, so that one import
 * is pointed at an empty stand-in. Nothing else is changed.
 */
import { join } from "node:path"

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/main.ts")],
  compile: { outfile: join(import.meta.dir, "dist/zekno") },
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
console.log("dist/zekno")
