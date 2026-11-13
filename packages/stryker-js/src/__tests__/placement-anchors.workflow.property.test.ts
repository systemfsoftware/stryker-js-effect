import { describe, it } from '@systemfsoftware/vitest'

import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type AnchoredMutant,
  AnchoredMutantSchema,
  type PlacementAnchorDecision,
  placementAnchors,
  PlacementAnchorsCommand,
} from '../placement-anchors.workflow.js'

interface Probe {
  readonly command: PlacementAnchorsCommand
  readonly focus: AnchoredMutant
}

const withHeldMutants = (
  mutants: readonly AnchoredMutant[],
  picks: readonly boolean[],
): readonly AnchoredMutant[] =>
  mutants.map((mutant, holder): AnchoredMutant =>
    Option.match(Option.fromUndefinedOr(mutant.guard), {
      onNone: () => mutant,
      onSome: (guard) => ({
        ...mutant,
        guard: Mutant.Guard.make({
          ...guard,
          inside: [
            ...guard.inside,
            ...mutants
              .filter((_, held) => picks[(holder * mutants.length + held) % Math.max(1, picks.length)] === true)
              .map((held) => held.id),
          ],
        }),
      }),
    })
  )

const probeArb = Arbitrary.all([
  Arbitrary.schema(AnchoredMutantSchema),
  Arbitrary.schema(PlacementAnchorsCommand),
  S.Boolean.pipe(S.Array, Arbitrary.schema),
]).pipe(
  Arbitrary.map(([focus, command, picks]): Probe => {
    const mutants = withHeldMutants([focus, ...command.mutants], picks)
    return { command: PlacementAnchorsCommand.make({ mutants }), focus: mutants[0] ?? focus }
  }),
)

const noIds: readonly Mutant.MutantId[] = []

const dominatorsOf = (mutant: AnchoredMutant): readonly Mutant.MutantId[] =>
  Option.match(Option.fromUndefinedOr(mutant.subsumption), {
    onNone: () => noIds,
    onSome: (subsumption) =>
      Match.value(subsumption).pipe(
        Match.tag('Subsumed', (subsumed): readonly Mutant.MutantId[] => subsumed.dominators),
        Match.tag('Readmitted', () => noIds),
        Match.exhaustive,
      ),
  })

const holdingBlockOf = (holder: AnchoredMutant, held: Mutant.MutantId): readonly Mutant.MutantId[] =>
  Option.match(Option.fromUndefinedOr(holder.guard), {
    onNone: () => noIds,
    onSome: (guard) => (guard.inside.includes(held) ? [guard.block] : noIds),
  })

const justifiedAnchorsOf = (command: PlacementAnchorsCommand, mutant: AnchoredMutant): readonly string[] =>
  [
    ...new Set([
      ...dominatorsOf(mutant),
      ...Option.match(Option.fromUndefinedOr(mutant.guard), { onNone: () => noIds, onSome: (guard) => [guard.block] }),
      ...command.mutants.flatMap((holder) => holdingBlockOf(holder, mutant.id)),
    ]),
  ].toSorted()

const anchorsOfDecision = (decision: PlacementAnchorDecision): readonly Mutant.MutantId[] =>
  Match.value(decision).pipe(
    Match.tag('Anchored', (anchored): readonly Mutant.MutantId[] => anchored.anchors),
    Match.tag('Unanchored', () => noIds),
    Match.exhaustive,
  )

const decisionsOf = (
  subject: typeof placementAnchors,
  command: PlacementAnchorsCommand,
): readonly PlacementAnchorDecision[] => Result.getOrElse(subject(command), () => [])

const focusAnchorsOf = (subject: typeof placementAnchors, probe: Probe): readonly Mutant.MutantId[] =>
  Option.match(Option.fromUndefinedOr(decisionsOf(subject, probe.command)[0]), {
    onNone: () => noIds,
    onSome: anchorsOfDecision,
  })

describe('placementAnchors', () => {
  it.prop(
    '∀c_Command_≡OneDecisionPerMutantInCommandOrder',
    { of: [probeArb], subject: placementAnchors },
    (subject, [probe]) =>
      decisionsOf(subject, probe.command).map((decision) => decision.id).join('\n') ===
        probe.command.mutants.map((mutant) => mutant.id).join('\n'),
  )

  it.prop(
    '∀f_Focus_≡AnchorsAreExactlyItsDominatorsItsGuardBlockAndEveryGuardBlockHoldingIt',
    { of: [probeArb], subject: placementAnchors },
    (subject, [probe]) =>
      [...focusAnchorsOf(subject, probe)].toSorted().join('\n') ===
        justifiedAnchorsOf(probe.command, probe.focus).join('\n'),
  )
})
