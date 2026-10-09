import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { Corruption } from '../../tests/__fixtures__/describe-checker-mutants-law.fixture.js'
import {
  DescribeCheckerMutantsCommand,
  MutantDescribed,
  type MutantDescription,
  MutantUndescribable,
} from '../Checker/Checker.schema.js'
import { describeCheckerMutants } from '../Checker/describe-checker-mutants.workflow.js'

const corrupted = (mutant: Mutant.Mutant, corruption: Corruption): object =>
  Match.value(corruption).pipe(
    Match.when('none', () => mutant),
    Match.when('lowercaseMutator', () => ({ ...mutant, mutatorName: 'lowercase' })),
    Match.when('reasonWithoutStatus', () => ({ ...mutant, status: undefined, statusReason: 'carried alone' })),
    Match.when('zeroLine', () => ({ ...mutant, location: { ...mutant.location, start: { line: 0, column: 1 } } })),
    Match.exhaustive,
  )

interface Drawn {
  readonly mutant: Mutant.Mutant
  readonly corruption: Corruption
}

const drawnArb = Arbitrary.array(
  Arbitrary.all([Arbitrary.schema(Mutant.Mutant), Arbitrary.schema(Corruption)]).pipe(
    Arbitrary.map(([mutant, corruption]): Drawn => ({ mutant, corruption })),
  ),
  { maxLength: 8 },
)

const commandOf = (drawn: readonly Drawn[]) =>
  DescribeCheckerMutantsCommand.make({
    candidates: drawn.map(({ mutant, corruption }) => ({
      id: mutant.id,
      fileName: mutant.fileName,
      mutant: corrupted(mutant, corruption),
    })),
  })

const idOf = (description: MutantDescription): string =>
  Match.valueTags(description, {
    MutantDescribed: ({ wire }) => wire.id,
    MutantUndescribable: ({ undescribable }) => undescribable.id,
  })

const describedOf = (
  subject: typeof describeCheckerMutants,
  drawn: readonly Drawn[],
): readonly MutantDescription[] =>
  Result.match(subject(commandOf(drawn)), { onFailure: () => [], onSuccess: (decision) => decision })

const sharesSourceFields = (description: MutantDescription, mutant: Mutant.Mutant): boolean =>
  S.is(MutantDescribed)(description) &&
  description.wire.id === mutant.id &&
  description.wire.fileName === mutant.fileName &&
  description.wire.mutatorName === mutant.mutatorName &&
  description.wire.replacement === mutant.replacement &&
  Equal.equals(description.wire.location, mutant.location)

const refusesNaming = (description: MutantDescription, mutant: Mutant.Mutant): boolean =>
  S.is(MutantUndescribable)(description) &&
  description.undescribable.id === mutant.id &&
  description.undescribable.fileName === mutant.fileName &&
  description.undescribable.reason.length > 0

describe('describeCheckerMutants', () => {
  it.prop(
    '∀m_Descriptions_≡OnePerMutantInOrder',
    { of: [drawnArb], subject: describeCheckerMutants },
    (subject, [drawn]) => {
      const described = describedOf(subject, drawn)
      return described.length === drawn.length &&
        Arr.every(Arr.zip(described, drawn), ([description, { mutant }]) => idOf(description) === mutant.id)
    },
  )

  it.prop(
    '∀m_Side_≡WireIffTheMutantDecodes',
    { of: [drawnArb], subject: describeCheckerMutants },
    (subject, [drawn]) =>
      Arr.every(
        Arr.zip(describedOf(subject, drawn), drawn),
        ([description, { mutant, corruption }]) =>
          corruption === 'none' ? sharesSourceFields(description, mutant) : refusesNaming(description, mutant),
      ),
  )
})
