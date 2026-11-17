/**
 * The template files this zekno carries: one line for each file of this
 * folder, in the order of their names (specs/012-templates,
 * contracts/template-file.md, "The index"). Each file is taken as its text,
 * for the strict reader. A test fails when a file and its line do not match.
 */
export const TEMPLATE_FILES = [
  ["mongodb", await import("./mongodb.json", { with: { type: "text" } })],
  ["mysql", await import("./mysql.json", { with: { type: "text" } })],
  ["postgres", await import("./postgres.json", { with: { type: "text" } })],
  ["redis", await import("./redis.json", { with: { type: "text" } })],
] as const
