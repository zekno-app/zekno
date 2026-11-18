/**
 * Zekno core: the public interface.
 *
 * Clients seal secrets and sign deploys; the runner verifies before anything
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
} from "./crypto/keys"
export {
  confirmationCodesMatch,
  serverConfirmationCode,
} from "./crypto/confirm"
export {
  EnvelopeSchema,
  PAYLOAD_TYPES,
  type Envelope,
  type PayloadType,
} from "./crypto/envelope"
export {
  applyRosterUpdate,
  createTeam,
  proposeRoster,
  ROLES,
  teamConfirmationCode,
  TeamTrustSchema,
  trustFoundingRoster,
  type Member,
  type Role,
  type ServerEntry,
  type TeamTrust,
} from "./team/roster"
export {
  isReservedSecretName,
  SealedSecretSchema,
  SECRET_NAME,
  type SealedSecret,
} from "./secrets/secrets"
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
} from "./secrets/secret-record"
export {
  peekSecretStatement,
  verifySecretStatement,
  type VerifiedStatement,
} from "./secrets/statement"
export { secretsForDeploy, type BlockedSecret } from "./secrets/for-deploy"
export {
  createDeploy,
  readSignedDeploy,
  verifyDeploy,
  type Deploy,
  type VerifiedDeploy,
} from "./deploy/deploy"
export {
  afterVersionOneDeploy,
  initialRunnerState,
  newRunnerState,
  parseRunnerState,
  readRunnerState,
  takesVersionOne,
  versionOneView,
  type RunnerState,
  type StoredRunnerState,
} from "./deploy/state"
export { openSecrets } from "./deploy/open"
export {
  createDeployV2,
  readSignedDeployV2,
  verifyDeployV2,
  type VerifiedDeployV2,
} from "./deploy/deploy-v2"
export {
  readDeployV2Payload,
  type Build,
  type DeployV2,
  type Health,
  type Predeploy,
  type Route,
} from "./deploy/message"
export { buildKey } from "./deploy/later-fields"
export { createLink, verifyLink, type VerifiedLink } from "./deploy/link"
export {
  parseMessage,
  PendingDeploysResponseSchema,
  PublishDeployRequestSchema,
  PublishRosterRequestSchema,
  PublishSecretRemovalRequestSchema,
  PublishSecretRequestSchema,
  RegisterServerRequestSchema,
  RosterChainResponseSchema,
  LogEventSchema,
  ProgressEventSchema,
  RUNNER_OUTCOMES,
  RUNNER_PROTOCOL,
  RUNNER_REFUSALS,
  RunnerAppStatesSchema,
  RunnerLogsRequestSchema,
  RunnerVersionSchema,
  SERVICE_HEALTH,
  SERVICE_NAME,
  SERVICE_STATES,
  SESSION_COMMANDS,
  SESSION_FRAME_BYTES,
  SessionEventSchema,
  SessionFrameSchema,
  SessionRequestSchema,
  SessionResultSchema,
  RunnerApplyRequestSchema,
  RunnerDeployRequestSchema,
  RunnerRecordsRequestSchema,
  RunnerRecordsSchema,
  RunnerReportSchema,
  RunnerSetupRequestSchema,
  RunnerSetupResponseSchema,
  RunnerStatusSchema,
  RunnerSyncRequestSchema,
  SecretsResponseSchema,
  STATUS_OUTCOMES,
  StatusReportSchema,
  type LogEvent,
  type PendingDeploysResponse,
  type ProgressEvent,
  type RunnerAppStates,
  type RunnerLogsRequest,
  type RunnerVersion,
  type SessionCommand,
  type SessionEvent,
  type SessionFrame,
  type SessionRequest,
  type PublishDeployRequest,
  type PublishRosterRequest,
  type PublishSecretRemovalRequest,
  type PublishSecretRequest,
  type RegisterServerRequest,
  type RosterChainResponse,
  type RunnerApplyRequest,
  type RunnerDeployRequest,
  type RunnerRecords,
  type RunnerReport,
  type RunnerSetupRequest,
  type RunnerSetupResponse,
  type RunnerStatus,
  type RunnerSyncRequest,
  type SecretsResponse,
  type StatusReport,
} from "./protocol/protocol"
export { LIMITS } from "./protocol/limits"
export {
  compareRunnerVersions,
  isDevVersion,
  parseRunnerVersion,
  RUNNER_VERSION_PATTERN,
  type ParsedRunnerVersion,
} from "./protocol/version"
export {
  CoreError,
  DEPLOY_REFUSALS,
  DEPLOY_V2_REFUSALS,
  LINK_REFUSALS,
  MESSAGE_REFUSALS,
  OPEN_REFUSALS,
  ROSTER_REFUSALS,
  SECRET_REFUSALS,
  type CoreErrorCode,
  type DeployRefusal,
  type DeployV2Refusal,
  type LinkRefusal,
  type MessageRefusal,
  type OpenRefusal,
  type Result,
  type RosterRefusal,
  type SecretRefusal,
} from "./protocol/result"
