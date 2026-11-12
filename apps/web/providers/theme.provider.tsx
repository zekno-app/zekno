"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import * as React from "react"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      // Dark is always the default: the visitor's system setting never overrides it.
      defaultTheme="dark"
      forcedTheme="dark"
      // A key of our own, so a theme stored by the starter template is ignored.
      storageKey="zekno-theme"
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
