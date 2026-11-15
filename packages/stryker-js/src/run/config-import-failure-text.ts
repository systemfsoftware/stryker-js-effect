import * as Match from 'effect/Match'

import { SupportedConfigFileExtensions } from '../Config.schema.js'
import type { ConfigImportClassified } from './classify-config-import-failure.workflow.js'

const SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE = `one of these extensions: ${
  SupportedConfigFileExtensions.literals.map((extension) => `.${extension}`).join(', ')
}`

const ERASABLE_SYNTAX_HELP =
  'Config modules may use only erasable TypeScript syntax: no enums, no namespaces with runtime code, no parameter properties, and no decorators.'

export const configImportFailureTextOf = (classified: ConfigImportClassified): string =>
  Match.value(classified.code).pipe(
    Match.when(
      'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      () => `The config file "${classified.file}" uses TypeScript syntax Node cannot execute. ${ERASABLE_SYNTAX_HELP}`,
    ),
    Match.when(
      'ERR_UNKNOWN_FILE_EXTENSION',
      () =>
        `The config file "${classified.file}" has an extension Node cannot load. Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE}.`,
    ),
    Match.when(
      'ERR_MODULE_NOT_FOUND',
      () =>
        `The config file "${classified.file}" imports a module Node cannot find. The specifier is most likely not installed — install it as a dependency of the project, or remove the import. Node reported: ${classified.nodeDetail}`,
    ),
    Match.when(
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
      () =>
        `The config file "${classified.file}" imports a path a package does not export. The package is installed but its "exports" map leaves this specifier out — import a path the package publishes. Node reported: ${classified.nodeDetail}`,
    ),
    Match.exhaustive,
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arbitrary = await import('effect/Arbitrary')
  const { ConfigImportClassified: ConfigImportClassifiedSchema } = await import(
    './classify-config-import-failure.workflow.js'
  )

  const SUPPORTED_EXTENSIONS = '.ts, .mts, .js, .mjs'

  const expectedTextOf = ({ code, file, nodeDetail }: typeof ConfigImportClassifiedSchema.Type): string => {
    switch (code) {
      case 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX':
        return `The config file "${file}" uses TypeScript syntax Node cannot execute. Config modules may use only erasable TypeScript syntax: no enums, no namespaces with runtime code, no parameter properties, and no decorators.`
      case 'ERR_UNKNOWN_FILE_EXTENSION':
        return `The config file "${file}" has an extension Node cannot load. Stryker reads config modules with one of these extensions: ${SUPPORTED_EXTENSIONS}.`
      case 'ERR_MODULE_NOT_FOUND':
        return `The config file "${file}" imports a module Node cannot find. The specifier is most likely not installed — install it as a dependency of the project, or remove the import. Node reported: ${nodeDetail}`
      case 'ERR_PACKAGE_PATH_NOT_EXPORTED':
        return `The config file "${file}" imports a path a package does not export. The package is installed but its "exports" map leaves this specifier out — import a path the package publishes. Node reported: ${nodeDetail}`
    }
  }

  it.prop(
    '∀c_Classified_≡TextNamesTheFileAndTheRemedyForItsCode',
    { of: [Arbitrary.schema(ConfigImportClassifiedSchema)], subject: configImportFailureTextOf },
    (subject, [classified]) => subject(classified) === expectedTextOf(classified),
  )
}
