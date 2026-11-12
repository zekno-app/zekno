/**
 * All copy for the landing page. Its components import from here and hold no
 * user-facing strings of their own. Site-wide copy (name, links, navigation)
 * and the sources for claims about other companies are in `config/site.ts`.
 *
 * Contract: specs/001-landing-page/contracts/content.md
 * Invariants are enforced by content.test.ts.
 */
import { site, sources } from "@/config/site"
import type { Link } from "@/types/link"

import type {
  ComparisonColumn,
  ComparisonRow,
  DeployStep,
  FaqItem,
  FeatureBlock,
  OpenPart,
  Party,
  SampleSecret,
  TeamStage,
  ThreatScenario,
} from "../types"

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export const hero = {
  /** Announcement pill above the headline: a blue stage badge, then one line. */
  announcement: {
    badge: site.stage,
    text: "Zekno is in active development",
  },
  headline: site.headline,
  body: "Zekno gives small teams push-button deploys, roles and deploy history on their own servers. Secrets are encrypted and deploys are signed on your machine, so our service never holds a key.",
  status: "Open source (MIT). Starting with Hetzner and Docker Compose.",
} as const

/* ------------------------------------------------------------------ */
/* Why                                                                 */
/* ------------------------------------------------------------------ */

export const why = {
  statement:
    "In October 2026, Zeabur, Railway and Northflank each had customer secrets read out of their control planes. All within 17 days.",
  flaw: "Same flaw every time: the platform could decrypt every customer's secrets, so one break-in reached everyone.",
  answer:
    "Zekno can't decrypt yours. A breach of our service finds nothing it can open.",
  sourcesLabel: "Sources",
  sources: [
    { label: "Zeabur incident report", href: sources.zeaburIncident, external: true },
    { label: "Railway incident report", href: sources.railwayIncident, external: true },
    {
      label: "Northflank incident report",
      href: sources.northflankIncident,
      external: true,
    },
  ] satisfies Link[],
}

/* ------------------------------------------------------------------ */
/* The mechanism: parties, steps, sample data                          */
/* ------------------------------------------------------------------ */

export const parties: Party[] = [
  {
    id: "machine",
    label: "Your machine",
    title: "Desktop app",
    holds: ["Holds the team signing key", "Encrypts secrets", "Signs each deploy"],
  },
  {
    id: "zekno",
    label: "Zekno control plane",
    title: "Store and relay",
    holds: ["Ciphertext only", "No keys, no SSH access"],
  },
  {
    id: "server",
    label: "Your server",
    title: "Agent",
    holds: [
      "Verifies the signature",
      "Decrypts with its own key",
      "Starts your containers",
    ],
  },
]

export const steps: DeployStep[] = [
  {
    id: "encrypt",
    label: "Encrypt",
    party: "machine",
    description:
      "The desktop app encrypts each secret for your server's public key before anything leaves your machine.",
  },
  {
    id: "sign",
    label: "Sign",
    party: "machine",
    description:
      "It signs the deploy manifest with your team's key, which never leaves your machine.",
  },
  {
    id: "relay",
    label: "Relay",
    party: "zekno",
    description:
      "Zekno stores the ciphertext and the signed manifest, which it cannot open or alter, until your server's agent pulls them over an outbound connection.",
  },
  {
    id: "verify",
    label: "Verify",
    party: "server",
    description:
      "The agent checks the signature against your team's public keys and refuses anything that does not match.",
  },
  {
    id: "run",
    label: "Run",
    party: "server",
    description:
      "The agent decrypts with a key that never leaves your server and starts your containers.",
  },
]

export const howItWorks = {
  eyebrow: "How it works",
  heading: "Keys live at the two ends",
  intro: "The service in the middle holds nothing it can open.",
  connectors: ["ciphertext + signed manifest", "agent pulls, outbound only"],
  packetLabel: "sealed packet",
} as const

/** Obviously fake sample values. Nothing here follows a real credential format. */
export const sampleSecrets: SampleSecret[] = [
  {
    name: "DATABASE_URL",
    value: "postgres://demo@db/app",
    cipher: "9f3ac41e07bde2a95c108d",
  },
  {
    name: "PAYMENTS_KEY",
    value: "demo-key-not-a-secret",
    cipher: "b3e41a6cf02d77a14be9d",
  },
  {
    name: "SESSION_SECRET",
    value: "example-session-value",
    cipher: "05c31f8a2c76e0b94d3aa",
  },
]

export const stage = {
  /** Text alternative for the whole hero stage. */
  description:
    "Diagram of one deploy. Your machine holds your secrets and the team signing key. Zekno holds only a sealed, signed packet of ciphertext. Your server verifies the signature, decrypts with its own key and runs your containers.",
  machine: {
    keyLabel: "Team signing key",
    keyNote: "stays here",
  },
  packet: {
    title: "Sealed packet",
    signed: "Signed",
    forgedTitle: "Attacker's deploy",
    unsigned: "Unsigned",
  },
  zekno: {
    short: "Zekno",
    empty: "Nothing stored yet",
    stored: "Stored sealed. No key to open it.",
    breached: "Breached",
    loot: "Everything the attacker can read",
  },
  server: {
    waiting: "Agent waiting",
    verified: "Signature verified",
    refused: "Refused: no team signature",
    container: "container",
    running: "running",
    stopped: "idle",
  },
  rail: ["Encrypt", "Sign", "Relay", "Verify", "Run"],
  captions: {
    idle: "Your secrets start on your machine, readable only there.",
    encrypt: "Secrets are sealed on your machine before they leave it.",
    sign: "The deploy is signed with your team's key.",
    relayZekno: "Zekno stores the sealed packet. It has no key to open it.",
    relayServer: "Your server's agent pulls the packet.",
    verify: "The agent checks the signature before doing anything.",
    run: "Your server decrypts with its own key and runs your containers.",
  },
} as const

export const breach = {
  action: "Breach Zekno",
  reset: "Reset",
  hint: "See what an attacker gets.",
  captions: {
    open: "The attacker reads everything Zekno holds. It is all ciphertext.",
    forged: "They push their own deploy to your server.",
    refused: "Your server refuses it. It only runs what your team signed.",
  },
} as const

/* ------------------------------------------------------------------ */
/* Feature blocks                                                      */
/* ------------------------------------------------------------------ */

export const features: FeatureBlock[] = [
  {
    id: "leak",
    heading: "A breach of Zekno leaks nothing",
    body: "Your secrets are encrypted before they leave your machine, so our database holds only ciphertext. Copy all of it and there is still nothing to open.",
  },
  {
    id: "signature",
    heading: "Nobody deploys to your servers but you",
    body: "Every deploy is signed on your machine. The agent on your server refuses anything unsigned, including anything we send.",
  },
  {
    id: "uptime",
    heading: "We go down, you stay up",
    body: "Your servers never depend on Zekno at runtime. If we are offline, the desktop app deploys to the agent directly.",
  },
  {
    id: "team",
    heading: "A real team platform, on servers you rent yourself",
    body: "A desktop app, teammates with roles and a full deploy history. You pay your provider directly for the servers.",
  },
]

export const demos = {
  leak: {
    title: "Zekno's database, as an attacker sees it",
    rows: [
      { key: "secret_01", a: "9f3ac41e07bde2a95c108d7f", b: "4be9d05c31f8a2c76e0b94d3" },
      { key: "secret_02", a: "b3e41a6cf02d77a14be9d05c", b: "07bde2a95c108d7fb3e41a6c" },
      { key: "secret_03", a: "05c31f8a2c76e0b94d3aa9f3", b: "f02d77a14be9d05c31f8a2c7" },
      { key: "secret_04", a: "e2a95c108d7fb3e41a6cf02d", b: "6e0b94d3aa9f3ac41e07bde2" },
      { key: "secret_05", a: "77a14be9d05c31f8a2c76e0b", b: "c41e07bde2a95c108d7fb3e4" },
    ],
    footer: "Readable secrets found: none",
  },
  signature: {
    incoming: "Incoming deploy",
    agent: "Agent on your server",
    unsigned: { title: "Deploy from Zekno", mark: "No team signature", result: "Refused" },
    signed: { title: "Deploy from your team", mark: "Signed by your team", result: "Accepted" },
    waiting: "Checking signature",
  },
  uptime: {
    machine: "Your machine",
    zekno: "Zekno",
    server: "Your server",
    online: "online",
    offline: "offline",
    running: "running",
    direct: "Deploying directly to the agent",
    viaZekno: "Deploying through Zekno",
  },
} as const

export const teamStages: TeamStage[] = [
  {
    id: "team",
    label: "Team",
    caption: "Every teammate has their own signing key.",
  },
  {
    id: "sign",
    label: "Sign",
    caption: "A deploy is signed by the person who ships it.",
  },
  {
    id: "history",
    label: "History",
    caption: "Every deploy stays in the history, with who signed it.",
  },
  {
    id: "servers",
    label: "Servers",
    caption: "It all runs on your servers. You pay your provider directly.",
  },
]

export const team = {
  members: [
    { id: "ak", initials: "AK" },
    { id: "jm", initials: "JM" },
    { id: "st", initials: "ST" },
  ],
  keyNote: "own key",
  manifest: {
    title: "Deploy manifest",
    rows: [
      { label: "app", value: "api" },
      { label: "target", value: "production" },
    ],
    signedBy: "signed by",
  },
  history: [
    { member: "ak", what: "api to production", when: "just now" },
    { member: "jm", what: "worker to production", when: "2 hours ago" },
    { member: "st", what: "api to staging", when: "yesterday" },
  ],
  signed: "signed",
  serverLabel: "your server",
} as const

/* ------------------------------------------------------------------ */
/* Threat model                                                        */
/* ------------------------------------------------------------------ */

const notProtected = "Zekno does not protect against this."

export const threats = {
  heading: "What a breach gets an attacker",
  intro:
    "We publish what the design protects against, and what it does not. Pick a scenario.",
  resultLabel: "Outcome",
  attackerHolds: "What the attacker controls",
  releaseNote: "The software on both of your ends",
  scenarios: [
    {
      id: "database",
      title: "Attacker copies the Zekno database",
      outcome: "protected",
      outcomeLabel: "Protected",
      result: "No secrets exposed.",
      reason: "The database holds only ciphertext.",
      compromised: "zekno",
    },
    {
      id: "control",
      title: "Attacker controls Zekno and pushes a deploy",
      outcome: "protected",
      outcomeLabel: "Protected",
      result: "The deploy is rejected.",
      reason: "Your servers reject any manifest that is not signed by a team key.",
      compromised: "zekno",
    },
    {
      id: "outage",
      title: "Zekno goes down",
      outcome: "running",
      outcomeLabel: "Apps keep running",
      result: "Your apps keep running.",
      reason: "Your servers don't depend on Zekno at runtime.",
      compromised: "zekno",
    },
    {
      id: "member",
      title: "A team member's machine is compromised",
      outcome: "unprotected",
      outcomeLabel: "Not protected",
      result: notProtected,
      reason: "That machine holds a signing key.",
      compromised: "machine",
    },
    {
      id: "server",
      title: "One of your servers is compromised",
      outcome: "unprotected",
      outcomeLabel: "Not protected",
      result: notProtected,
      reason: "Secrets are plaintext in memory where the app runs.",
      compromised: "server",
    },
    {
      id: "release",
      title: "A Zekno app or agent release is tampered with",
      outcome: "unprotected",
      outcomeLabel: "Not protected",
      result: notProtected,
      reason:
        "The client is the trust anchor. Public code and signed releases reduce this risk; they do not remove it.",
      compromised: "release",
    },
  ] satisfies ThreatScenario[],
  metadataNote:
    "The control plane still sees metadata: server addresses, app names, deploy times and team membership.",
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export const comparison = {
  heading: "Zekno next to what you use today",
  intro:
    "The convenience of a managed platform, with the control of your own scripts.",
  regionLabel: "Comparison table",
  sourceLabel: "source",
  columns: [
    { id: "zekno", label: "Zekno" },
    {
      id: "managed",
      label: "Managed platforms, e.g. Railway",
      source: sources.railwayComparison,
    },
    {
      id: "scripts",
      label: "Kamal or your own scripts",
      source: sources.kamalComparison,
    },
  ] satisfies ComparisonColumn[],
  rows: [
    {
      question: "Who can decrypt your secrets",
      zekno: "Your team and your servers",
      managed: "The platform",
      scripts: "Whoever holds the files",
    },
    {
      question: "Who can run code on your servers",
      zekno: "Only deploys your team signed",
      managed: "The platform",
      scripts: "Anyone with SSH access",
    },
    {
      question: "If the vendor is breached",
      zekno: "No secrets, no code execution",
      managed: "Whatever the platform can decrypt",
      scripts: "No vendor",
    },
    {
      question: "If the vendor is down",
      zekno: "Apps keep running",
      managed: "Depends on the platform",
      scripts: "No vendor",
    },
    {
      question: "Team roles and deploy history",
      zekno: "Included",
      managed: "Included",
      scripts: "You build it",
    },
    {
      question: "Runs on servers you own",
      zekno: "Yes",
      managed: "Usually not",
      scripts: "Yes",
    },
  ] satisfies ComparisonRow[],
}

/* ------------------------------------------------------------------ */
/* Open source                                                         */
/* ------------------------------------------------------------------ */

export const openSource = {
  heading: "Don't trust us. Read the code.",
  body: "Everything that runs on your device or in your browser is public under the MIT license. The control plane is closed, and it never holds a key, so you don't have to trust it.",
  statusLabels: { open: "Open", closed: "Closed" },
  parts: [
    { label: "Core library", status: "open" },
    { label: "Server agent", status: "open" },
    { label: "Desktop app", status: "open" },
    { label: "Website and dashboard", status: "open" },
    { label: "Control plane (hosted by Zekno)", status: "closed" },
  ] satisfies OpenPart[],
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

export const faq = {
  heading: "Questions",
  intro: "Short answers. The README has the full security model.",
  items: [
    {
      id: "zk",
      question: "Does Zekno use zero-knowledge proofs?",
      answer:
        "No. The mechanism is end-to-end encryption plus digital signatures. The name refers to the service having zero knowledge of your secrets.",
    },
    {
      id: "sees",
      question: "What can the control plane see?",
      answer:
        "Ciphertext and signed deploy manifests, which it cannot open or alter, plus metadata: server addresses, app names, deploy times and team membership.",
    },
    {
      id: "down",
      question: "What happens if Zekno goes down?",
      answer:
        "Your apps keep running, because your servers don't depend on Zekno at runtime. While we are offline, the desktop app can deploy to the agent directly.",
    },
    {
      id: "limits",
      question: "What does Zekno not protect against?",
      answer:
        "A compromised team member's machine, because it holds a signing key. A compromised server of yours, because secrets are plaintext in memory where the app runs. A tampered Zekno app or agent release, which public code and signed releases reduce but do not remove.",
    },
    {
      id: "providers",
      question: "Which servers and providers are supported?",
      answer:
        "Zekno is starting with Hetzner servers and Docker Compose. Other providers are not supported yet.",
    },
    {
      id: "closed",
      question: "Why is the control plane closed source?",
      answer:
        "It is the hosted service we sell. You don't have to trust it: it never receives a key, and your servers refuse anything it sends that your team did not sign.",
    },
    {
      id: "production",
      question: "Is it ready for production?",
      answer:
        "No. Zekno is pre-alpha, and the security design has not been independently audited.",
    },
    {
      id: "cost",
      question: "What will it cost?",
      answer:
        "Pricing has not been announced. You pay your server provider directly for your servers.",
    },
  ] satisfies FaqItem[],
}

/* ------------------------------------------------------------------ */
/* Closing call to action and footer                                   */
/* ------------------------------------------------------------------ */

export const closing = {
  heading: "Deploy without handing over the keys",
  body: "Zekno is pre-alpha. Early-access teams get a hands-on migration from Railway, Zeabur or Northflank.",
} as const

/** Labels for assistive technology used by the landing page's own controls. */
export const a11y = {
  stageProgress: "Deploy progress",
  stepsLabel: "Deploy steps",
  teamStagesLabel: "Team platform stages",
  scenariosLabel: "Threat scenarios",
} as const
