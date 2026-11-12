"use client"

import * as React from "react"
import { Dialog as MenuPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

/**
 * A navigation menu that takes over the whole screen. Built on the same
 * dialog primitive as Sheet, so focus is trapped, Escape closes it and the
 * page behind does not scroll.
 *
 * Motion: the panel is revealed downward from the top edge and leaves with a
 * quick fade. Children marked with the `menu-rise` utility follow one after
 * another (set `--rise-step` on each). With reduced motion it only fades.
 */
function FullscreenMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="fullscreen-menu" {...props} />
}

function FullscreenMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger data-slot="fullscreen-menu-trigger" {...props} />
  )
}

function FullscreenMenuClose({ ...props }: MenuPrimitive.Close.Props) {
  return <MenuPrimitive.Close data-slot="fullscreen-menu-close" {...props} />
}

function FullscreenMenuContent({
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Popup
        data-slot="fullscreen-menu-content"
        className={cn(
          "group/fullscreen-menu fixed inset-0 z-50 flex h-dvh flex-col overflow-y-auto overscroll-contain bg-background text-foreground outline-none",
          // Enter: revealed from the top edge, where the trigger sits.
          "transition-[clip-path,opacity] duration-500 ease-out-strong [clip-path:inset(0)] data-starting-style:[clip-path:inset(0_0_100%_0)]",
          // Exit: faster than the entrance, and only a fade.
          "data-ending-style:opacity-0 data-ending-style:duration-200",
          "motion-reduce:duration-200 motion-reduce:data-starting-style:opacity-0 motion-reduce:data-starting-style:[clip-path:inset(0)]",
          className
        )}
        {...props}
      >
        {children}
      </MenuPrimitive.Popup>
    </MenuPrimitive.Portal>
  )
}

function FullscreenMenuTitle({
  className,
  ...props
}: MenuPrimitive.Title.Props) {
  return (
    <MenuPrimitive.Title
      data-slot="fullscreen-menu-title"
      className={cn("font-heading font-medium text-foreground", className)}
      {...props}
    />
  )
}

export {
  FullscreenMenu,
  FullscreenMenuTrigger,
  FullscreenMenuClose,
  FullscreenMenuContent,
  FullscreenMenuTitle,
}
