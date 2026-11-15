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

  const { SupportedConfigFileExtensions: Extensions } = await import('../Config.schema.js')

  const classifiedArb = Arbitrary.schema(ConfigImportClassifiedSchema)
  const REPORTS_NODE_DETAIL: ReadonlySet<string> = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'])

  it.prop(
    '∀c_Classified_≡TextNamesTheFileItCouldNotLoad',
    { of: [classifiedArb], subject: configImportFailureTextOf },
    (subject, [classified]) => subject(classified).startsWith(`The config file "${classified.file}" `),
  )

  it.prop(
    '∀c_Classified_≡NodeDetailReportedIffTheCodeCarriesOne',
    { of: [classifiedArb], subject: configImportFailureTextOf },
    (subject, [classified]) =>
      subject(classified).endsWith(`Node reported: ${classified.nodeDetail}`) ===
        REPORTS_NODE_DETAIL.has(classified.code),
  )

  it.prop(
    '∀c_UnknownExtension_≡TextListsEverySupportedExtension',
    { of: [classifiedArb], subject: configImportFailureTextOf },
    (subject, [classified]) =>
      classified.code !== 'ERR_UNKNOWN_FILE_EXTENSION' ||
      Extensions.literals.every((extension) => subject(classified).includes(`.${extension}`)),
  )

  it.prop(
    '∀c_Classified_≡EachCodeGetsItsOwnRemedy',
    { of: [classifiedArb, classifiedArb], subject: configImportFailureTextOf },
    (subject, [left, right]) => {
      const sameInputsBut = ConfigImportClassifiedSchema.make({
        code: right.code,
        file: left.file,
        nodeDetail: left.nodeDetail,
      })
      return (subject(left) === subject(sameInputsBut)) === (left.code === right.code)
    },
  )
}
