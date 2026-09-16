import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import type { PluginLoadDecision } from '../plan-plugin-load.workflow.js'
import {
  planPluginLoad,
  PluginLoadCommand,
  PluginSelectionError,
  PluginsPartiallyResolved,
  ResolvedSpecifier,
} from '../plan-plugin-load.workflow.js'

const commandArbitrary = S.toArbitrary(PluginLoadCommand)(fc)

const uniqueSpecifiers = (specifiers: readonly string[]): readonly string[] =>
  specifiers.filter((specifier, index) => specifiers.indexOf(specifier) === index)

const firstOutcomeIsResolved = (command: PluginLoadCommand, specifier: string): boolean =>
  S.is(ResolvedSpecifier)(command.resolutions.find((resolution) => resolution.specifier === specifier))

const resolvedSpecifiersOf = (command: PluginLoadCommand): readonly string[] =>
  uniqueSpecifiers(command.specifiers).filter((specifier) => firstOutcomeIsResolved(command, specifier))

const unresolvedSpecifiersOf = (command: PluginLoadCommand): readonly string[] =>
  uniqueSpecifiers(command.specifiers).filter((specifier) => !resolvedSpecifiersOf(command).includes(specifier))

const loadedSpecifiersOf = (decision: PluginLoadDecision): readonly string[] =>
  decision.toLoad.map((entry) => entry.specifier)

const sameOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const subsetOf = (values: readonly string[], universe: readonly string[]): boolean =>
  values.every((value) => universe.includes(value))

const namesEvery = (entries: readonly { readonly specifier: string }[], text: string): boolean =>
  entries.every((entry) => text.includes(entry.specifier))

const partialityMatches = (command: PluginLoadCommand, decision: PluginLoadDecision): boolean => {
  if (S.is(PluginsPartiallyResolved)(decision)) {
    return unresolvedSpecifiersOf(command).length > 0
  }
  return unresolvedSpecifiersOf(command).length === 0
}

describe('planPluginLoad', () => {
  it.prop('∀c_Command_≡Load', [commandArbitrary], ([command]) => {
    const result = planPluginLoad(command)
    const expected = resolvedSpecifiersOf(command)
    if (Result.isSuccess(result)) {
      return sameOrder(loadedSpecifiersOf(result.success), expected)
    }
    return expected.length === 0
  })

  it.prop('∀c_Command_⊆Declared', [commandArbitrary], ([command]) => {
    const result = planPluginLoad(command)
    const declared = uniqueSpecifiers(command.specifiers)
    if (Result.isSuccess(result)) {
      return subsetOf(loadedSpecifiersOf(result.success), declared)
    }
    return subsetOf(
      result.failure.unresolved.map((missed) => missed.specifier),
      declared,
    )
  })

  it.prop('∀c_Command_≡Refusal', [commandArbitrary], ([command]) => {
    const result = planPluginLoad(command)
    if (resolvedSpecifiersOf(command).length === 0) {
      return Result.isFailure(result) && S.is(PluginSelectionError)(result.failure)
    }
    return Result.isSuccess(result) && result.success.toLoad.length > 0
  })

  it.prop('∀c_Command_≡Partial', [commandArbitrary], ([command]) => {
    const result = planPluginLoad(command)
    if (Result.isFailure(result)) {
      return resolvedSpecifiersOf(command).length === 0
    }
    return partialityMatches(command, result.success)
  })

  it.prop('∀c_Command_≡Reason', [commandArbitrary], ([command]) => {
    const result = planPluginLoad(command)
    if (Result.isFailure(result)) {
      return result.failure.reason.includes('testRunner') &&
        result.failure.reason.includes('checkers') &&
        namesEvery(result.failure.unresolved, result.failure.reason)
    }
    return loadedSpecifiersOf(result.success).length > 0
  })
})
