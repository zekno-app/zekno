/** A key the app read, as the helpers of ui/parts/ read keys. */
import type { ListKey } from "../../ui/parts/select"
import type { AppKey } from "../keys"

export const isText = (key: AppKey, text: string): boolean => key.kind === "text" && key.text === text

/** As the list helpers in ui/parts/select.tsx read keys. */
export const listKey = (key: AppKey): ListKey => ({
  upArrow: key.kind === "up",
  downArrow: key.kind === "down",
  return: key.kind === "enter",
  escape: key.kind === "escape",
})

/** What the text helpers in ui/ are told about a key besides the text it typed. */
export type InputFlags = { return?: boolean; escape?: boolean; backspace?: boolean }

/** As the text helpers in ui/ read keys. */
export function inputOf(key: AppKey): [string, InputFlags] {
  if (key.kind === "text") return [key.text, {}]
  if (key.kind === "enter") return ["\r", { return: true }]
  if (key.kind === "escape") return ["", { escape: true }]
  if (key.kind === "backspace") return ["", { backspace: true }]
  return ["", {}]
}
