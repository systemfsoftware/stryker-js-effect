import { Handle } from '@systemfsoftware/effect-cell-types'
import { lineStartsOf, offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import {
  type FileOutcome,
  type SiteAnswer,
  type TypeAnswer,
  TypeQuery,
  type TypeQueryCandidate,
  type TypeQueryFile,
  TypeQueryRefused,
  type TypeQueryRequest,
  type TypeQueryResponse,
  type TypeQueryShape,
  type TypeQuerySite,
} from '@systemfsoftware/stryker-js-plugin-interface/type-query'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as SynchronizedRef from 'effect/SynchronizedRef'
import type { CallExpression, Expression, NewExpression, Node, SourceFile } from 'typescript/unstable/ast'
import { isCallExpression, isExpression, isNewExpression } from 'typescript/unstable/ast/is'
import {
  API,
  type Checker,
  type Project,
  SignatureKind,
  type Snapshot,
  type Type,
  TypeFlags,
} from 'typescript/unstable/async'
import type { FileSystem as TSFileSystem } from 'typescript/unstable/fs'

import { answerTypeQuery } from './answer-type-query.workflow.js'
import {
  AnswerTypeQueryCommand,
  type CallFacts,
  type CandidateFacts,
  ClassifyCandidateCommand,
  type ContextualTypeFacts,
  type SiteFacts,
} from './CheckerCommands.schema.js'
import { classifyCandidate } from './classify-candidate.workflow.js'
import type { ServerCrash } from './type-query.schema.js'

export const TypeId = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TypeQuery')
export type TypeId = typeof TypeId

const TSQUERY_VERSION = 1

const normalizeFileName = (fileName: string): string => fileName.replace(/\\/g, '/')

const decided = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

const isContextFree = (text: string): boolean => {
  const command = ClassifyCandidateCommand.make({ text })
  const classified = classifyCandidate(command)
  const decision = decided(classified)
  return Match.value(decision).pipe(
    Match.tag('ContextFree', () => true),
    Match.tag('NotContextFree', () => false),
    Match.exhaustive,
  )
}

const unsupportedVersion = (version: number): TypeQueryRefused =>
  TypeQueryRefused.make({
    version: TSQUERY_VERSION,
    reason: 'unsupported-version',
    nextAction: `Send a TypeQueryRequest with version ${TSQUERY_VERSION}; this server received version ${version}.`,
  })

const projectOpenFailed = (tsconfigFile: string, detail: string): TypeQueryRefused =>
  TypeQueryRefused.make({
    version: TSQUERY_VERSION,
    reason: 'project-open-failed',
    nextAction: `Open '${tsconfigFile}' with a valid TypeScript project and retry; opening it failed with: ${detail}`,
  })

const NOT_IN_PROJECT_NEXT_ACTION = 'List the file in the tsconfig project (files/include) or drop it from the request.'

const SERVER_CRASHED_NEXT_ACTION = 'Retry the file; the next file is answered on a fresh tsgo server.'

const crash = <Failure>(failure: Failure): ServerCrash => ({
  _tag: 'ServerCrash',
  detail: failure instanceof Error ? failure.message : String(failure),
})

const tryPromise = <A>(evaluate: () => Promise<A>): Effect.Effect<A, ServerCrash> =>
  Effect.tryPromise({ try: evaluate, catch: crash })

interface Overlay {
  readonly fs: TSFileSystem
  readonly serve: (fileName: string, content: string) => void
}

const makeOverlay = (): Overlay => {
  const files = new Map<string, string>()
  return {
    fs: {
      readFile: (fileName) => files.get(normalizeFileName(fileName)),
      fileExists: (fileName) => (files.has(normalizeFileName(fileName)) ? true : undefined),
      directoryExists: () => undefined,
      getAccessibleEntries: () => undefined,
      realpath: () => undefined,
    },
    serve: (fileName, content) => {
      files.set(normalizeFileName(fileName), content)
    },
  }
}

interface Server {
  readonly tsconfigFile: string
  readonly api: API
  readonly overlay: Overlay
  readonly snapshot: Ref.Ref<Snapshot>
}

const closeApi = (api: API): Effect.Effect<void> => Effect.tryPromise(() => api.close()).pipe(Effect.ignore)

const closeServer = (server: Server): Effect.Effect<void> => closeApi(server.api)

const openServer = (tsconfigFile: string): Effect.Effect<Server, TypeQueryRefused> =>
  Effect.gen(function*() {
    const overlay = makeOverlay()
    const api = yield* Effect.try({
      try: () => new API({ fs: overlay.fs }),
      catch: (cause) => projectOpenFailed(tsconfigFile, crash(cause).detail),
    })
    const snapshot = yield* Effect.tryPromise({
      try: () => api.updateSnapshot({ openProjects: [tsconfigFile] }),
      catch: (cause) => projectOpenFailed(tsconfigFile, crash(cause).detail),
    }).pipe(Effect.tapError(() => closeApi(api)))
    const snapshotRef = yield* Ref.make(snapshot)
    return { tsconfigFile, api, overlay, snapshot: snapshotRef }
  })

type Servers = SynchronizedRef.SynchronizedRef<HashMap.HashMap<string, Server>>

const TypeQueryServers = Handle.make<object, Servers>()(TypeId)

export type TypeQueryServers = Handle.Of<typeof TypeQueryServers>

export const isTypeQueryServers = TypeQueryServers.is

const getOrOpen = (servers: Servers, tsconfigFile: string): Effect.Effect<Server, TypeQueryRefused> =>
  SynchronizedRef.modifyEffect(servers, (map) =>
    Option.match(HashMap.get(map, tsconfigFile), {
      onSome: (server) => Effect.succeed([server, map] as const),
      onNone: () =>
        Effect.map(openServer(tsconfigFile), (server) => [server, HashMap.set(map, tsconfigFile, server)] as const),
    }))

const discardServer = (servers: Servers, tsconfigFile: string): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.modify(servers, (map) => [HashMap.get(map, tsconfigFile), HashMap.remove(map, tsconfigFile)]),
    (removed) => Option.match(removed, { onNone: () => Effect.void, onSome: closeServer }),
  )

const closeAllServers = (servers: Servers): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.getAndSet(servers, HashMap.empty()),
    (map) => Effect.forEach(HashMap.values(map), closeServer, { discard: true }),
  )

const nodeSpanOf = (node: Node): { readonly start: number; readonly end: number } => ({
  start: node.getStart(node.getSourceFile()),
  end: node.end,
})

const childrenOf = (node: Node): ReadonlyArray<Node> => {
  const children: Array<Node> = []
  node.forEachChild((child) => {
    children.push(child)
  })
  return children
}

const spanMatches = (node: Node, start: number, end: number): boolean => {
  const span = nodeSpanOf(node)
  return span.start === start && span.end === end
}

const spanContains = (node: Node, start: number, end: number): boolean => {
  const span = nodeSpanOf(node)
  return span.start <= start && end <= span.end
}

const firstContainingChildOf = (node: Node, start: number, end: number): Option.Option<Node> =>
  Option.flatMap(
    Arr.findFirst(childrenOf(node), (child) => spanContains(child, start, end)),
    (child) => nodeWithSpanOf(child, start, end),
  )

const nodeWithSpanOf = (node: Node, start: number, end: number): Option.Option<Node> =>
  Option.orElse(
    Option.filter(Option.some(node), () => spanMatches(node, start, end)),
    () => firstContainingChildOf(node, start, end),
  )

interface ProbeSlot {
  readonly start: number
  readonly end: number
}

interface Probe {
  readonly text: string
  readonly slots: ReadonlyMap<string, ProbeSlot>
}

const partOf = (text: string): string => `;(${text});`

const buildProbe = (file: TypeQueryFile): Probe => {
  const texts = Arr.dedupe(
    Arr.flatMap(file.sites, (site) =>
      Arr.map(
        Arr.filter(site.candidates, (candidate) => isContextFree(candidate.text)),
        (candidate) => candidate.text,
      )),
  )
  const [, placed] = Arr.mapAccum(texts, file.content.length + 1, (cursor, text) => {
    const part = partOf(text)
    return [cursor + part.length + 1, { text, start: cursor + 2, end: cursor + 2 + text.length }]
  })
  const slots = new Map(placed.map((entry) => [entry.text, { start: entry.start, end: entry.end }] as const))
  const parts = Arr.map(texts, partOf)
  const text = parts.length === 0 ? file.content : `${file.content}\n${parts.join('\n')}`
  return { text, slots }
}

const updateProbe = (server: Server, fileName: string, probeText: string): Effect.Effect<void, ServerCrash> =>
  Effect.gen(function*() {
    server.overlay.serve(fileName, probeText)
    const previous = yield* Ref.get(server.snapshot)
    const next = yield* tryPromise(() =>
      server.api.updateSnapshot({
        openProjects: [server.tsconfigFile],
        fileChanges: { changed: [normalizeFileName(fileName)] },
      })
    )
    yield* Ref.set(server.snapshot, next)
    yield* Effect.tryPromise(() => previous.dispose()).pipe(Effect.ignore)
  })

const projectOf = (server: Server): Effect.Effect<Option.Option<Project>> =>
  Effect.map(Ref.get(server.snapshot), (snapshot) => Option.fromUndefinedOr(snapshot.getProject(server.tsconfigFile)))

const sourceFileIn = (project: Project, fileName: string): Effect.Effect<Option.Option<SourceFile>, ServerCrash> =>
  Effect.map(tryPromise(() => project.program.getSourceFile(fileName)), Option.fromUndefinedOr)

interface SiteReading {
  readonly site: TypeQuerySite
  readonly facts: SiteFacts
  readonly contextType: Option.Option<Type>
  readonly siteType: Option.Option<string>
  readonly contextualText: Option.Option<string>
}

const missingReading = (site: TypeQuerySite): SiteReading => ({
  site,
  facts: { _tag: 'SiteMissing' },
  contextType: Option.none(),
  siteType: Option.none(),
  contextualText: Option.none(),
})

const notExpressionReading = (site: TypeQuerySite, siteType: Option.Option<string>): SiteReading => ({
  site,
  facts: { _tag: 'SiteNotExpression' },
  contextType: Option.none(),
  siteType,
  contextualText: Option.none(),
})

const typeAt = (checker: Checker, node: Node): Effect.Effect<Option.Option<Type>, ServerCrash> =>
  Effect.map(tryPromise(() => checker.getTypeAtLocation(node)), Option.fromUndefinedOr)

const typeTextOf = (checker: Checker, type: Type): Effect.Effect<string, ServerCrash> =>
  tryPromise(() => checker.typeToString(type))

const isInstantiableFlag = (type: Type): boolean => (type.flags & TypeFlags.Instantiable) !== 0

const unionTypesOf = (type: Type): Option.Option<() => Promise<ReadonlyArray<Type>>> => {
  if (!type.isUnionType()) return Option.none()
  const union = type
  return Option.some(() => union.getTypes())
}

const intersectionTypesOf = (type: Type): Option.Option<() => Promise<ReadonlyArray<Type>>> => {
  if (!type.isIntersectionType()) return Option.none()
  const intersection = type
  return Option.some(() => intersection.getTypes())
}

const constituentsOf = (type: Type): Effect.Effect<ReadonlyArray<Type>, ServerCrash> =>
  Option.match(Option.orElse(unionTypesOf(type), () => intersectionTypesOf(type)), {
    onSome: (evaluate) => tryPromise(evaluate),
    onNone: () => Effect.succeed([]),
  })

const instantiableOf = (type: Type): Effect.Effect<boolean, ServerCrash> =>
  Effect.gen(function*() {
    const constituents = yield* constituentsOf(type)
    return Boolean.or(isInstantiableFlag(type), Arr.some(constituents, isInstantiableFlag))
  })

const contextualFactsOf = (checker: Checker, type: Type): Effect.Effect<ContextualTypeFacts, ServerCrash> =>
  Effect.gen(function*() {
    const text = yield* typeTextOf(checker, type)
    const instantiable = yield* instantiableOf(type)
    return { text, isError: type.isErrorType(), instantiable }
  })

const isCallLike = (parent: Node): parent is CallExpression | NewExpression =>
  isCallExpression(parent) || isNewExpression(parent)

const callParentOf = (node: Expression): Option.Option<CallExpression | NewExpression> =>
  Option.flatMap(
    Option.fromUndefinedOr(node.parent),
    (parent) => isCallLike(parent) ? Option.some(parent) : Option.none(),
  )

const isArgumentOf = (parent: CallExpression | NewExpression, node: Expression): boolean =>
  Arr.some(parent.arguments ?? [], (argument) => argument === node)

const argumentParentOf = (node: Expression): Option.Option<CallExpression | NewExpression> =>
  Option.filter(callParentOf(node), (parent) => isArgumentOf(parent, node))

const signatureKindOf = (parent: CallExpression | NewExpression): SignatureKind =>
  isNewExpression(parent) ? SignatureKind.Construct : SignatureKind.Call

const callArgumentFactsOf = (
  checker: Checker,
  parent: CallExpression | NewExpression,
): Effect.Effect<CallFacts, ServerCrash> =>
  Effect.gen(function*() {
    const kind = signatureKindOf(parent)
    const calleeType = yield* typeAt(checker, parent.expression)
    const signatureCount = yield* Option.match(calleeType, {
      onNone: () => Effect.succeed(0),
      onSome: (type) =>
        Effect.map(tryPromise(() => checker.getSignaturesOfType(type, kind)), (signatures) => signatures.length),
    })
    const signature = Option.fromUndefinedOr(yield* tryPromise(() => checker.getResolvedSignature(parent)))
    const resolvedHasTypeParameters = yield* Option.match(signature, {
      onNone: () => Effect.succeed(false),
      onSome: (resolved) =>
        Effect.map(tryPromise(() => resolved.getTypeParameters()), (parameters) => parameters.length > 0),
    })
    return { _tag: 'CallArgument', signatureCount, resolvedHasTypeParameters } as const
  })

const callFactsOf = (checker: Checker, node: Expression): Effect.Effect<CallFacts, ServerCrash> =>
  Option.match(argumentParentOf(node), {
    onNone: () => Effect.succeed({ _tag: 'NotACallArgument' } as const),
    onSome: (parent) => callArgumentFactsOf(checker, parent),
  })

const asExpression = (node: Node): Option.Option<Expression> =>
  Option.flatMap(Option.some(node), (candidate) => isExpression(candidate) ? Option.some(candidate) : Option.none())

const expressionReadingOf = (
  project: Project,
  site: TypeQuerySite,
  node: Expression,
  siteType: Option.Option<string>,
): Effect.Effect<SiteReading, ServerCrash> =>
  Effect.gen(function*() {
    const contextType = yield* Effect.map(
      tryPromise(() => project.checker.getContextualType(node)),
      Option.fromUndefinedOr,
    )
    const contextual = yield* Option.match(contextType, {
      onNone: () => Effect.succeed(Option.none<ContextualTypeFacts>()),
      onSome: (type) => Effect.asSome(contextualFactsOf(project.checker, type)),
    })
    const call = yield* callFactsOf(project.checker, node)
    return {
      site,
      facts: { _tag: 'SiteExpression', contextualType: contextual, call },
      contextType,
      siteType,
      contextualText: Option.map(contextual, (facts) => facts.text),
    }
  })

const readingOf = (project: Project, site: TypeQuerySite, node: Node): Effect.Effect<SiteReading, ServerCrash> =>
  Effect.gen(function*() {
    const siteType = yield* Option.match(yield* typeAt(project.checker, node), {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (type) => Effect.asSome(typeTextOf(project.checker, type)),
    })
    return yield* Option.match(asExpression(node), {
      onNone: () => Effect.succeed(notExpressionReading(site, siteType)),
      onSome: (expression) => expressionReadingOf(project, site, expression, siteType),
    })
  })

const readSite = (
  sourceFile: SourceFile,
  project: Project,
  content: string,
  site: TypeQuerySite,
): Effect.Effect<SiteReading, ServerCrash> => {
  const lineStarts = lineStartsOf(content)
  const range = Option.all([offsetAt(lineStarts, site.location.start), offsetAt(lineStarts, site.location.end)])
  const node = Option.flatMap(range, ([start, end]) => nodeWithSpanOf(sourceFile, start, end))
  return Option.match(node, {
    onNone: () => Effect.succeed(missingReading(site)),
    onSome: (found) => readingOf(project, site, found),
  })
}

const candidateNodeOf = (probe: Probe, sourceFile: SourceFile, candidate: TypeQueryCandidate): Option.Option<Node> =>
  Option.flatMap(
    Option.fromUndefinedOr(probe.slots.get(candidate.text)),
    (found) => nodeWithSpanOf(sourceFile, found.start, found.end),
  )

const typedCandidateFactsOf = (
  project: Project,
  contextType: Option.Option<Type>,
  candidateType: Type,
): Effect.Effect<CandidateFacts, ServerCrash> =>
  Effect.gen(function*() {
    const text = yield* typeTextOf(project.checker, candidateType)
    const assignable = yield* Option.match(contextType, {
      onNone: () => Effect.succeed(false),
      onSome: (contextual) => tryPromise(() => project.checker.isTypeAssignableTo(candidateType, contextual)),
    })
    return { _tag: 'CandidateTyped', candidateType: text, assignable } as const
  })

const contextFreeCandidateFactsOf = (
  probe: Probe,
  sourceFile: SourceFile,
  project: Project,
  contextType: Option.Option<Type>,
  candidate: TypeQueryCandidate,
): Effect.Effect<CandidateFacts, ServerCrash> =>
  Effect.gen(function*() {
    const candidateType = yield* Option.match(candidateNodeOf(probe, sourceFile, candidate), {
      onNone: () => Effect.succeed(Option.none<Type>()),
      onSome: (node) => typeAt(project.checker, node),
    })
    return yield* Option.match(candidateType, {
      onNone: () => Effect.succeed<CandidateFacts>({ _tag: 'CandidateMissing' } as const),
      onSome: (type) => typedCandidateFactsOf(project, contextType, type),
    })
  })

const candidateFactsOf = (
  probe: Probe,
  sourceFile: SourceFile,
  project: Project,
  contextType: Option.Option<Type>,
  candidate: TypeQueryCandidate,
): Effect.Effect<CandidateFacts, ServerCrash> =>
  Boolean.match(isContextFree(candidate.text), {
    onTrue: () => contextFreeCandidateFactsOf(probe, sourceFile, project, contextType, candidate),
    onFalse: () => Effect.succeed({ _tag: 'CandidateNotContextFree' } as const),
  })

const answerCandidate = (
  probe: Probe,
  sourceFile: SourceFile,
  project: Project,
  reading: SiteReading,
  candidate: TypeQueryCandidate,
): Effect.Effect<{ readonly candidateId: string; readonly answer: TypeAnswer }, ServerCrash> =>
  Effect.gen(function*() {
    const facts = yield* candidateFactsOf(probe, sourceFile, project, reading.contextType, candidate)
    const answer = decided(answerTypeQuery(AnswerTypeQueryCommand.make({ site: reading.facts, candidate: facts })))
    return { candidateId: candidate.candidateId, answer }
  })

const answerSite = (
  probe: Probe,
  sourceFile: SourceFile,
  project: Project,
  reading: SiteReading,
): Effect.Effect<SiteAnswer, ServerCrash> =>
  Effect.map(
    Effect.forEach(
      reading.site.candidates,
      (candidate) => answerCandidate(probe, sourceFile, project, reading, candidate),
      { concurrency: 1 },
    ),
    (candidates) => ({
      siteId: reading.site.siteId,
      siteType: reading.siteType,
      contextualType: reading.contextualText,
      candidates,
    }),
  )

const notInProject = (fileName: string): FileOutcome => ({
  _tag: 'FileRefused',
  fileName,
  reason: 'not-in-project',
  nextAction: NOT_IN_PROJECT_NEXT_ACTION,
})

const projectAndFile = (
  server: Server,
  file: TypeQueryFile,
): Effect.Effect<Option.Option<readonly [Project, SourceFile]>, ServerCrash> =>
  Effect.gen(function*() {
    const project = yield* projectOf(server)
    const sourceFile = yield* Option.match(project, {
      onNone: () => Effect.succeed(Option.none<SourceFile>()),
      onSome: (known) => sourceFileIn(known, file.fileName),
    })
    return Option.all([project, sourceFile])
  })

const answeredFile = (
  probe: Probe,
  project: Project,
  sourceFile: SourceFile,
  file: TypeQueryFile,
): Effect.Effect<FileOutcome, ServerCrash> =>
  Effect.gen(function*() {
    const readings = yield* Effect.forEach(
      file.sites,
      (site) => readSite(sourceFile, project, file.content, site),
      { concurrency: 1 },
    )
    const sites = yield* Effect.forEach(
      readings,
      (reading) => answerSite(probe, sourceFile, project, reading),
      { concurrency: 1 },
    )
    return { _tag: 'FileAnswered', fileName: file.fileName, sites }
  })

const answerProjectFile = (server: Server, file: TypeQueryFile): Effect.Effect<FileOutcome, ServerCrash> =>
  Effect.gen(function*() {
    const probe = buildProbe(file)
    yield* updateProbe(server, file.fileName, probe.text)
    const after = yield* projectAndFile(server, file)
    return yield* Option.match(after, {
      onNone: () => Effect.succeed(notInProject(file.fileName)),
      onSome: ([project, sourceFile]) => answeredFile(probe, project, sourceFile, file),
    })
  })

const processFile = (server: Server, file: TypeQueryFile): Effect.Effect<FileOutcome, ServerCrash> =>
  Effect.gen(function*() {
    const before = yield* projectAndFile(server, file)
    return yield* Option.match(before, {
      onNone: () => Effect.succeed(notInProject(file.fileName)),
      onSome: () => answerProjectFile(server, file),
    })
  })

const serveFile = (
  servers: Servers,
  tsconfigFile: string,
  file: TypeQueryFile,
): Effect.Effect<FileOutcome, TypeQueryRefused> =>
  Effect.gen(function*() {
    const server = yield* getOrOpen(servers, tsconfigFile)
    return yield* processFile(server, file).pipe(
      Effect.catchTag('ServerCrash', () =>
        Effect.map(discardServer(servers, tsconfigFile), (): FileOutcome => ({
          _tag: 'FileRefused',
          fileName: file.fileName,
          reason: 'server-crashed',
          nextAction: SERVER_CRASHED_NEXT_ACTION,
        }))),
    )
  })

const makeShape = (servers: Servers): TypeQueryShape => ({
  query: (request: TypeQueryRequest): Effect.Effect<TypeQueryResponse, TypeQueryRefused> =>
    Effect.gen(function*() {
      if (request.version !== TSQUERY_VERSION) {
        return yield* unsupportedVersion(request.version)
      }
      const tsconfigFile = normalizeFileName(request.tsconfigFile)
      const files = yield* Effect.forEach(request.files, (file) => serveFile(servers, tsconfigFile, file), {
        concurrency: 1,
      })
      return { version: TSQUERY_VERSION, files }
    }),
})

export const TypeQueryLive: Layer.Layer<TypeQuery> = Layer.effect(
  TypeQuery,
  Effect.map(
    Effect.acquireRelease(
      Effect.map(
        SynchronizedRef.make<HashMap.HashMap<string, Server>>(HashMap.empty()),
        (servers) => TypeQueryServers.make({}, servers),
      ),
      (self) => closeAllServers(TypeQueryServers.slot(self)),
    ),
    (self) => makeShape(TypeQueryServers.slot(self)),
  ),
)
