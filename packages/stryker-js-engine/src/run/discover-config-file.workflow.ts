import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { SupportedConfigFileExtensions } from '../Config.schema.js'

export const ConfigFileKind = S.Literals(['supported', 'legacy', 'unsupported'])

export type ConfigFileKindValue = S.Schema.Type<typeof ConfigFileKind>

const ConfigDiscoveryDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ConfigDiscoveryDecision')
type ConfigDiscoveryDecisionTypeId = typeof ConfigDiscoveryDecisionTypeId

export class ConfigFileRequest extends S.Class<ConfigFileRequest>('ConfigFileRequest')({
  file: S.String,
  kind: ConfigFileKind,
  exists: S.Boolean,
}) {}

export class ConfigDiscoveryCommand extends S.TaggedClass<ConfigDiscoveryCommand>()('ConfigDiscoveryCommand', {
  context: S.Literals(['cli', 'extends']),
  requested: S.optional(ConfigFileRequest),
  discovered: S.optional(S.String),
  legacyPresent: S.optional(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigFileRead extends S.TaggedClass<ConfigFileRead>()('ConfigFileRead', {
  file: S.String,
  shadowedLegacyWarning: S.optional(S.String),
}) {
  readonly [ConfigDiscoveryDecisionTypeId] = ConfigDiscoveryDecisionTypeId
}

export class ConfigFileRefused extends S.TaggedClass<ConfigFileRefused>()('ConfigFileRefused', {
  file: S.String,
  hint: S.String,
}) {
  readonly [ConfigDiscoveryDecisionTypeId] = ConfigDiscoveryDecisionTypeId
}

export class ConfigFileMissing extends S.TaggedClass<ConfigFileMissing>()('ConfigFileMissing', {
  file: S.String,
}) {
  readonly [ConfigDiscoveryDecisionTypeId] = ConfigDiscoveryDecisionTypeId
}

export class NoConfigFile extends S.TaggedClass<NoConfigFile>()('NoConfigFile', {}) {
  readonly [ConfigDiscoveryDecisionTypeId] = ConfigDiscoveryDecisionTypeId
}

export type ConfigDiscoveryDecision = ConfigFileRead | ConfigFileRefused | ConfigFileMissing | NoConfigFile

const SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE = `one of these extensions: ${
  SupportedConfigFileExtensions.literals.map((extension) => `.${extension}`).join(', ')
}`

const legacyConfigHint = (file: string): string =>
  `Stryker no longer reads JSON or CommonJS config files. Convert "${file}" to a config module with an "export default { ... }" object — Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE} — and delete the legacy file.`

const unsupportedConfigHint = (file: string): string =>
  `"${file}" is not a supported config file. Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE}, for example "stryker.config.ts" with an "export default { ... }" object.`

const extendsChildHint = (file: string): string =>
  `The extended config "${file}" is a JSON or CommonJS config file, which Stryker no longer reads. Convert it to a config module — Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE} — and point "extends" at the converted file.`

const shadowedLegacyWarning = (legacyFile: string, supportedFile: string): string =>
  `Ignoring the legacy config file "${legacyFile}": "${supportedFile}" is the config Stryker reads. Stryker no longer reads JSON or CommonJS config files; delete the legacy file.`

const refusalHintOf = (command: ConfigDiscoveryCommand, request: ConfigFileRequest): string =>
  Boolean.match(request.kind === 'legacy', {
    onTrue: () =>
      Boolean.match(command.context === 'extends', {
        onTrue: () => extendsChildHint(request.file),
        onFalse: () => legacyConfigHint(request.file),
      }),
    onFalse: () => unsupportedConfigHint(request.file),
  })

const requestedDecisionOf = (
  command: ConfigDiscoveryCommand,
  request: ConfigFileRequest,
): ConfigDiscoveryDecision =>
  Boolean.match(request.kind === 'supported', {
    onTrue: () =>
      Boolean.match(request.exists, {
        onTrue: () => ConfigFileRead.make({ file: request.file }),
        onFalse: () => ConfigFileMissing.make({ file: request.file }),
      }),
    onFalse: () => ConfigFileRefused.make({ file: request.file, hint: refusalHintOf(command, request) }),
  })

const discoveredDecisionOf = (command: ConfigDiscoveryCommand): ConfigDiscoveryDecision =>
  Option.match(Option.fromUndefinedOr(command.discovered), {
    onSome: (file) =>
      ConfigFileRead.make({
        file,
        shadowedLegacyWarning: Option.getOrUndefined(
          Option.map(Option.fromUndefinedOr(command.legacyPresent), (legacy) => shadowedLegacyWarning(legacy, file)),
        ),
      }),
    onNone: () =>
      Option.match(Option.fromUndefinedOr(command.legacyPresent), {
        onSome: (legacy) => ConfigFileRefused.make({ file: legacy, hint: legacyConfigHint(legacy) }),
        onNone: () => NoConfigFile.make({}),
      }),
  })

const discoveryDecisionOf = (command: ConfigDiscoveryCommand): ConfigDiscoveryDecision =>
  Option.match(Option.fromUndefinedOr(command.requested), {
    onSome: (request) => requestedDecisionOf(command, request),
    onNone: () => discoveredDecisionOf(command),
  })

export const discoverConfigFile = Workflow.make({
  command: ConfigDiscoveryCommand,
  decision: S.Union([ConfigFileRead, ConfigFileRefused, ConfigFileMissing, NoConfigFile]),
  error: S.Never,
  decide: (command: ConfigDiscoveryCommand) => Result.succeed(discoveryDecisionOf(command)),
})
