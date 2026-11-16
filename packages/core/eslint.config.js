import { config } from "@workspace/eslint-config/node"

/** @type {import("eslint").Linter.Config[]} */
export default [...config, { ignores: ["dist/**", ".e2e/**"] }]
