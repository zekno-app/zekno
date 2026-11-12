import { Cloud, Laptop, type LucideIcon, Server } from "lucide-react"

import { type PartyId } from "../../types"

const icons: Record<PartyId, LucideIcon> = {
  machine: Laptop,
  zekno: Cloud,
  server: Server,
}

/** The icon that stands for one of the three parties. Decorative: the label beside it carries the name. */
export function PartyIcon({
  party,
  className,
}: {
  party: PartyId
  className?: string
}) {
  const Icon = icons[party]
  return <Icon aria-hidden="true" className={className} />
}
