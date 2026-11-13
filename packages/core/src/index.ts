/**
 * Zekno core: the public interface.
 *
 * Clients seal secrets and sign deploys; the agent verifies before anything
 * is decrypted. The control plane in between is treated as hostile. Import
 * from this file only.
 */
export {
  createSigner,
  generateMemberKeyPair,
  generateServerKeyPair,
  isKey,
  keyIdOf,
  serverIdOf,
  type MemberPublicKey,
  type MemberSecretKey,
  type ServerPublicKey,
  type ServerSecretKey,
  type Signer,
} from "./keys"
export { confirmationCodesMatch, serverConfirmationCode } from "./confirm"
export { EnvelopeSchema, PAYLOAD_TYPES, type Envelope, type PayloadType } from "./envelope"
export {
  applyRosterUpdate,
  createTeam,
  proposeRoster,
  ROLES,
  teamConfirmationCode,
  trustFoundingRoster,
  type Member,
  type Role,
  type ServerEntry,
  type TeamTrust,
} from "./roster"
export { SealedSecretSchema, type SealedSecret } from "./secrets"
export {
  createSecret,
  createSecretRemoval,
  currentSecrets,
  SecretRecordSchema,
  verifySecret,
  verifySecretRemoval,
  type IgnoredSecret,
  type SecretRecord,
  type VerifiedRemoval,
  type VerifiedSecret,
} from "./secret-record"
export {
  createDeploy,
  initialAgentState,
  openSecrets,
  verifyDeploy,
  type AgentState,
  type Deploy,
  type VerifiedDeploy,
} from "./deploy"
export {
  parseMessage,
  PendingDeploysResponseSchema,
  PublishDeployRequestSchema,
  PublishRosterRequestSchema,
  PublishSecretRemovalRequestSchema,
  PublishSecretRequestSchema,
  RegisterServerRequestSchema,
  RosterChainResponseSchema,
  SecretsResponseSchema,
  STATUS_OUTCOMES,
  StatusReportSchema,
  type PendingDeploysResponse,
  type PublishDeployRequest,
  type PublishRosterRequest,
  type PublishSecretRemovalRequest,
  type PublishSecretRequest,
  type RegisterServerRequest,
  type RosterChainResponse,
  type SecretsResponse,
  type StatusReport,
} from "./protocol"
export { LIMITS } from "./limits"
export {
  CoreError,
  DEPLOY_REFUSALS,
  MESSAGE_REFUSALS,
  OPEN_REFUSALS,
  ROSTER_REFUSALS,
  SECRET_REFUSALS,
  type CoreErrorCode,
  type DeployRefusal,
  type MessageRefusal,
  type OpenRefusal,
  type Result,
  type RosterRefusal,
  type SecretRefusal,
} from "./result"
