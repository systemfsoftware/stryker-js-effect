import { Handle } from '@systemfsoftware/effect-cell-types'
import { lineStartsOf, offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as Semaphore from 'effect/Semaphore'
import * as SynchronizedRef from 'effect/SynchronizedRef'
import {
  type BinaryExpression,
  type CallExpression,
  type Expression,
  type FunctionLikeDeclaration,
  ModifierFlags,
  type NewExpression,
  type Node,
  type SourceFile,
  SyntaxKind,
  type TypeNode,
} from 'typescript/unstable/ast'
import {
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isConditionalExpression,
  isConstructorDeclaration,
  isExpression,
  isFunctionExpression,
  isFunctionLikeDeclaration,
  isGetAccessorDeclaration,
  isIdentifier,
  isNewExpression,
  isNonNullExpression,
  isObjectLiteralExpression,
  isParameterDeclaration,
  isParenthesizedExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isReturnStatement,
  isSatisfiesExpression,
  isSetAccessorDeclaration,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isTypeAssertion,
  isTypeReferenceNode,
  isVariableDeclaration,
} from 'typescript/unstable/ast/is'
import {
  API,
  type Checker,
  type Project,
  type Signature,
  SignatureKind,
  type Snapshot,
  type Type,
  TypeFlags,
} from 'typescript/unstable/async'
import type { FileSystem as TSFileSystem } from 'typescript/unstable/fs'

import { TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import { type AnswerDecision, answerTypeQuery } from './answer-type-query.workflow.js'
import {
  AnswerTypeQueryCommand,
  type CallArgument,
  type CandidateFacts,
  ClassifyCandidateCommand,
  type ContextOrigin,
  type ContextualTypeFacts,
  type FunctionBodyKind,
  type SiteFacts,
  type SiteFunctionBody,
} from './CheckerCommands.schema.js'
import { classifyCandidate } from './classify-candidate.workflow.js'
import type { ServerCrash } from './type-query.schema.js'

export const TypeId = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/TypeQuery')
export type TypeId = typeof TypeId

const REFUSAL_VERSION: TypeQuery.TypeQueryVersion = 2

const servedVersionOf = (version: number): Option.Option<TypeQuery.TypeQueryVersion> =>
  Arr.findFirst(TypeQuery.TypeQueryVersion.literals, (served) => served === version)

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

const unsupportedVersion = (version: number): TypeQuery.TypeQueryRefused =>
  TypeQuery.TypeQueryRefused.make({
    version: REFUSAL_VERSION,
    reason: 'unsupported-version',
    nextAction: `Send a TypeQuery.TypeQueryRequest with version ${
      TypeQuery.TypeQueryVersion.literals.join(' or ')
    }; this server received version ${version}.`,
  })

const functionBodyNeedsVersionTwo = (): TypeQuery.TypeQueryRefused =>
  TypeQuery.TypeQueryRefused.make({
    version: REFUSAL_VERSION,
    reason: 'unsupported-version',
    nextAction:
      'Send a version 2 TypeQuery.TypeQueryRequest for function-body sites; version 1 answers expression sites only.',
  })

const siteKindOf = (site: TypeQuery.TypeQuerySite): TypeQuery.TypeQuerySiteKind => site.kind ?? 'expression'

const hasFunctionBodySite = (request: TypeQuery.TypeQueryRequest): boolean =>
  Arr.some(request.files, (file) => Arr.some(file.sites, (site) => siteKindOf(site) === 'function-body'))

const projectOpenFailed = (tsconfigFile: string, detail: string): TypeQuery.TypeQueryRefused =>
  TypeQuery.TypeQueryRefused.make({
    version: REFUSAL_VERSION,
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
  readonly lock: Semaphore.Semaphore
}

const CLOSE_GRACE = '1 second'

const closeApi = (api: API): Effect.Effect<void> =>
  Effect.tryPromise(() => api.close()).pipe(Effect.timeoutOption(CLOSE_GRACE), Effect.ignore)

const closeServer = (server: Server): Effect.Effect<void> => closeApi(server.api)

const openServer = (tsconfigFile: string): Effect.Effect<Server, TypeQuery.TypeQueryRefused> =>
  Effect.gen(function*() {
    const overlay = makeOverlay()
    const api = yield* Effect.try({
      try: () => new API({ fs: overlay.fs }),
      catch: (cause) => projectOpenFailed(tsconfigFile, crash(cause).detail),
    })
    const snapshot = yield* Effect.tryPromise({
      try: () => api.updateSnapshot({ openProjects: [tsconfigFile] }),
      catch: (cause) => projectOpenFailed(tsconfigFile, crash(cause).detail),
    }).pipe(
      Effect.filterOrFail(
        (opened) => opened.getProject(tsconfigFile) !== undefined,
        () => projectOpenFailed(tsconfigFile, 'tsgo opened no project for this tsconfig'),
      ),
      Effect.tapError(() => closeApi(api)),
    )
    const snapshotRef = yield* Ref.make(snapshot)
    const lock = yield* Semaphore.make(1)
    return { tsconfigFile, api, overlay, snapshot: snapshotRef, lock }
  })

type Servers = SynchronizedRef.SynchronizedRef<HashMap.HashMap<string, Server>>

const TypeQueryServers = Handle.make<object, Servers>()(TypeId)

export type TypeQueryServers = Handle.Of<typeof TypeQueryServers>

export const isTypeQueryServers = TypeQueryServers.is

const getOrOpen = (servers: Servers, tsconfigFile: string): Effect.Effect<Server, TypeQuery.TypeQueryRefused> =>
  SynchronizedRef.modifyEffect(servers, (map) =>
    Option.match(HashMap.get(map, tsconfigFile), {
      onSome: (server) => Effect.succeed([server, map] as const),
      onNone: () =>
        Effect.map(openServer(tsconfigFile), (server) => [server, HashMap.set(map, tsconfigFile, server)] as const),
    }))

const discardServer = (servers: Servers, server: Server): Effect.Effect<void> =>
  Effect.flatMap(
    SynchronizedRef.modify(servers, (map) =>
      Option.match(
        Option.filter(HashMap.get(map, server.tsconfigFile), (current) => current === server),
        {
          onNone: () => [false, map] as const,
          onSome: () => [true, HashMap.remove(map, server.tsconfigFile)] as const,
        },
      )),
    (removed) => Boolean.match(removed, { onFalse: () => Effect.void, onTrue: () => closeServer(server) }),
  )

const isCurrent = (servers: Servers, server: Server): Effect.Effect<boolean> =>
  Effect.map(
    SynchronizedRef.get(servers),
    (map) => Option.exists(HashMap.get(map, server.tsconfigFile), (current) => current === server),
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

const PROBE_OPEN = '\n;('
const PROBE_CLOSE = ');'

const appendProbe = (probe: string, text: string): readonly [string, readonly [string, ProbeSlot]] => {
  const start = probe.length + PROBE_OPEN.length
  return [`${probe}${PROBE_OPEN}${text}${PROBE_CLOSE}`, [text, { start, end: start + text.length }]]
}

const buildProbe = (file: TypeQuery.TypeQueryFile): Probe => {
  const texts = Arr.dedupe(
    Arr.flatMap(file.sites, (site) =>
      Boolean.match(siteKindOf(site) === 'function-body', {
        onTrue: () => Arr.empty<string>(),
        onFalse: () =>
          Arr.map(
            Arr.filter(site.candidates, (candidate) => isContextFree(candidate.text)),
            (candidate) => candidate.text,
          ),
      })),
  )
  const [text, placed] = Arr.mapAccum(texts, file.content, appendProbe)
  return { text, slots: new Map(placed) }
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
  readonly site: TypeQuery.TypeQuerySite
  readonly facts: SiteFacts
  readonly contextType: Option.Option<Type>
  readonly siteType: Option.Option<string>
  readonly contextualText: Option.Option<string>
}

const missingReading = (site: TypeQuery.TypeQuerySite): SiteReading => ({
  site,
  facts: { _tag: 'SiteMissing' },
  contextType: Option.none(),
  siteType: Option.none(),
  contextualText: Option.none(),
})

const notExpressionReading = (site: TypeQuery.TypeQuerySite, siteType: Option.Option<string>): SiteReading => ({
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

const isArgumentOf = (parent: CallExpression | NewExpression, node: Node): boolean =>
  Arr.some(parent.arguments ?? [], (argument) => argument === node)

type Origin = Effect.Effect<ContextOrigin, ServerCrash>
type Link = (checker: Checker, parent: Node, node: Node) => Option.Option<Origin>

const DECLARED_CONTEXT: ContextOrigin = { _tag: 'DeclaredContext' }
const UNENFORCED_CONTEXT: ContextOrigin = { _tag: 'UnenforcedContext' }

const declared = (): Origin => Effect.succeed(DECLARED_CONTEXT)
const unenforced = (): Origin => Effect.succeed(UNENFORCED_CONTEXT)

const linkOf = <N extends Node>(
  guard: (parent: Node) => parent is N,
  resolve: (checker: Checker, parent: N, node: Node) => Origin,
): Link =>
(checker, parent, node) => guard(parent) ? Option.some(resolve(checker, parent, node)) : Option.none()

const climb = (checker: Checker, parent: Node): Origin => originOf(checker, parent)

const whenSlot = (filled: boolean, origin: () => Origin): Origin => filled ? origin() : unenforced()

const SHORT_CIRCUIT_OPERATORS: ReadonlyArray<SyntaxKind> = [
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.AmpersandAmpersandToken,
]

const isConstName = (name: Node): boolean => isIdentifier(name) && name.text === 'const'

const isConstAssertion = (type: TypeNode): boolean => isTypeReferenceNode(type) && isConstName(type.typeName)

const annotatedOrigin = (declaration: { readonly type?: TypeNode | undefined }): Origin =>
  declaration.type === undefined ? unenforced() : declared()

const enclosingFunctionOf = (node: Node): Option.Option<FunctionLikeDeclaration> =>
  Option.flatMap(
    Option.fromUndefinedOr(node.parent),
    (parent) => isFunctionLikeDeclaration(parent) ? Option.some(parent) : enclosingFunctionOf(parent),
  )

const isExpressionFunction = (fn: FunctionLikeDeclaration): boolean => isArrowFunction(fn) || isFunctionExpression(fn)

const unannotatedReturnOrigin = (checker: Checker, fn: FunctionLikeDeclaration): Origin =>
  whenSlot(isExpressionFunction(fn), () => climb(checker, fn))

const returnOrigin = (checker: Checker, fn: FunctionLikeDeclaration): Origin =>
  fn.type === undefined ? unannotatedReturnOrigin(checker, fn) : declared()

const shortCircuitOrigin = (checker: Checker, binary: BinaryExpression): Origin =>
  whenSlot(Arr.contains(SHORT_CIRCUIT_OPERATORS, binary.operatorToken.kind), () => climb(checker, binary))

const operatorOrigin = (checker: Checker, binary: BinaryExpression): Origin =>
  binary.operatorToken.kind === SyntaxKind.EqualsToken ? declared() : shortCircuitOrigin(checker, binary)

const initializerLinkOf = <
  N extends Node & { readonly initializer?: Node | undefined; readonly type?: TypeNode | undefined },
>(
  guard: (parent: Node) => parent is N,
): Link =>
  linkOf(
    guard,
    (_, declaration, node) => whenSlot(declaration.initializer === node, () => annotatedOrigin(declaration)),
  )

const LINKS: ReadonlyArray<Link> = [
  linkOf(isParenthesizedExpression, climb),
  linkOf(isArrayLiteralExpression, climb),
  linkOf(isObjectLiteralExpression, climb),
  linkOf(isSpreadElement, climb),
  linkOf(isSpreadAssignment, climb),
  linkOf(isShorthandPropertyAssignment, climb),
  linkOf(isNonNullExpression, climb),
  linkOf(
    isPropertyAssignment,
    (checker, property, node) => whenSlot(property.initializer === node, () => climb(checker, property)),
  ),
  linkOf(
    isConditionalExpression,
    (checker, conditional, node) => whenSlot(conditional.condition !== node, () => climb(checker, conditional)),
  ),
  linkOf(
    isBinaryExpression,
    (checker, binary, node) => whenSlot(binary.right === node, () => operatorOrigin(checker, binary)),
  ),
  linkOf(
    isAsExpression,
    (checker, assertion) => whenSlot(isConstAssertion(assertion.type), () => climb(checker, assertion)),
  ),
  linkOf(isTypeAssertion, unenforced),
  linkOf(isSatisfiesExpression, declared),
  linkOf(
    isCallLike,
    (checker, call, node) => whenSlot(isArgumentOf(call, node), () => callArgumentFactsOf(checker, call)),
  ),
  linkOf(isArrowFunction, (checker, fn, node) => whenSlot(fn.body === node, () => returnOrigin(checker, fn))),
  linkOf(isReturnStatement, (checker, statement) =>
    Option.match(enclosingFunctionOf(statement), {
      onNone: unenforced,
      onSome: (fn) => returnOrigin(checker, fn),
    })),
  initializerLinkOf(isVariableDeclaration),
  initializerLinkOf(isPropertyDeclaration),
  initializerLinkOf(isParameterDeclaration),
]

const originFromParent = (checker: Checker, parent: Node, node: Node): Origin =>
  Option.getOrElse(Arr.findFirst(LINKS, (link) => link(checker, parent, node)), unenforced)

function originOf(checker: Checker, node: Node): Origin {
  return Option.match(Option.fromUndefinedOr(node.parent), {
    onNone: unenforced,
    onSome: (parent) => originFromParent(checker, parent, node),
  })
}

const signatureKindOf = (parent: CallExpression | NewExpression): SignatureKind =>
  isNewExpression(parent) ? SignatureKind.Construct : SignatureKind.Call

const callArgumentFactsOf = (
  checker: Checker,
  parent: CallExpression | NewExpression,
): Effect.Effect<CallArgument, ServerCrash> =>
  Effect.gen(function*() {
    const calleeType = yield* typeAt(checker, parent.expression)
    const signatures = yield* Option.match(calleeType, {
      onNone: () => Effect.succeed(Arr.empty<Signature>()),
      onSome: (type) => tryPromise(() => checker.getSignaturesOfType(type, signatureKindOf(parent))),
    })
    const typeParameterCounts = yield* Effect.forEach(
      signatures,
      (signature) => Effect.map(tryPromise(() => signature.getTypeParameters()), (parameters) => parameters.length),
    )
    return {
      _tag: 'CallArgument',
      signatureCount: signatures.length,
      declaredGeneric: Arr.some(typeParameterCounts, (count) => count > 0),
    } as const
  })

const asExpression = (node: Node): Option.Option<Expression> =>
  Option.flatMap(Option.some(node), (candidate) => isExpression(candidate) ? Option.some(candidate) : Option.none())

const expressionReadingOf = (
  project: Project,
  site: TypeQuery.TypeQuerySite,
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
    const origin = yield* originOf(project.checker, node)
    return {
      site,
      facts: { _tag: 'SiteExpression', contextualType: contextual, origin },
      contextType,
      siteType,
      contextualText: Option.map(contextual, (facts) => facts.text),
    }
  })

const readingOf = (
  project: Project,
  site: TypeQuery.TypeQuerySite,
  node: Node,
): Effect.Effect<SiteReading, ServerCrash> =>
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

const notFunctionBodyReading = (site: TypeQuery.TypeQuerySite): SiteReading => ({
  site,
  facts: { _tag: 'SiteNotFunctionBody' },
  contextType: Option.none(),
  siteType: Option.none(),
  contextualText: Option.none(),
})

const asyncOf = (fn: FunctionLikeDeclaration): boolean => (fn.modifierFlags & ModifierFlags.Async) !== 0

const functionLikeBodyOf = (node: Node): Option.Option<FunctionLikeDeclaration> =>
  Boolean.match(isBlock(node), {
    onFalse: () => Option.none(),
    onTrue: () =>
      Option.filter(
        Option.flatMap(
          Option.fromUndefinedOr(node.parent),
          (parent) => Option.filter(Option.some(parent), isFunctionLikeDeclaration),
        ),
        (fn) => fn.body === node,
      ),
  })

const FUNCTION_BODY_KIND_GUARDS: ReadonlyArray<
  readonly [(fn: FunctionLikeDeclaration) => boolean, FunctionBodyKind]
> = [
  [isGetAccessorDeclaration, 'getter'],
  [isSetAccessorDeclaration, 'setter'],
  [isConstructorDeclaration, 'constructor'],
]

const functionKindOf = (fn: FunctionLikeDeclaration): FunctionBodyKind =>
  Option.getOrElse(
    Option.map(Arr.findFirst(FUNCTION_BODY_KIND_GUARDS, ([guard]) => guard(fn)), ([, kind]) => kind),
    () => 'other',
  )

const promiseArgumentOf = (fn: FunctionLikeDeclaration): Option.Option<TypeNode> =>
  Option.flatMap(
    Option.fromUndefinedOr(fn.type),
    (annotation) =>
      Option.flatMap(Option.filter(Option.some(annotation), isTypeReferenceNode), (reference) =>
        Option.flatMap(Option.filter(Option.some(reference.typeName), isIdentifier), (name) =>
          Boolean.match(name.text === 'Promise', {
            onTrue: () =>
              Arr.head(reference.typeArguments ?? []),
            onFalse: () =>
              Option.none(),
          }))),
  )

const promiseArgumentForTargetOf = (fn: FunctionLikeDeclaration): Option.Option<TypeNode> =>
  Boolean.match(asyncOf(fn), {
    onTrue: () => promiseArgumentOf(fn),
    onFalse: () => Option.none(),
  })

const isVoidLikeFlag = (type: Type): boolean =>
  (type.flags & (TypeFlags.Void | TypeFlags.Undefined | TypeFlags.Any)) !== 0

const allowsImplicitReturnOf = (type: Type): Effect.Effect<boolean, ServerCrash> =>
  Boolean.match(isVoidLikeFlag(type), {
    onTrue: () => Effect.succeed(true),
    onFalse: () =>
      Effect.map(
        Option.match(unionTypesOf(type), {
          onNone: () => Effect.succeed(Arr.empty<Type>()),
          onSome: (evaluate) => tryPromise(evaluate),
        }),
        (members) => Arr.some(members, (member) => (member.flags & TypeFlags.Void) !== 0),
      ),
  })

const signatureReturnTypeOf = (
  checker: Checker,
  fn: FunctionLikeDeclaration,
): Effect.Effect<Option.Option<Type>, ServerCrash> =>
  Effect.gen(function*() {
    const signature = yield* tryPromise(() => checker.getSignatureFromDeclaration(fn))
    return yield* Option.match(Option.fromUndefinedOr(signature), {
      onNone: () => Effect.succeed(Option.none<Type>()),
      onSome: (found) => Effect.map(tryPromise(() => checker.getReturnTypeOfSignature(found)), Option.fromUndefinedOr),
    })
  })

const targetTypeOf = (
  checker: Checker,
  fn: FunctionLikeDeclaration,
): Effect.Effect<Option.Option<Type>, ServerCrash> =>
  Option.match(promiseArgumentForTargetOf(fn), {
    onNone: () => signatureReturnTypeOf(checker, fn),
    onSome: (argument) => Effect.map(tryPromise(() => checker.getTypeFromTypeNode(argument)), Option.fromUndefinedOr),
  })

const functionBodyFactsOf = (
  checker: Checker,
  fn: FunctionLikeDeclaration,
): Effect.Effect<SiteFunctionBody, ServerCrash> =>
  Effect.gen(function*() {
    const targetType = yield* targetTypeOf(checker, fn)
    const target = yield* Option.match(targetType, {
      onNone: () => Effect.succeed(Option.none<ContextualTypeFacts>()),
      onSome: (type) => Effect.asSome(contextualFactsOf(checker, type)),
    })
    const undefinedType = yield* tryPromise(() => checker.getUndefinedType())
    const undefinedAssignable = yield* Option.match(targetType, {
      onNone: () => Effect.succeed(false),
      onSome: (type) => tryPromise(() => checker.isTypeAssignableTo(undefinedType, type)),
    })
    const targetAllowsImplicitReturn = yield* Option.match(targetType, {
      onNone: () => Effect.succeed(false),
      onSome: allowsImplicitReturnOf,
    })
    return {
      _tag: 'SiteFunctionBody',
      functionKind: functionKindOf(fn),
      generator: fn.asteriskToken !== undefined,
      async: asyncOf(fn),
      returnTypeDeclared: fn.type !== undefined,
      asyncReturnIsPromise: Boolean.and(asyncOf(fn), Option.isSome(promiseArgumentOf(fn))),
      target,
      undefinedAssignable,
      targetAllowsImplicitReturn,
    } as const
  })

const functionBodyReading = (
  project: Project,
  site: TypeQuery.TypeQuerySite,
  node: Node,
): Effect.Effect<SiteReading, ServerCrash> =>
  Option.match(functionLikeBodyOf(node), {
    onNone: () => Effect.succeed(notFunctionBodyReading(site)),
    onSome: (fn) =>
      Effect.map(functionBodyFactsOf(project.checker, fn), (facts) => ({
        site,
        facts,
        contextType: Option.none(),
        siteType: Option.none(),
        contextualText: Option.map(facts.target, (target) => target.text),
      })),
  })

const readSite = (
  sourceFile: SourceFile,
  project: Project,
  content: string,
  site: TypeQuery.TypeQuerySite,
): Effect.Effect<SiteReading, ServerCrash> => {
  const lineStarts = lineStartsOf(content)
  const range = Option.all([offsetAt(lineStarts, site.location.start), offsetAt(lineStarts, site.location.end)])
  const node = Option.flatMap(range, ([start, end]) => nodeWithSpanOf(sourceFile, start, end))
  return Option.match(node, {
    onNone: () => Effect.succeed(missingReading(site)),
    onSome: (found) =>
      Boolean.match(siteKindOf(site) === 'function-body', {
        onTrue: () => functionBodyReading(project, site, found),
        onFalse: () => readingOf(project, site, found),
      }),
  })
}

const candidateNodeOf = (
  probe: Probe,
  sourceFile: SourceFile,
  candidate: TypeQuery.TypeQueryCandidate,
): Option.Option<Node> =>
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
  candidate: TypeQuery.TypeQueryCandidate,
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
  candidate: TypeQuery.TypeQueryCandidate,
): Effect.Effect<CandidateFacts, ServerCrash> =>
  Boolean.match(isContextFree(candidate.text), {
    onTrue: () => contextFreeCandidateFactsOf(probe, sourceFile, project, contextType, candidate),
    onFalse: () => Effect.succeed({ _tag: 'CandidateNotContextFree' } as const),
  })

const portAnswerOf = (decision: AnswerDecision): TypeQuery.TypeAnswer =>
  Match.valueTags(decision, {
    AnswerAssignable: ({ candidateType }) => TypeQuery.Assignable.make({ candidateType }),
    AnswerNotAssignable: ({ candidateType, contextualType }) =>
      TypeQuery.NotAssignable.make({ candidateType, contextualType }),
    AnswerUnknown: ({ reason }) => TypeQuery.Unknown.make({ reason }),
  })

const answerCandidate = (
  probe: Probe,
  sourceFile: SourceFile,
  project: Project,
  reading: SiteReading,
  candidate: TypeQuery.TypeQueryCandidate,
): Effect.Effect<{ readonly candidateId: string; readonly answer: TypeQuery.TypeAnswer }, ServerCrash> =>
  Effect.gen(function*() {
    const facts = yield* Boolean.match(siteKindOf(reading.site) === 'function-body', {
      onTrue: () => Effect.succeed<CandidateFacts>({ _tag: 'CandidateBodyText', text: candidate.text } as const),
      onFalse: () => candidateFactsOf(probe, sourceFile, project, reading.contextType, candidate),
    })
    const decision = decided(answerTypeQuery(AnswerTypeQueryCommand.make({ site: reading.facts, candidate: facts })))
    return { candidateId: candidate.candidateId, answer: portAnswerOf(decision) }
  })

const answerSite = (
  probe: Probe,
  sourceFile: SourceFile,
  project: Project,
  reading: SiteReading,
): Effect.Effect<TypeQuery.SiteAnswer, ServerCrash> =>
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

const notInProject = (fileName: string): TypeQuery.FileOutcome => ({
  _tag: 'FileRefused',
  fileName,
  reason: 'not-in-project',
  nextAction: NOT_IN_PROJECT_NEXT_ACTION,
})

const projectAndFile = (
  server: Server,
  file: TypeQuery.TypeQueryFile,
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
  file: TypeQuery.TypeQueryFile,
): Effect.Effect<TypeQuery.FileOutcome, ServerCrash> =>
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

const answerProjectFile = (
  server: Server,
  file: TypeQuery.TypeQueryFile,
): Effect.Effect<TypeQuery.FileOutcome, ServerCrash> =>
  Effect.gen(function*() {
    const probe = buildProbe(file)
    yield* updateProbe(server, file.fileName, probe.text)
    const after = yield* projectAndFile(server, file)
    return yield* Option.match(after, {
      onNone: () => Effect.succeed(notInProject(file.fileName)),
      onSome: ([project, sourceFile]) => answeredFile(probe, project, sourceFile, file),
    })
  })

const processFile = (
  server: Server,
  file: TypeQuery.TypeQueryFile,
): Effect.Effect<TypeQuery.FileOutcome, ServerCrash> =>
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
  file: TypeQuery.TypeQueryFile,
): Effect.Effect<TypeQuery.FileOutcome, TypeQuery.TypeQueryRefused> =>
  Effect.flatMap(getOrOpen(servers, tsconfigFile), (server) =>
    Semaphore.withPermit(
      server.lock,
      Effect.flatMap(isCurrent(servers, server), (current) =>
        Boolean.match(current, {
          onFalse: () => Effect.suspend(() => serveFile(servers, tsconfigFile, file)),
          onTrue: () =>
            processFile(server, file).pipe(
              Effect.catchTag('ServerCrash', () =>
                Effect.as(
                  discardServer(servers, server),
                  {
                    _tag: 'FileRefused',
                    fileName: file.fileName,
                    reason: 'server-crashed',
                    nextAction: SERVER_CRASHED_NEXT_ACTION,
                  } satisfies TypeQuery.FileOutcome,
                )),
            ),
        })),
    ))

const makeShape = (servers: Servers): TypeQuery.TypeQueryShape => ({
  query: (
    request: TypeQuery.TypeQueryRequest,
  ): Effect.Effect<TypeQuery.TypeQueryResponse, TypeQuery.TypeQueryRefused> =>
    Effect.gen(function*() {
      const version = yield* Effect.fromOption(servedVersionOf(request.version), () =>
        unsupportedVersion(request.version))
      const tsconfigFile = normalizeFileName(request.tsconfigFile)
      const files = yield* Boolean.match(Boolean.and(version === 1, hasFunctionBodySite(request)), {
        onTrue: () =>
          Effect.fail(functionBodyNeedsVersionTwo()),
        onFalse: () =>
          Effect.forEach(request.files, (file) => serveFile(servers, tsconfigFile, file), { concurrency: 1 }),
      })
      return { version, files }
    }),
})

export const TypeQueryLive: Layer.Layer<TypeQuery.TypeQuery> = Layer.effect(
  TypeQuery.TypeQuery,
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
