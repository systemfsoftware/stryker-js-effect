import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import { classifyModuleSpecifier } from '../classify-module-specifier.workflow.js'
import { ClassifyModuleSpecifierCommand, type ModuleSpecifierKind } from '../import-closure.schema.js'

type ClassifySubject = (command: ClassifyModuleSpecifierCommand) => Result.Result<ModuleSpecifierKind, never>

const classified = (
  subject: ClassifySubject,
  specifier: string,
  builtins: readonly string[],
): ModuleSpecifierKind | undefined =>
  Result.match(subject(ClassifyModuleSpecifierCommand.make({ specifier, builtins })), {
    onFailure: () => undefined,
    onSuccess: (kind) => kind,
  })

const reassembles = (kind: ModuleSpecifierKind | undefined, specifier: string): boolean =>
  kind?._tag === 'PackageSpecifier' &&
  (kind.packageName === specifier || specifier === `${kind.packageName}/${kind.subpath}`)

const packageOrListedBuiltin = (
  subject: ClassifySubject,
  specifier: string,
  builtins: readonly string[],
  nameHolds: (packageName: string) => boolean,
): boolean => {
  const kind = classified(subject, specifier, builtins)
  return builtins.includes(specifier)
    ? kind?._tag === 'BuiltinSpecifier'
    : reassembles(kind, specifier) && kind?._tag === 'PackageSpecifier' && nameHolds(kind.packageName)
}

describe('classifyModuleSpecifier', () => {
  it.prop(
    '∀c_HashSpecifier_≡SubpathImportEvenWhenListedAsBuiltin',
    { of: [ClassifyModuleSpecifierCommand], subject: classifyModuleSpecifier },
    (subject, [command]) => {
      const specifier = `#${command.specifier}`
      return classified(subject, specifier, [...command.builtins, specifier])?._tag === 'SubpathImportSpecifier'
    },
  )

  it.prop(
    '∀c_NodeSchemeSpecifier_≡BuiltinWhateverTheList',
    { of: [ClassifyModuleSpecifierCommand], subject: classifyModuleSpecifier },
    (subject, [command]) =>
      classified(subject, `node:${command.specifier}`, command.builtins)?._tag === 'BuiltinSpecifier',
  )

  it.prop(
    '∀c_RelativeSpecifier_≡PathEvenWhenListedAsBuiltin',
    { of: [ClassifyModuleSpecifierCommand], subject: classifyModuleSpecifier },
    (subject, [command]) => {
      const specifier = `./${command.specifier}`
      return classified(subject, specifier, [...command.builtins, specifier])?._tag === 'PathSpecifier'
    },
  )

  it.prop(
    '∀c_UnscopedBareSpecifier_≡ListedBuiltinOrPackageNamedByItsFirstSegment',
    { of: [ClassifyModuleSpecifierCommand], subject: classifyModuleSpecifier },
    (subject, [command]) =>
      packageOrListedBuiltin(subject, `x${command.specifier}`, command.builtins, (name) => !name.includes('/')),
  )

  it.prop(
    '∀c_ScopedBareSpecifier_≡ListedBuiltinOrPackageNamedByItsFirstTwoSegments',
    { of: [ClassifyModuleSpecifierCommand], subject: classifyModuleSpecifier },
    (subject, [command]) =>
      packageOrListedBuiltin(
        subject,
        `@${command.specifier}/p`,
        command.builtins,
        (name) => name.split('/').length === 2,
      ),
  )
})
