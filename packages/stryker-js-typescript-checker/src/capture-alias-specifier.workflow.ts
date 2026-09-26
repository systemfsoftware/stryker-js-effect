import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { CaptureAliasSpecifierCommand } from './CheckerCommands.schema.js'

const CaptureTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/AliasCapture')
type CaptureTypeId = typeof CaptureTypeId

export class AliasSpecifierCaptured extends S.TaggedClass<AliasSpecifierCaptured>()('AliasSpecifierCaptured', {
  capture: S.String,
}) {
  readonly [CaptureTypeId] = CaptureTypeId
}

export class AliasSpecifierUnmatched extends S.TaggedClass<AliasSpecifierUnmatched>()('AliasSpecifierUnmatched', {}) {
  readonly [CaptureTypeId] = CaptureTypeId
}

export const AliasCapture = S.Union([AliasSpecifierCaptured, AliasSpecifierUnmatched])
export type AliasCapture = typeof AliasCapture.Type

const prefixOf = (pattern: string): string => pattern.slice(0, pattern.indexOf('*'))

const suffixOf = (pattern: string): string => pattern.slice(pattern.indexOf('*') + 1)

const stripPrefix = (specifier: string, prefix: string): Option.Option<string> =>
  Option.map(
    Option.liftPredicate(specifier, (candidate) => candidate.startsWith(prefix)),
    (candidate) => candidate.slice(prefix.length),
  )

const stripSuffix = (specifier: string, suffix: string): Option.Option<string> =>
  Option.map(
    Option.liftPredicate(specifier, (candidate) => candidate.endsWith(suffix)),
    (candidate) => candidate.slice(0, candidate.length - suffix.length),
  )

const wildcardCaptureOf = (pattern: string, specifier: string): Option.Option<string> =>
  Option.flatMap(stripPrefix(specifier, prefixOf(pattern)), (rest) => stripSuffix(rest, suffixOf(pattern)))

const exactCaptureOf = (pattern: string, specifier: string): Option.Option<string> =>
  Option.map(Option.liftPredicate(specifier, (candidate) => candidate === pattern), () => '')

const captureOf = (pattern: string, specifier: string): Option.Option<string> =>
  Boolean.match(pattern.includes('*'), {
    onTrue: () => wildcardCaptureOf(pattern, specifier),
    onFalse: () => exactCaptureOf(pattern, specifier),
  })

const decide = (command: CaptureAliasSpecifierCommand): Result.Result<AliasCapture, never> =>
  Result.succeed(
    Option.match(captureOf(command.pattern, command.specifier), {
      onNone: () => AliasSpecifierUnmatched.make({}),
      onSome: (capture) => AliasSpecifierCaptured.make({ capture }),
    }),
  )

export const captureAliasSpecifier = Workflow.make({
  command: CaptureAliasSpecifierCommand,
  decision: AliasCapture,
  error: S.Never,
  decide,
})
