import globals from "globals"

import { config as baseConfig } from "./base.js"

/**
 * The ESLint configuration for code that runs on Bun or Node and draws no
 * web page: the CLI, the runner and the core library.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
      // These programs read their environment when they run (PATH, HOME,
      // ZEKNO_HOME). The rule is about what a cached build depends on.
      "turbo/no-undeclared-env-vars": "off",
      // Cleaning control characters out of what a server sends is this
      // code's job, so its patterns name them on purpose.
      "no-control-regex": "off",
    },
  },
]
