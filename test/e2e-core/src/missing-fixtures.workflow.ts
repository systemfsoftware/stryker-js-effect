import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { FixtureKeyRef } from './bake-key.schema.js'

const entryNameOf = (fixture: { readonly fixtureId: string; readonly key: string }): string =>
  `${fixture.fixtureId}.${fixture.key}`

export class MissingFixturesCommand extends S.TaggedClass<MissingFixturesCommand>()('MissingFixturesCommand', {
  fixtures: S.Array(FixtureKeyRef),
  present: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const MissingFixtureTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/MissingFixture')
type MissingFixtureTypeId = typeof MissingFixtureTypeId

export class MissingFixture extends S.TaggedClass<MissingFixture>()('MissingFixture', {
  fixtureId: S.String,
  key: S.String,
}) {
  readonly [MissingFixtureTypeId] = MissingFixtureTypeId
}

const absent = (command: MissingFixturesCommand, fixture: FixtureKeyRef): boolean =>
  Boolean.not(command.present.includes(entryNameOf(fixture)))

const missingOf = (command: MissingFixturesCommand): ReadonlyArray<FixtureKeyRef> =>
  command.fixtures.filter((fixture) => absent(command, fixture))

const decide = (command: MissingFixturesCommand): Result.Result<ReadonlyArray<MissingFixture>, never> =>
  Result.succeed(missingOf(command).map((fixture) => MissingFixture.make(fixture)))

export const missingFixtures = Workflow.make({
  command: MissingFixturesCommand,
  decision: S.Array(MissingFixture),
  error: S.Never,
  decide,
})
