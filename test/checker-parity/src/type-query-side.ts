import type { Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { type Checker, type Plugin, TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

import { isPastDeadline, type LegDeadline, remainingOf } from './leg-deadline.js'
import {
  Deferred,
  type ParityLine,
  TypeAnswerLine,
  TypeQueryFileRefused,
  type TypeQueryRefusalReason,
} from './Parity.schema.js'

export interface TypeQueryInput {
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly checkerName: string
  readonly deadline: LegDeadline
}

export interface FileContent {
  readonly name: string
  readonly content: string
}

export interface BranchWorkerRpcsShape {
  readonly capabilities: (
    request: Plugin.CheckerDigestRequest,
  ) => Effect.Effect<TypeQuery.CheckerCapabilities, Checker.CheckerFailed | RpcClientError>
  readonly typeQuery: (
    request: TypeQuery.TypeQueryRequest,
  ) => Effect.Effect<TypeQuery.TypeQueryResponse, TypeQuery.TypeQueryRefused | RpcClientError>
}

export class BranchWorkerRpcs extends Context.Service<BranchWorkerRpcs, BranchWorkerRpcsShape>()(
  '@systemfsoftware/stryker-checker-parity/type-query-side/BranchWorkerRpcs',
) {}

interface QueryCandidateDraft {
  readonly candidateId: string
  readonly text: string
  readonly wire: Checker.CheckerMutantWire
}

interface QuerySiteDraft {
  readonly siteId: string
  readonly location: Checker.CheckerMutantWire['location']
  readonly candidates: ReadonlyArray<QueryCandidateDraft>
}

interface QueryFileDraft {
  readonly fileName: string
  readonly content: string
  readonly sites: ReadonlyArray<QuerySiteDraft>
}

const siteDraftsOf = (wires: ReadonlyArray<Checker.CheckerMutantWire>): ReadonlyArray<QuerySiteDraft> =>
  Object.entries(
    Arr.groupBy(
      wires,
      (wire) =>
        `${wire.location.start.line}:${wire.location.start.column}:${wire.location.end.line}:${wire.location.end.column}`,
    ),
  ).map(
    ([siteId, atSite]) => ({
      siteId,
      location: atSite[0].location,
      candidates: atSite.map((wire) => ({ candidateId: wire.id, text: wire.replacement, wire })),
    }),
  )

const BLOCK_STATEMENT_MUTATOR: keyof typeof Mutator.defaultMutators = 'BlockStatement'
const EMPTY_BLOCK = '{}'
const QUERY_VERSION = 2

const siteKindOf = (site: QuerySiteDraft): TypeQuery.TypeQuerySiteKind =>
  Boolean.match(
    Arr.every(site.candidates, (candidate) =>
      Boolean.every([
        candidate.wire.mutatorName === BLOCK_STATEMENT_MUTATOR,
        candidate.wire.replacement === EMPTY_BLOCK,
      ])),
    { onTrue: () => 'function-body', onFalse: () => 'expression' },
  )

const candidateCountOf = (draft: QueryFileDraft): number =>
  draft.sites.reduce((total, site) => total + site.candidates.length, 0)

const fileDraftsOf = (
  contents: ReadonlyArray<FileContent>,
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): ReadonlyArray<QueryFileDraft> => {
  const contentByName = HashMap.fromIterable(contents.map((entry) => [entry.name, entry.content] as const))
  const byFile = Arr.groupBy(wires, (wire) => wire.fileName)
  return Arr.getSomes(
    Object.entries(byFile).map(([fileName, fileWires]) =>
      Option.map(HashMap.get(contentByName, fileName), (content) => ({
        fileName,
        content,
        sites: siteDraftsOf(fileWires),
      }))
    ),
  )
}

const refusedLineOf = (
  input: TypeQueryInput,
  draft: QueryFileDraft,
  reason: TypeQueryRefusalReason,
  nextAction: string,
): TypeQueryFileRefused =>
  TypeQueryFileRefused.make({
    schemaVersion: 1,
    project: input.project,
    fileName: draft.fileName,
    reason,
    nextAction,
    mutantCount: candidateCountOf(draft),
  })

const deferredLineOf = (input: TypeQueryInput, draft: QueryFileDraft, reason: Deferred['reason']): Deferred =>
  Deferred.make({
    schemaVersion: 1,
    side: 'branch',
    project: input.project,
    fileName: draft.fileName,
    mutants: candidateCountOf(draft),
    reason,
  })

const failedLineOf = (
  input: TypeQueryInput,
  draft: QueryFileDraft,
  failure: TypeQuery.TypeQueryRefused | RpcClientError,
): TypeQueryFileRefused =>
  Match.valueTags(failure, {
    TypeQueryRefused: (refused) => refusedLineOf(input, draft, refused.reason, refused.nextAction),
    RpcClientError: (failed) =>
      refusedLineOf(
        input,
        draft,
        'server-crashed',
        `The branch worker's typeQuery RPC failed: ${failed.message}`,
      ),
  })

const typesOf = (
  siteAnswer: TypeQuery.SiteAnswer,
): { readonly siteType?: string; readonly contextualType?: string } => ({
  ...Option.match(siteAnswer.siteType, { onNone: () => ({}), onSome: (siteType) => ({ siteType }) }),
  ...Option.match(siteAnswer.contextualType, {
    onNone: () => ({}),
    onSome: (contextualType) => ({ contextualType }),
  }),
})

const answerLinesOf = (
  input: TypeQueryInput,
  draft: QueryFileDraft,
  siteAnswer: TypeQuery.SiteAnswer,
): ReadonlyArray<ParityLine> => {
  const site = Option.fromUndefinedOr(draft.sites.find((candidateSite) => candidateSite.siteId === siteAnswer.siteId))
  const candidates = Option.match(site, {
    onNone: Arr.empty<QueryCandidateDraft>,
    onSome: (found) => found.candidates,
  })
  const siteKind = Option.match(site, {
    onNone: (): TypeQuery.TypeQuerySiteKind => 'expression',
    onSome: siteKindOf,
  })
  return Arr.getSomes(
    siteAnswer.candidates.map((candidateAnswer) =>
      Option.map(
        Option.fromUndefinedOr(candidates.find((candidate) => candidate.candidateId === candidateAnswer.candidateId)),
        (candidate) =>
          TypeAnswerLine.make({
            schemaVersion: 1,
            side: 'branch',
            project: input.project,
            mutantId: candidate.candidateId,
            fileName: candidate.wire.fileName,
            line: candidate.wire.location.start.line,
            column: candidate.wire.location.start.column,
            candidate: candidate.text,
            siteKind,
            ...typesOf(siteAnswer),
            answer: candidateAnswer.answer,
          }),
      )
    ),
  )
}

const fileOutcomeLines = (
  input: TypeQueryInput,
  draft: QueryFileDraft,
  file: TypeQuery.FileOutcome,
): ReadonlyArray<ParityLine> =>
  Match.valueTags(file, {
    FileRefused: (refused) => [refusedLineOf(input, draft, refused.reason, refused.nextAction)],
    FileAnswered: (answered) => answered.sites.flatMap((siteAnswer) => answerLinesOf(input, draft, siteAnswer)),
  })

const requestOf = (input: TypeQueryInput, draft: QueryFileDraft, absoluteFile: string): TypeQuery.TypeQueryRequest =>
  TypeQuery.TypeQueryRequest.make({
    version: QUERY_VERSION,
    tsconfigFile: input.tsconfigFile,
    files: [
      TypeQuery.TypeQueryFile.make({
        fileName: absoluteFile,
        content: draft.content,
        sites: draft.sites.map((site) =>
          TypeQuery.TypeQuerySite.make({
            siteId: site.siteId,
            kind: siteKindOf(site),
            location: site.location,
            candidates: site.candidates.map((candidate) => ({
              candidateId: candidate.candidateId,
              text: candidate.text,
            })),
          })
        ),
      }),
    ],
  })

const bounded = <A, E>(
  call: Effect.Effect<A, E>,
  remaining: Option.Option<number>,
): Effect.Effect<Option.Option<A>, E> =>
  Option.match(remaining, {
    onNone: () => Effect.asSome(call),
    onSome: (ms) => Effect.timeoutOption(call, Duration.millis(ms)),
  })

const deferredLines = (
  input: TypeQueryInput,
  drafts: ReadonlyArray<QueryFileDraft>,
  reason: Deferred['reason'],
): ReadonlyArray<ParityLine> => drafts.map((draft) => deferredLineOf(input, draft, reason))

const queryFileLines = (
  client: BranchWorkerRpcsShape,
  input: TypeQueryInput,
  draft: QueryFileDraft,
): Effect.Effect<ReadonlyArray<ParityLine>, never, Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const remaining = yield* remainingOf(input.deadline)
    return yield* Boolean.match(isPastDeadline(remaining), {
      onTrue: () => Effect.succeed([deferredLineOf(input, draft, 'deadline-passed')]),
      onFalse: () =>
        Effect.map(
          bounded(
            client.typeQuery(requestOf(input, draft, path.resolve(input.repoRoot, draft.fileName))).pipe(Effect.result),
            remaining,
          ),
          Option.match({
            onNone: () => [deferredLineOf(input, draft, 'interrupted-at-deadline')],
            onSome: (outcome) =>
              Result.match(outcome, {
                onFailure: (failure) => [failedLineOf(input, draft, failure)],
                onSuccess: (response) => response.files.flatMap((file) => fileOutcomeLines(input, draft, file)),
              }),
          }),
        ),
    })
  })

interface Refusal {
  readonly reason: TypeQueryRefusalReason
  readonly nextAction: string
}

const handshakeRefusalOf = (
  outcome: Result.Result<TypeQuery.CheckerCapabilities, Checker.CheckerFailed | RpcClientError>,
): Option.Option<Refusal> =>
  Result.match(outcome, {
    onFailure: (failure) =>
      Option.some({
        reason: 'server-crashed',
        nextAction: `The branch worker's capabilities RPC failed: ${failure.message}`,
      }),
    onSuccess: (capabilities) =>
      Match.valueTags(TypeQuery.typeQueryServingOf(capabilities, QUERY_VERSION), {
        TypeQueryServed: (): Option.Option<Refusal> => Option.none(),
        TypeQueryNotServed: (notServed): Option.Option<Refusal> =>
          Option.some({ reason: 'unsupported-version', nextAction: notServed.nextAction }),
      }),
  })

const projectLines = (
  input: TypeQueryInput,
  drafts: Arr.NonEmptyReadonlyArray<QueryFileDraft>,
): Effect.Effect<ReadonlyArray<ParityLine>, never, Path.Path | BranchWorkerRpcs> =>
  Effect.gen(function*() {
    const client = yield* BranchWorkerRpcs
    const remaining = yield* remainingOf(input.deadline)
    return yield* Boolean.match(isPastDeadline(remaining), {
      onTrue: () => Effect.succeed(deferredLines(input, drafts, 'deadline-passed')),
      onFalse: () =>
        Effect.gen(function*() {
          const handshake = yield* bounded(
            client.capabilities({ checkerName: input.checkerName }).pipe(Effect.result),
            remaining,
          )
          return yield* Option.match(handshake, {
            onNone: () => Effect.succeed(deferredLines(input, drafts, 'interrupted-at-deadline')),
            onSome: (outcome) =>
              Option.match(handshakeRefusalOf(outcome), {
                onSome: (refusal) =>
                  Effect.succeed(
                    drafts.map((draft) => refusedLineOf(input, draft, refusal.reason, refusal.nextAction)),
                  ),
                onNone: () =>
                  Effect.map(
                    Effect.forEach(drafts, (draft) => queryFileLines(client, input, draft)),
                    (lines) => lines.flat(),
                  ),
              }),
          })
        }),
    })
  })

export interface TypeQueryLegOptions {
  readonly contents: ReadonlyArray<FileContent>
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
}

export const branchTypeQueryLines: {
  (
    options: TypeQueryLegOptions,
  ): (input: TypeQueryInput) => Effect.Effect<ReadonlyArray<ParityLine>, never, Path.Path | BranchWorkerRpcs>
  (
    input: TypeQueryInput,
    options: TypeQueryLegOptions,
  ): Effect.Effect<ReadonlyArray<ParityLine>, never, Path.Path | BranchWorkerRpcs>
} = dual(2, (
  input: TypeQueryInput,
  options: TypeQueryLegOptions,
): Effect.Effect<ReadonlyArray<ParityLine>, never, Path.Path | BranchWorkerRpcs> => {
  const drafts = fileDraftsOf(options.contents, options.wires)
  return Arr.match(drafts, {
    onEmpty: () => Effect.succeed(Arr.empty<ParityLine>()),
    onNonEmpty: (nonEmpty) => projectLines(input, nonEmpty),
  })
})

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Instrument, Mutator } = await import('@systemfsoftware/stryker-js-instrumenter')
  const Clock = await import('effect/Clock')
  const Exit = await import('effect/Exit')
  const Layer = await import('effect/Layer')
  const S = await import('effect/Schema')

  const SOURCE = `export const answer = 'a'\n`
  const SOURCE_FILE = 'subject.ts'
  const SECOND_SOURCE = `export const other = 'b'\n`
  const SECOND_FILE = 'other.ts'
  const CONTENTS: ReadonlyArray<FileContent> = [
    { name: SOURCE_FILE, content: SOURCE },
    { name: SECOND_FILE, content: SECOND_SOURCE },
  ]
  const NOT_SERVED = 1
  const BEHAVIOURS = ['answers', 'refuses', 'does-not-serve'] as const

  type Behaviour = typeof BEHAVIOURS[number] | 'hangs'

  const drafts: Arr.NonEmptyReadonlyArray<QueryFileDraft> = await Effect.runPromise(
    Effect.gen(function*() {
      const instrumented = yield* Instrument.instrument(
        CONTENTS.map((file) => ({ ...file, mutate: true })),
        {
          excludedMutations: [],
          ignorers: [],
          mutantSetPolicy: 'default',
          mutators: Mutator.selectMutators(Mutator.stockRegistry, []),
        },
      )
      const wires = instrumented.mutants.map((mutant) => ({
        id: mutant.id,
        fileName: mutant.fileName,
        mutatorName: mutant.mutatorName,
        replacement: mutant.replacement,
        location: mutant.location,
      }))
      const byFile = HashMap.fromIterable(
        fileDraftsOf(CONTENTS, wires).map((draft) => [draft.fileName, draft] as const),
      )
      return yield* Arr.match(
        Arr.getSomes(CONTENTS.map((file) => HashMap.get(byFile, file.name))),
        {
          onEmpty: () => Effect.die(new Error('the fixture produced no drafts')),
          onNonEmpty: (nonEmpty) => Effect.succeed(nonEmpty),
        },
      )
    }).pipe(Effect.orDie),
  )

  const mutantsPerFile = drafts.map(candidateCountOf)
  const candidates = mutantsPerFile.reduce((total, count) => total + count, 0)
  const files = drafts.length

  const inputOf = (deadline: LegDeadline): TypeQueryInput => ({
    project: 'tsconfig.json',
    tsconfigFile: 'tsconfig.json',
    repoRoot: '/repo',
    checkerName: 'typescript',
    deadline,
  })

  const budgetOf = (ms: number): Effect.Effect<LegDeadline> =>
    Effect.map(Clock.currentTimeMillis, (now) => ({ startedAt: now, deadlineAt: Option.some(now + ms) }))

  const workerOf = (behaviour: Behaviour, answer: string): BranchWorkerRpcsShape =>
    Match.value(behaviour).pipe(
      Match.when('answers', (): BranchWorkerRpcsShape => ({
        capabilities: () => Effect.succeed({ typeQuery: [1, 2] }),
        typeQuery: (request) =>
          Effect.succeed(
            TypeQuery.TypeQueryResponse.make({
              version: 2,
              files: request.files.map((file) =>
                TypeQuery.FileAnswered.make({
                  fileName: file.fileName,
                  sites: file.sites.map((site) =>
                    TypeQuery.SiteAnswer.make({
                      siteId: site.siteId,
                      siteType: Option.none(),
                      contextualType: Option.none(),
                      candidates: site.candidates.map((candidate) =>
                        TypeQuery.CandidateAnswer.make({
                          candidateId: candidate.candidateId,
                          answer: TypeQuery.Assignable.make({ candidateType: answer }),
                        })
                      ),
                    })
                  ),
                })
              ),
            }),
          ),
      })),
      Match.when('refuses', (): BranchWorkerRpcsShape => ({
        capabilities: () => Effect.succeed({ typeQuery: [1, 2] }),
        typeQuery: () =>
          Effect.fail(
            TypeQuery.TypeQueryRefused.make({
              version: 2,
              reason: 'project-open-failed',
              nextAction: 'Fix the project the query names.',
            }),
          ),
      })),
      Match.when('does-not-serve', (): BranchWorkerRpcsShape => ({
        capabilities: () => Effect.succeed({ typeQuery: [NOT_SERVED] }),
        typeQuery: () => Effect.die(new Error('a query was sent to a worker that does not serve it')),
      })),
      Match.when('hangs', (): BranchWorkerRpcsShape => ({
        capabilities: () => Effect.succeed({ typeQuery: [1, 2] }),
        typeQuery: () => Effect.never,
      })),
      Match.exhaustive,
    )

  const layerOf = (behaviour: Behaviour, answer: string) =>
    Layer.merge(Path.layer, Layer.succeed(BranchWorkerRpcs, workerOf(behaviour, answer)))

  const answerTextOf = (answer: TypeQuery.TypeAnswer): string =>
    Match.valueTags(answer, {
      Assignable: (assignable) => `Assignable ${assignable.candidateType}`,
      NotAssignable: (notAssignable) => `NotAssignable ${notAssignable.candidateType}`,
      Unknown: (unknown) => `Unknown ${unknown.reason}`,
    })

  interface Recorded {
    readonly answers: ReadonlyArray<string>
    readonly refusals: ReadonlyArray<{ readonly reason: string; readonly mutantCount: number }>
    readonly deferred: ReadonlyArray<Deferred['reason']>
  }

  const recordsOf = (lines: ReadonlyArray<ParityLine>): Recorded => ({
    answers: lines.filter((line): line is TypeAnswerLine => S.is(TypeAnswerLine)(line)).map((line) =>
      answerTextOf(line.answer)
    ),
    refusals: lines.filter((line): line is TypeQueryFileRefused => S.is(TypeQueryFileRefused)(line)).map((line) => ({
      reason: line.reason,
      mutantCount: line.mutantCount,
    })),
    deferred: lines.filter((line): line is Deferred => S.is(Deferred)(line)).map((line) => line.reason),
  })

  const answersRecorded = (recorded: Recorded, answer: string): boolean =>
    Boolean.every([
      recorded.answers.length === candidates,
      recorded.answers.every((entry) => entry === `Assignable ${answer}`),
      recorded.refusals.length === 0,
      recorded.deferred.length === 0,
    ])

  const refusedEveryFileAs = (recorded: Recorded, reason: string): boolean =>
    Boolean.every([
      recorded.refusals.length === files,
      recorded.answers.length === 0,
      recorded.deferred.length === 0,
      recorded.refusals.every((entry, index) => entry.reason === reason && entry.mutantCount === mutantsPerFile[index]),
    ])

  const deferredAsPerFile = (recorded: Recorded, reasons: ReadonlyArray<Deferred['reason']>): boolean =>
    Boolean.every([
      recorded.deferred.length === reasons.length,
      recorded.answers.length === 0,
      recorded.refusals.length === 0,
      recorded.deferred.every((entry, index) => entry === reasons[index]),
    ])

  const deferredEveryFileAs = (recorded: Recorded, reason: Deferred['reason']): boolean =>
    deferredAsPerFile(recorded, drafts.map(() => reason))

  it.effect.prop(
    '∀b_LegUnderABudget_≡AnswersEveryFileDefersItOrRoutesTheRefusal',
    {
      of: [
        S.Int.check(S.isBetween({ minimum: 0, maximum: 400 })),
        S.Literals(['answers', 'refuses', 'does-not-serve', 'hangs']),
      ],
      subject: projectLines,
    },
    (subject, [budgetMs, behaviour]) =>
      Effect.gen(function*() {
        const budget = yield* budgetOf(budgetMs)
        const outcome = yield* Effect.exit(
          Effect.suspend(() =>
            Effect.provide(subject(inputOf(budget), drafts), layerOf(behaviour, 'the-budget-answer'))
          ),
        )
        return Exit.match(outcome, {
          onFailure: () => false,
          onSuccess: (lines) => {
            const recorded = recordsOf(lines)
            return Boolean.match(budgetMs === 0, {
              onTrue: () => deferredEveryFileAs(recorded, 'deadline-passed'),
              onFalse: () =>
                Match.value(behaviour).pipe(
                  Match.when('answers', () => answersRecorded(recorded, 'the-budget-answer')),
                  Match.when('hangs', () =>
                    deferredAsPerFile(
                      recorded,
                      drafts.map((_, index) => index === 0 ? 'interrupted-at-deadline' : 'deadline-passed'),
                    )),
                  Match.when('refuses', () => refusedEveryFileAs(recorded, 'project-open-failed')),
                  Match.when('does-not-serve', () => refusedEveryFileAs(recorded, 'unsupported-version')),
                  Match.exhaustive,
                ),
            })
          },
        })
      }),
  )
}
