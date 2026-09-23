import { normalizeFileName } from '@systemfsoftware/stryker-js-instrumenter'
import { type CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import { createGroups, type TSFileNode } from './Compiler.js'

const groupsWithStrangers = (
  inside: readonly CheckerMutantWire[],
  outside: readonly CheckerMutantWire[],
  nodes: MutableHashMap.MutableHashMap<string, TSFileNode>,
): ReadonlyArray<ReadonlyArray<string>> => {
  const groups = createGroups([...inside], nodes)
  if (outside.length > 0) {
    return [outside.map((mutant) => mutant.id), ...groups]
  }
  return groups
}

const knownFileGroups = (
  mutants: readonly CheckerMutantWire[],
  nodes: MutableHashMap.MutableHashMap<string, TSFileNode>,
): ReadonlyArray<ReadonlyArray<string>> => {
  const inside = mutants.filter((mutant) =>
    Option.isSome(MutableHashMap.get(nodes, normalizeFileName(mutant.fileName)))
  )
  const outside = mutants.filter((mutant) =>
    Option.isNone(MutableHashMap.get(nodes, normalizeFileName(mutant.fileName)))
  )
  if (inside.length === 0) {
    return mutants.map((mutant) => [mutant.id])
  }
  return groupsWithStrangers(inside, outside, nodes)
}

export const groupMutants = (
  mutants: readonly CheckerMutantWire[],
  nodes: MutableHashMap.MutableHashMap<string, TSFileNode>,
  prioritizePerformanceOverAccuracy: boolean,
): ReadonlyArray<ReadonlyArray<string>> => {
  if (prioritizePerformanceOverAccuracy) {
    return knownFileGroups(mutants, nodes)
  }
  return mutants.map((mutant) => [mutant.id])
}
