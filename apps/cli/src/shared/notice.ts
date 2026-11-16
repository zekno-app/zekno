/** A line on the current screen: the result of something done elsewhere, or why something was not done. */
export type Notice = {
  tone: "success" | "error" | "warning" | "info"
  text: string
}
