import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  type FileOutcome,
  type SiteAnswer,
  TypeQuery,
  TypeQueryFile,
  TypeQueryRequest,
  TypeQuerySite,
  type TypeQuerySiteKind,
} from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import { TypeQueryLive } from '@systemfsoftware/stryker-js-typescript-checker/type-query'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'

import {
  type ParityLine,
  TypeAnswerLine,
  TypeQueryFileRefused,
  type TypeQueryRefusalReason,
  TypeQueryServers,
} from './Parity.schema.js'

export interface TypeQueryInput {
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly servers: Ref.Ref<ServerTally>
}

export interface FileContent {
  readonly name: string
  readonly content: string
}

export interface ServerTally {
  readonly live: number
  readonly peak: number
}

const tallyProvision = (tally: Ref.Ref<ServerTally>): Effect.Effect<void> =>
  Ref.update(tally, (current) => {
    const live = current.live + 1
    return { live, peak: Math.max(current.peak, live) }
  })

const tallyRelease = (tally: Ref.Ref<ServerTally>): Effect.Effect<void> =>
  Ref.update(tally, (current) => ({ ...current, live: current.live - 1 }))

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

const BLOCK_STATEMENT_MUTATOR = 'BlockStatement'
const EMPTY_BLOCK = '{}'

const siteKindOf = (site: QuerySiteDraft): TypeQuerySiteKind =>
  Boolean.match(
    Arr.every(site.candidates, (candidate) =>
      Boolean.every([
        candidate.wire.mutatorName === BLOCK_STATEMENT_MUTATOR,
        candidate.wire.replacement === EMPTY_BLOCK,
      ])),
    { onTrue: () => 'function-body', onFalse: () => 'expression' },
  )

const siteKindKeyOf = (kind: TypeQuerySiteKind): { readonly kind?: TypeQuerySiteKind } =>
  Boolean.match(kind === 'function-body', { onTrue: () => ({ kind }), onFalse: () => ({}) })

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
    mutantCount: draft.sites.reduce((total, site) => total + site.candidates.length, 0),
  })

const typesOf = (
  siteAnswer: SiteAnswer,
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
  siteAnswer: SiteAnswer,
): ReadonlyArray<ParityLine> => {
  const site = Option.fromUndefinedOr(draft.sites.find((candidateSite) => candidateSite.siteId === siteAnswer.siteId))
  const candidates = Option.match(site, {
    onNone: Arr.empty<QueryCandidateDraft>,
    onSome: (found) => found.candidates,
  })
  const siteKind = Option.match(site, {
    onNone: (): TypeQuerySiteKind => 'expression',
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
  file: FileOutcome,
): ReadonlyArray<ParityLine> =>
  Match.valueTags(file, {
    FileRefused: (refused) => [refusedLineOf(input, draft, refused.reason, refused.nextAction)],
    FileAnswered: (answered) => answered.sites.flatMap((siteAnswer) => answerLinesOf(input, draft, siteAnswer)),
  })

const queryFileLines = (
  input: TypeQueryInput,
  draft: QueryFileDraft,
  absoluteFile: string,
): Effect.Effect<ReadonlyArray<ParityLine>, never, TypeQuery> =>
  Effect.gen(function*() {
    const typeQuery = yield* TypeQuery
    const request = TypeQueryRequest.make({
      version: 2,
      tsconfigFile: input.tsconfigFile,
      files: [
        TypeQueryFile.make({
          fileName: absoluteFile,
          content: draft.content,
          sites: draft.sites.map((site) =>
            TypeQuerySite.make({
              siteId: site.siteId,
              ...siteKindKeyOf(siteKindOf(site)),
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
    return Result.match(yield* typeQuery.query(request).pipe(Effect.result), {
      onFailure: (refused) => [refusedLineOf(input, draft, refused.reason, refused.nextAction)],
      onSuccess: (response) => response.files.flatMap((file) => fileOutcomeLines(input, draft, file)),
    })
  })

const queryProjectLines = (
  input: TypeQueryInput,
  drafts: ReadonlyArray<QueryFileDraft>,
): Effect.Effect<ReadonlyArray<ParityLine>, never, TypeQuery | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const lines = yield* Effect.forEach(
      drafts,
      (draft) => queryFileLines(input, draft, path.resolve(input.repoRoot, draft.fileName)),
    )
    return lines.flat()
  })

type QueryServices = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

export const branchTypeQueryLines: {
  (
    contents: ReadonlyArray<FileContent>,
    wires: ReadonlyArray<Checker.CheckerMutantWire>,
  ): (input: TypeQueryInput) => Effect.Effect<ReadonlyArray<ParityLine>, never, QueryServices>
  (
    input: TypeQueryInput,
    contents: ReadonlyArray<FileContent>,
    wires: ReadonlyArray<Checker.CheckerMutantWire>,
  ): Effect.Effect<ReadonlyArray<ParityLine>, never, QueryServices>
} = dual(3, (
  input: TypeQueryInput,
  contents: ReadonlyArray<FileContent>,
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<ReadonlyArray<ParityLine>, never, QueryServices> =>
  Effect.gen(function*() {
    const drafts = fileDraftsOf(contents, wires)
    return yield* Boolean.match(Arr.isReadonlyArrayNonEmpty(drafts), {
      onFalse: () => Effect.succeed(Arr.empty<ParityLine>()),
      onTrue: () =>
        Effect.gen(function*() {
          yield* tallyProvision(input.servers)
          const lines = yield* Effect.scoped(Effect.provide(queryProjectLines(input, drafts), TypeQueryLive))
          const peak = (yield* Ref.get(input.servers)).peak
          yield* tallyRelease(input.servers)
          return [
            ...lines,
            TypeQueryServers.make({
              schemaVersion: 1,
              side: 'branch',
              project: input.project,
              peakLiveServers: peak,
            }),
          ]
        }),
    })
  }))
