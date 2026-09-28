import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { missingFixtures, MissingFixturesCommand } from '../missing-fixtures.workflow.js'

const refOf = (fixtureId: string, key: string) => ({ fixtureId, key })

const entryOf = (fixture: { readonly fixtureId: string; readonly key: string }): string =>
  `${fixture.fixtureId}.${fixture.key}`

describe('missingFixtures', () => {
  it.prop(
    '∀f_ExpectedFixturesWithASubsetPresent_≡ExactlyTheAbsentOnes',
    {
      of: [S.NonEmptyString, S.NonEmptyString, S.NonEmptyString, S.Boolean, S.Boolean, S.Boolean],
      subject: missingFixtures,
    },
    (subject, [fixtureId, keyA, keyB, seededA, seededB, seededC]) => {
      const fixtures = [refOf(fixtureId, keyA), refOf(`${fixtureId}0`, keyB), refOf(`${fixtureId}1`, keyA)]
      const presentFlags = [seededA, seededB, seededC]
      const present = fixtures.filter((_, index) => presentFlags[index] === true).map(entryOf)
      const expected = fixtures
        .filter((_, index) => presentFlags[index] !== true)
        .map((fixture) => ({ fixtureId: fixture.fixtureId, key: fixture.key }))
      const decided = Result.getOrThrow(
        subject(MissingFixturesCommand.make({ fixtures, present })),
      ).map((fixture) => ({ fixtureId: fixture.fixtureId, key: fixture.key }))
      return JSON.stringify(decided) === JSON.stringify(expected)
    },
  )
})
