"use client"

// Client boundary: MotionConfig is React context, which Server Components cannot provide.
import { MotionConfig } from "motion/react"

/**
 * App-wide motion defaults. `reducedMotion="user"` drops transform and layout
 * animation for visitors who ask for reduced motion, and keeps opacity.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ type: "spring", bounce: 0, duration: 0.6 }}
    >
      {children}
    </MotionConfig>
  )
}
