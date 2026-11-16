/**
 * A size in bytes as the boards write it: "27 MB". The app's add-server
 * screen and `zekno deploy`'s first run both say the runner's size so.
 */
export const megabytes = (bytes: number): string =>
  `${Math.max(1, Math.round(bytes / 1_000_000))} MB`
