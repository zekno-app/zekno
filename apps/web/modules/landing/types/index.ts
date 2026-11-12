/** Shapes of the landing page's copy and sample data. */
export type PartyId = "machine" | "zekno" | "server"

export type Party = {
  id: PartyId
  label: string
  title: string
  holds: string[]
}

export type DeployStepId = "encrypt" | "sign" | "relay" | "verify" | "run"

export type DeployStep = {
  id: DeployStepId
  label: string
  party: PartyId
  description: string
}

export type SampleSecret = {
  name: string
  /** Fixed, obviously fake value. Never a real credential format. */
  value: string
  /** Stand-in ciphertext with the same length as `value`, so text never reflows. */
  cipher: string
}

export type FeatureId = "leak" | "signature" | "uptime" | "team"

export type FeatureBlock = {
  id: FeatureId
  heading: string
  body: string
}

export type TeamStageId = "team" | "sign" | "history" | "servers"

export type TeamStage = {
  id: TeamStageId
  label: string
  caption: string
}

export type ThreatOutcome = "protected" | "running" | "unprotected"

export type ThreatScenario = {
  id: string
  title: string
  outcome: ThreatOutcome
  outcomeLabel: string
  result: string
  reason: string
  compromised: PartyId | "release"
}

export type ComparisonColumn = {
  id: "zekno" | "managed" | "scripts"
  label: string
  /** Address of a public page that backs the column's claims. */
  source?: string
}

export type ComparisonRow = {
  question: string
  zekno: string
  managed: string
  scripts: string
}

export type OpenPart = {
  label: string
  status: "open" | "closed"
}

export type FaqItem = {
  id: string
  question: string
  answer: string
}
