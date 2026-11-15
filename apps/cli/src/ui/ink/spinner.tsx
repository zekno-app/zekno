/** Work in progress at a terminal (`Ui.step`): a spinner, then the step's label. */
import { Text } from "ink"
import { useEffect, useState } from "react"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame((current) => (current + 1) % FRAMES.length), 80)
    return () => clearInterval(timer)
  }, [])
  return (
    <Text>
      <Text color="cyan">{FRAMES[frame]}</Text> {label}…
    </Text>
  )
}
