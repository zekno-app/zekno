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
  CONTAINERS_PER_SERVICE,
  initialRunnerState,
  newRunnerState,
  parseRunnerState,
  readRunnerState,
  takesVersionOne,
  versionOneView,
  type AppBuilds,
  type AppRoutes,
  type Building,
  type RunnerState,
  type StoredRunnerState,
} from "./deploy/state"
export {
  keepAfter,
  withAppBuilds,
  withBuilding,
  withDropped,
  withFresh,
} from "./deploy/kept-builds"
export {
  domainHolders,
  domainsAfter,
  healthBytesAfter,
  healthInForce,
  withAppRoutes,
  withoutReleased,
} from "./deploy/routes"
export { openSecrets } from "./deploy/open"
export {
  createDeployV2,
  readSignedDeployV2,
  verifyDeployV2,
  type VerifiedDeployV2,
} from "./deploy/deploy-v2"
export {
  readDeployV2Payload,
  type DeployV2,
  type Health,
  type Predeploy,
  type Route,
} from "./deploy/message"
export {
  baseKey,
  buildKey,
  builtImageName,
  ImageRefSchema,
  isImageRef,
  namesReservedRegistry,
  type Build,
  type BuildRecipe,
  type ImageRef,
  type ListedSecret,
} from "./deploy/builds"
export {
  isCredentialName,
  isNeverGivenArg,
  isSyntaxLine,
  SYNTAX_LINE,
} from "./deploy/build-names"
export {
  CARRIED_OUT,
  CARRIED_OUT_ROWS,
  rowsAskedFor,
  type CarriedOutRow,
  type CarriedOutTable,
} from "./deploy/carried-out"
export { admitPiece, stillAllowed } from "./deploy/gate"
export {
  ARCHES,
  BUILD_REASONS,
  BuildRecordSchema,
  DIGEST,
  DOCKER_VERSION,
  readBuildRecord,
  type Arch,
  type BuildReason,
  type BuildRecord,
} from "./deploy/build-record"
export { hashStream } from "./crypto/hash"
export {
  compareNames,
  createTarWriter,
  header,
  isPackName,
  PACK_TIME,
  paddingFor,
  splitsAsUstar,
  TAR_END,
} from "./pack/tar"
export { createPackChecker, type PackItem } from "./pack/check"
export {
  cutPieces,
  openPiece,
  pieceFingerprint,
  pieceLength,
  sealPiece,
} from "./pack/pieces"
export {
  domainFault,
  healthBytes,
  HealthInForceSchema,
  HealthSchema,
  isHealthPath,
  isRoutableDomain,
  RouteSchema,
  type DomainFault,
} from "./deploy/routes-and-checks"
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
  ROUTE_FAILURES,
  RUNNER_OUTCOMES,
  RUNNER_REFUSALS,
  RunnerApplyRequestSchema,
  RunnerDeployRequestSchema,
  RunnerReportSchema,
  RunnerSetupRequestSchema,
  RunnerSetupResponseSchema,
  RunnerStatusSchema,
  RunnerSyncRequestSchema,
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
  type RunnerApplyRequest,
  type RunnerDeployRequest,
  type RunnerReport,
  type RunnerSetupRequest,
  type RunnerSetupResponse,
  type RunnerStatus,
  type RunnerSyncRequest,
  type SecretsResponse,
  type StatusReport,
} from "./protocol/protocol"
export {
  HealthEventSchema,
  LogEventSchema,
  ProgressEventSchema,
  PROXY_STATES,
  RUNNER_PROTOCOL,
  RunnerAppStatesSchema,
  RunnerLogsRequestSchema,
  RunnerPackSchema,
  RunnerProxySchema,
  RunnerRecordsRequestSchema,
  RunnerRecordsSchema,
  RunnerStatusRequestSchema,
  RunnerStatusWithRoutesSchema,
  RunnerVersionSchema,
  SERVICE_HEALTH,
  SERVICE_STATES,
  SESSION_COMMANDS,
  SESSION_FRAME_BYTES,
  SessionEventSchema,
  SessionFrameSchema,
  SessionRequestSchema,
  SessionResultSchema,
  type HealthEvent,
  type LogEvent,
  type ProgressEvent,
  type RunnerAppStates,
  type RunnerLogsRequest,
  type RunnerPack,
  type RunnerProxy,
  type RunnerRecords,
  type RunnerStatusRequest,
  type RunnerStatusWithRoutes,
  type RunnerVersion,
  type SessionCommand,
  type SessionEvent,
  type SessionFrame,
  type SessionRequest,
} from "./protocol/session"
export {
  AppBuildsAnswerSchema,
  BuildErrorEventSchema,
  BuildEventSchema,
  BuildLineEventSchema,
  RunnerBuilderRequestSchema,
  RunnerBuilderSchema,
  RunnerBuildsRequestSchema,
  RunnerBuildsSchema,
  RunnerPackRequestSchema,
  type AppBuildsAnswer,
  type BuildErrorEvent,
  type BuildEvent,
  type BuildLineEvent,
  type RunnerBuilder,
  type RunnerBuilderRequest,
  type RunnerBuilds,
  type RunnerBuildsRequest,
  type RunnerPackRequest,
} from "./protocol/build-messages"
export { SERVICE_NAME } from "./protocol/service-name"
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
