export { ConfigDocumentSchema } from '../Config.schema.js'
export {
  extendsPropertySchema,
  ExtendsStepDocumentSchema,
  ExtendsStepDone,
  ExtendsStepRead,
  ExtendsStepRefused,
  ExtendsStepResolve,
  ExtendsStepStateSchema,
  forkOptionsSchema,
  ImportedModuleSchema,
  MergeCommand,
  MergeResult,
  ReadConfigCommand,
  survivorsPriorReport,
} from '../Config.schema.js'
export type {
  ExtendsRefusalReason,
  ExtendsStepDecision,
  ExtendsStepDocument,
  ExtendsStepState,
} from '../Config.schema.js'
export { StrykerConfig } from '../config/stryker-config.schema.js'
export type { Immutable, ImmutablePrimitive, Primitive } from '../config/stryker-config.schema.js'
export {
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
} from '../ConfigError.schema.js'
export { FileMatcher } from '../matching.schema.js'
export {
  decideExtendsStep,
  describeErrors,
  forkCoreSchema,
  importModule,
  initialExtendsStepState,
  loadConfigCell,
  mergeConfigs,
  readConfig,
  validateOptions,
} from '../run/load-config.cell.js'
export type { ConfigInvocation, ValidationSchemaDocument } from '../run/load-config.cell.js'
