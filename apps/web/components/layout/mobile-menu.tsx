"use client"

// Client boundary: the menu's open state lives in the browser.
import { Button } from "@workspace/ui/components/button"
import {
  FullscreenMenu,
  FullscreenMenuClose,
  FullscreenMenuContent,
  FullscreenMenuTitle,
  FullscreenMenuTrigger,
} from "@workspace/ui/components/fullscreen-menu"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef, useState } from "react"

import { Container } from "./container"

const bar =
  "absolute inset-x-0 top-[calc(50%-0.75px)] h-[1.5px] rounded-full bg-current"

/**
 * Three bars that become a cross. The trigger shows the bars. The close
 * button sits in the same place inside the menu and starts and ends as bars,
 * so opening and closing read as one icon changing shape.
 */
function MenuGlyph({ morph = false }: { morph?: boolean }) {
  const moving =
    "transition-[translate,rotate,opacity] duration-400 ease-out-strong motion-reduce:transition-none"

  return (
    <span aria-hidden="true" className="relative block size-5">
      <span
        className={cn(
          bar,
          morph
            ? [
                moving,
                "rotate-45 group-data-ending-style/fullscreen-menu:-translate-y-[5px] group-data-ending-style/fullscreen-menu:rotate-0 group-data-starting-style/fullscreen-menu:-translate-y-[5px] group-data-starting-style/fullscreen-menu:rotate-0",
              ]
            : "-translate-y-[5px]"
        )}
      />
      <span
        className={cn(
          bar,
          morph && [
            moving,
            "opacity-0 group-data-ending-style/fullscreen-menu:opacity-100 group-data-starting-style/fullscreen-menu:opacity-100",
          ]
        )}
      />
      <span
        className={cn(
          bar,
          morph
            ? [
                moving,
                "-rotate-45 group-data-ending-style/fullscreen-menu:translate-y-[5px] group-data-ending-style/fullscreen-menu:rotate-0 group-data-starting-style/fullscreen-menu:translate-y-[5px] group-data-starting-style/fullscreen-menu:rotate-0",
              ]
            : "translate-y-[5px]"
        )}
      />
    </span>
  )
}

/**
 * Full-screen navigation for screens too narrow for the link row. The brand
 * and the links are rendered on the server and passed in; choosing a link
 * closes the menu.
 */
export function MobileMenu({
  title,
  openLabel,
  closeLabel,
  brand,
  children,
}: {
  title: string
  openLabel: string
  closeLabel: string
  brand: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  // The link row takes over at 1024px, so a menu left open across that width closes.
  useEffect(() => {
    if (!open) return
    const wide = window.matchMedia("(min-width: 64rem)")
    const close = () => {
      if (wide.matches) setOpen(false)
    }
    wide.addEventListener("change", close)
    return () => wide.removeEventListener("change", close)
  }, [open])

  return (
    <FullscreenMenu open={open} onOpenChange={setOpen}>
      <FullscreenMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11 lg:hidden"
            aria-label={openLabel}
          />
        }
      >
        <MenuGlyph />
      </FullscreenMenuTrigger>
      <FullscreenMenuContent initialFocus={closeRef}>
        <FullscreenMenuTitle className="sr-only">{title}</FullscreenMenuTitle>
        {/* Same height, padding and button position as the page's top bar. */}
        <Container className="flex h-14 shrink-0 items-center justify-between gap-4">
          {brand}
          <FullscreenMenuClose
            ref={closeRef}
            render={
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                aria-label={closeLabel}
              />
            }
          >
            <MenuGlyph morph />
          </FullscreenMenuClose>
        </Container>
        <Container
          className="flex flex-1 flex-col pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false)
          }}
        >
          {children}
        </Container>
      </FullscreenMenuContent>
    </FullscreenMenu>
  )
}
