import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PlanResolutionCandidatesCommand } from '../CheckerCommands.schema.js'
import { ExtensionlessPath, planResolutionCandidates } from '../plan-resolution-candidates.workflow.js'

const APPENDED_SUFFIXES = [
  '.ts',
  '.tsx',
  '.d.ts',
  '/index.ts',
  '/index.tsx',
  '/index.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
  '/index.cjs',
]

const REPLACED_SUFFIXES = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs']

const appendCandidates = (resolved: string): ReadonlyArray<string> => [
  resolved,
  ...Arr.map(APPENDED_SUFFIXES, (suffix) => resolved + suffix),
]

const replaceCandidates = (resolved: string, extension: string): ReadonlyArray<string> => {
  const withoutExtension = resolved.slice(0, Math.max(resolved.length - extension.length, 0))
  return [resolved, ...Arr.map(REPLACED_SUFFIXES, (suffix) => withoutExtension + suffix)]
}

const decisionFor = (resolved: string, extension: string) =>
  Result.match(planResolutionCandidates(PlanResolutionCandidatesCommand.make({ resolved, extension })), {
    onFailure: (refused) => refused,
    onSuccess: (value) => value,
  })

const candidatesFor = (resolved: string) => decisionFor(resolved, '').candidates

const candidatesWithExtensionFor = (resolved: string, extension: string) => decisionFor(resolved, extension).candidates

const extensionSchema = () => S.String.check(S.isMinLength(1)).check(S.isMaxLength(3))

describe('planResolutionCandidates', (it) => {
  it.prop(
    '∀path_NoExtension_≡ReferenceAppended',
    { of: [S.String], subject: candidatesFor },
    (subject, [resolved]) => Equal.equals(subject(resolved), appendCandidates(resolved)),
  )

  it.prop(
    '∀path_WithExtension_≡ReferenceReplaced',
    { of: [S.String, extensionSchema()], subject: candidatesWithExtensionFor },
    (subject, [resolved, extension]) =>
      Equal.equals(subject(resolved, extension), replaceCandidates(resolved, extension)),
  )

  it.prop(
    '∀path_ExtensionPresence_≡ExtensionlessVariant',
    { of: [S.String, S.String], subject: candidatesFor },
    (subject, [resolved, extension]) =>
      Equal.equals(S.is(ExtensionlessPath)(decisionFor(resolved, extension)), extension === '') &&
      Equal.equals(subject(resolved), appendCandidates(resolved)),
  )
})
