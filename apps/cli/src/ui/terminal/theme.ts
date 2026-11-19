/**
 * The app's colours (research R13 and R15). Normal text is drawn in the
 * terminal's own text colour, never a literal white or black, so it stays
 * readable on any background. Secondary text is the dim variant of that
 * colour. State uses the terminal's standard green, red and yellow, always
 * beside a symbol and a word, never by colour alone. The brand blue marks
 * focus, the selected row's arrow and ".dev" in the logo.
 *
 * Nothing here sets a background colour: a selected row is shown by the arrow
 * marker and bold text only.
 */
import { createContext, useContext } from "react"

/** The `brand` token of packages/ui/src/styles/globals.css. 5.0:1 on the canvas's dark ground. */
export const BRAND = "#2383e2"
/** The `brand-darker` token of packages/ui/src/styles/globals.css. 4.75:1 on white, where `brand` is 3.9:1. */
export const BRAND_DARKER = "#1a73d1"

/** Whether the terminal's background is dark or light. Dark when it cannot be told. */
export type Background = "dark" | "light"

export type Theme = {
  background: Background
  /** Focus, the selection marker, action letters and ".dev" in the logo. */
  brand: string
  /** Something that worked or is running. Always beside ✔ or ● and a word. */
  success: "green"
  /** Something that failed or stopped. Always beside ✖ or ● and a word. */
  danger: "red"
  /** Something to notice. Always beside ! and a sentence. */
  warning: "yellow"
}

/** The theme for a terminal with this background. */
export function themeFor(background: Background): Theme {
  return {
    background,
    brand: background === "light" ? BRAND_DARKER : BRAND,
    success: "green",
    danger: "red",
    warning: "yellow",
  }
}

const ThemeContext = createContext<Theme>(themeFor("dark"))

/** Gives every part below it the theme for this terminal. */
export const ThemeProvider = ThemeContext.Provider

/** The theme for this terminal: dark unless the app was told otherwise. */
export const useTheme = (): Theme => useContext(ThemeContext)
