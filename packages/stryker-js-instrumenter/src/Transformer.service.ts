import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import type {
  ArrowFunctionExpression,
  ClassExpression,
  Expression,
  FunctionExpression,
  IdentifierReference,
  MemberExpression,
  Node,
  Program,
  Statement,
  VariableDeclarator,
} from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  arrowFunctionExpression,
  attachComments,
  blockStatement,
  callExpression,
  cloneNode,
  conditionalExpression,
  expressionStatement,
  identifier,
  ifStatement,
  isExpressionKind,
  isStatementKind,
  make,
  nodeType,
  returnStatement,
  sequenceExpression,
  spanOf,
  stringLiteral,
  switchCase,
  traverse,
  type TraversePath,
  variableDeclaration,
  variableDeclarator,
} from './Ast.handle.js'
import type {
  Ast,
  AstByFormat,
  ScriptAst,
  SourceLocationInFile,
  SpannedComment,
  TemplateScript,
} from './Ast.schema.js'
import { AstFormat } from './Syntax.schema.js'
import { type MutateDescription } from './Instrument.schema.js'
import { LineTable, LineTableFromText, type Position } from './Location.schema.js'
import { InstrumenterContext as ID } from './Mutant.schema.js'
import {
  Mutators,
  type Mutant,
  type MutatorsShape,
  type Mutable,
  type MutatorContext,
  type MutatorOptions,
} from './Mutator.service.js'
import { Parser } from './Parser.service.js'
import type { ParserError, ParserShape } from './Parser.service.js'
import { ParseFailed } from './Parser.schema.js'
import {
  CommentLocationMissing,
  DirectiveIncomplete,
  HeaderEmpty,
  MutantPlacementFailed,
  MutantsUnplaced,
  NodeKindMismatch,
  PlacementMissing,
  type TransformerFailure,
} from './Transformer.schema.js'

const STRYKER_NAMESPACE_HELPER = 'stryNS_9fa48'
const comparePositions = (a: Position, b: Position): number => {
  const lineDelta = a.line - b.line
  return Boolean.match(lineDelta !== 0, {
    onTrue: () => lineDelta,
    onFalse: () => a.column - b.column,
  })
}

const locationIncluded = (haystack: SourceLocationInFile, needle: SourceLocationInFile): boolean =>
  comparePositions(haystack.start, needle.start) <= 0 && comparePositions(haystack.end, needle.end) >= 0

const locationOverlaps = (a: SourceLocationInFile, b: SourceLocationInFile): boolean =>
  comparePositions(a.start, b.end) <= 0 && comparePositions(a.end, b.start) >= 0

const COVER_MUTANT_HELPER = 'stryCov_9fa48'
const IS_MUTANT_ACTIVE_HELPER = 'stryMutAct_9fa48'

export interface TransformerOptions extends MutatorOptions {
  ignorers: readonly Ignorer[]
}
export type MutantCollector = Mutant[]

export type Transform = {
  (
    mutantCollector: MutantCollector,
    transformerContext: Omit<TransformerContext, 'transform'>,
  ): (ast: Ast) => Effect.Effect<readonly string[], ParseFailed>
  (
    ast: Ast,
    mutantCollector: MutantCollector,
    transformerContext: Omit<TransformerContext, 'transform'>,
  ): Effect.Effect<readonly string[], ParseFailed>
}

export interface TransformerShape {
  readonly transform: Transform
}

export class Transformer
  extends Context.Service<Transformer, TransformerShape>()('@systemfsoftware/stryker-js-instrumenter/Transformer.service/Transformer')
{
  static readonly layer: Layer.Layer<Transformer, ParserError, Parser | Mutators> = Layer.effect(
    Transformer,
    Effect.flatMap(Parser, (parser) =>
      Effect.flatMap(Mutators, (mutators) =>
        Effect.map(instrumentationHeaderOf(parser), (header) => Transformer.of({ transform: transformOf(header, mutators) })))),
  )
}

function hasPlacedMutants(
  collector: readonly Mutant[],
  fileName: string,
): boolean {
  return collector.some(
    (mutant) => mutant.fileName === fileName && mutant.ignoreReason === undefined,
  )
}

const WILDCARD = 'all'
const DEFAULT_REASON = 'Ignored using a comment'
const NO_CHILDREN: readonly Node[] = Object.freeze([])

const strykerCommentDirectiveRegex = /^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)(?::(.+)?)?/

type Rule =
  | { readonly kind: 'Root' }
  | {
    readonly kind: 'Ignore'
    readonly mutatorNames: readonly string[]
    readonly line: number | undefined
    readonly ignoreReason: string
    readonly previous: Rule
  }
  | {
    readonly kind: 'Restore'
    readonly mutatorNames: readonly string[]
    readonly line: number | undefined
    readonly previous: Rule
  }

const rootRule: Rule = { kind: 'Root' }

type IgnoreRule = Extract<Rule, { kind: 'Ignore' }>
type RestoreRule = Extract<Rule, { kind: 'Restore' }>

const findIgnoreReason = (
  rule: Rule,
  mutatorName: string,
  line: number,
): string | undefined =>
  Option.getOrUndefined(ignoreReasonIn(rule, mutatorName.toLowerCase(), line))

const ignoreReasonIn = (
  rule: Rule,
  lowerMutatorName: string,
  line: number,
): Option.Option<string> =>
  Match.value(rule).pipe(
    Match.when({ kind: 'Ignore' }, (ignore) => directiveOutcome(ignore, lowerMutatorName, line)),
    Match.when({ kind: 'Restore' }, (restore) => directiveOutcome(restore, lowerMutatorName, line)),
    Match.when({ kind: 'Root' }, () => Option.none<string>()),
    Match.exhaustive,
  )

const directiveOutcome = (
  directive: IgnoreRule | RestoreRule,
  lowerMutatorName: string,
  line: number,
): Option.Option<string> =>
  Match.value(directiveApplies(directive, lowerMutatorName, line)).pipe(
    Match.when(false, () => ignoreReasonIn(directive.previous, lowerMutatorName, line)),
    Match.when(true, () =>
      Match.value(directive).pipe(
        Match.when({ kind: 'Ignore' }, (ignore) => Option.some(ignore.ignoreReason)),
        Match.when({ kind: 'Restore' }, () => Option.none<string>()),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const directiveApplies = (
  directive: IgnoreRule | RestoreRule,
  lowerMutatorName: string,
  line: number,
): boolean =>
  Option.match(Option.fromNullishOr(directive.line), {
    onNone: () => true,
    onSome: (directiveLine) => directiveLine === line,
  }) && directive.mutatorNames.some((name) => name === lowerMutatorName || name === WILDCARD)

interface LocatedComment extends SpannedComment {
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}

interface CommentLocation {
  readonly start: { readonly line: number; readonly column: number }
  readonly end: { readonly line: number; readonly column: number }
}

interface StrykerDirective {
  readonly type: string
  readonly scope: string | undefined
  readonly mutatorNames: readonly string[]
  readonly reason: string
  readonly loc: CommentLocation
}

interface NodeWithLeadingComments {
  readonly leadingComments?: readonly LocatedComment[]
}

const NO_COMMENTS: readonly LocatedComment[] = []

const processStrykerDirectives = (
  rule: Rule,
  node: Node,
  allMutatorNames: readonly string[],
  originFileName: string,
): { rule: Rule; warnings: readonly string[]; failure: Option.Option<DirectiveIncomplete | CommentLocationMissing> } => {
  const outcomes = Arr.map(attachedComments(node), parseStrykerDirective)
  const parsed = Arr.getSomes(outcomes)
  const directives = Arr.filterMap(parsed, (result) => result)
  const failure = Arr.head(Arr.filterMap(parsed, Result.flip))
  const warnings = directives.flatMap((directive) => mutatorWarnings(directive, allMutatorNames, originFileName))
  return { rule: directives.reduce(applyStrykerDirective, rule), warnings, failure }
}

const attachedComments = (node: Node): readonly LocatedComment[] => leadingCommentsOn(node) ?? NO_COMMENTS

const leadingCommentsOn = (value: object): readonly LocatedComment[] | undefined =>
  Option.getOrUndefined(Option.flatMap(Option.some(value), leadingCommentsIn))

const leadingCommentsIn = (value: object): Option.Option<readonly LocatedComment[] | undefined> =>
  Option.map(Option.filter(Option.some(value), isCommentBearing), (bearing) => bearing.leadingComments)

const isCommentBearing = (value: unknown): value is NodeWithLeadingComments =>
  Predicate.hasProperty(value, 'leadingComments')

const parseStrykerDirective = (
  comment: LocatedComment,
): Option.Option<Result.Result<StrykerDirective, DirectiveIncomplete | CommentLocationMissing>> =>
  Option.map(
    Option.fromNullishOr(strykerCommentDirectiveRegex.exec(comment.value)),
    (match) => strykerDirective(match, comment.loc),
  )

const strykerDirective = (
  match: RegExpExecArray,
  loc: LocatedComment['loc'],
): Result.Result<StrykerDirective, DirectiveIncomplete | CommentLocationMissing> =>
  Result.flatMap(matchGroup(match, 1), (type) =>
    Result.flatMap(matchGroup(match, 3), (names) =>
      Result.map(commentLocation(loc), (located) => ({
        type,
        scope: match[2],
        mutatorNames: names.split(',').map((mutator) => mutator.trim()),
        reason: (match[4] ?? DEFAULT_REASON).trim(),
        loc: located,
      }))))

const matchGroup = (match: RegExpExecArray, group: number): Result.Result<string, DirectiveIncomplete> =>
  Result.fromOption(Option.fromNullishOr(match[group]), () => DirectiveIncomplete.make())

const commentLocation = (loc: LocatedComment['loc']): Result.Result<CommentLocation, CommentLocationMissing> =>
  Result.fromOption(Option.fromNullishOr(loc), () => CommentLocationMissing.make())

const applyStrykerDirective = (rule: Rule, directive: StrykerDirective): Rule =>
  Match.value(directive.type).pipe(
    Match.when('disable', () => ignoreRuleFor(rule, directive)),
    Match.when('restore', () => restoreRuleFor(rule, directive)),
    Match.orElse(() => rule),
  )

const ignoreRuleFor = (rule: Rule, directive: StrykerDirective): Rule => ({
  kind: 'Ignore',
  mutatorNames: directive.mutatorNames.map((mutatorName) => mutatorName.toLowerCase()),
  line: directiveLine(directive),
  ignoreReason: directive.reason,
  previous: rule,
})

const restoreRuleFor = (rule: Rule, directive: StrykerDirective): Rule => ({
  kind: 'Restore',
  mutatorNames: directive.mutatorNames.map((mutatorName) => mutatorName.toLowerCase()),
  line: directiveLine(directive),
  previous: rule,
})

const directiveLine = (directive: StrykerDirective): number | undefined =>
  Match.value(directive.scope).pipe(
    Match.when('next-line', () => directive.loc.start.line),
    Match.orElse(() => undefined),
  )

const mutatorWarnings = (
  directive: StrykerDirective,
  allMutatorNames: readonly string[],
  originFileName: string,
): readonly string[] =>
  directive.mutatorNames
    .filter((mutatorName) => mutatorName !== WILDCARD)
    .filter((mutatorName) => !allMutatorNames.includes(mutatorName.toLowerCase()))
    .map((mutatorName) => mutatorWarning(directive, mutatorName, originFileName))

const mutatorWarning = (directive: StrykerDirective, mutatorName: string, originFileName: string): string => {
  const loc = directive.loc
  const label = Option.match(Option.filter(Option.fromNullishOr(directive.scope), (scope) => scope !== ''), {
    onNone: () => directive.type,
    onSome: (scope) => `${directive.type} ${scope}`,
  })
  return `Unused 'Stryker ${label}' directive. Mutator with name '${mutatorName}' not found. Directive found at: ${originFileName}:${loc.start.line}:${loc.start.column}.`
}

const ancestorsOf = (path: TraversePath): Array<Node> =>
  Option.match(Option.fromNullishOr(path.parentPath), {
    onNone: () => [],
    onSome: (parent) => [parent.node, ...ancestorsOf(parent)],
  })

const isTypeNode = (path: TraversePath): boolean =>
  [
    tsTypeAnnotationNodeTypes.includes(path.node.type),
    flowTypeAnnotationNodeTypes.includes(path.node.type),
    isDeclareVariableStatement(path.node),
    isDeclareModule(path.node),
  ].some((isType) => isType)

const isDeclareVariableStatement = (node: Node): boolean => isDeclared(node) && nodeType(node) === 'VariableDeclaration'

const isDeclareModule = (node: Node): boolean => isDeclared(node) && nodeType(node) === 'TSModuleDeclaration'

const isDeclared = (node: Node): boolean => 'declare' in node && node.declare === true

const tsTypeAnnotationNodeTypes: ReadonlyArray<string> = Object.freeze([
  'TSInterfaceDeclaration',
  'TSTypeAnnotation',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
  'TSDeclareFunction',
  'TSTypeParameterInstantiation',
  'TSTypeParameterDeclaration',
])

const flowTypeAnnotationNodeTypes: ReadonlyArray<string> = Object.freeze([
  'DeclareClass',
  'DeclareFunction',
  'DeclareInterface',
  'DeclareModule',
  'DeclareModuleExports',
  'DeclareTypeAlias',
  'DeclareOpaqueType',
  'DeclareVariable',
  'DeclareExportDeclaration',
  'DeclareExportAllDeclaration',
  'InterfaceDeclaration',
  'OpaqueType',
  'TypeAlias',
])

const isImportDeclaration = (path: TraversePath): boolean =>
  nodeType(path.node) === 'TSImportEqualsDeclaration' || path.node.type === 'ImportDeclaration'

const mutantTestExpression = (mutantId: string): Expression =>
  callExpression(identifier(IS_MUTANT_ACTIVE_HELPER), [stringLiteral(mutantId)])

const mutationCoverageSequenceExpression = (
  mutants: Iterable<Mutant>,
  targetExpression?: Expression,
): Expression => {
  const mutantIds = [...mutants].map((mutant) => stringLiteral(mutant.id))
  return sequenceExpression(
    Arr.appendAll([callExpression(identifier(COVER_MUTANT_HELPER), mutantIds)], Option.toArray(Option.fromUndefinedOr(targetExpression))),
  )
}

interface MutantPlacer {
  readonly name: string
  canPlace(path: TraversePath): boolean
  place(path: TraversePath, appliedMutants: Map<Mutant, Node>): Result.Result<void, NodeKindMismatch>
}

const nodeOfKind = <T extends Node>(
  mutant: Mutant,
  node: Node,
  isKind: (candidate: Node) => candidate is T,
  kind: string,
): Result.Result<T, NodeKindMismatch> => narrowNode(node, isKind, kind, Option.some(mutant.id))

const narrowNode = <T extends Node>(
  node: Node,
  isKind: (candidate: Node) => candidate is T,
  kind: string,
  mutantId: Option.Option<string> = Option.none(),
): Result.Result<T, NodeKindMismatch> =>
  Result.fromOption(
    Option.filter(Option.some(node), isKind),
    () => NodeKindMismatch.make({ expected: kind, actual: node.type, mutantId: Option.getOrUndefined(mutantId) }),
  )

const expressionOf = (node: Node): Result.Result<Expression, NodeKindMismatch> =>
  narrowNode(node, isExpressionKind, 'an expression')

const statementOf = (node: Node): Result.Result<Statement, NodeKindMismatch> =>
  narrowNode(node, isStatementKind, 'a statement')

interface SwitchCaseShape {
  readonly test: Expression | null
  readonly consequent: Statement[]
}

const isSwitchCaseNode = (node: Node): node is Node & SwitchCaseShape => nodeType(node) === 'SwitchCase'

const switchCaseOf = (node: Node): Result.Result<Node & SwitchCaseShape, NodeKindMismatch> =>
  narrowNode(node, isSwitchCaseNode, 'a switch case')

const fileNameWithin = (basePath: string | undefined, fileName: string): string =>
  Option.getOrElse(Option.map(Option.fromUndefinedOr(basePath), (base) => relativeTo(base, fileName)), () => fileName)

const placementLocation = (node: Node, lineTable: LineTable, basePath: string | undefined, fileName: string): PlacementSite => {
  const relativeFile = fileNameWithin(basePath, fileName)
  return Option.match(Option.fromNullishOr(spanOf(node)), {
    onNone: () => ({ fileName: relativeFile, line: undefined, column: undefined }),
    onSome: (span) => {
      const at = lineTable.positionAt(span.start)
      return { fileName: relativeFile, line: at.line, column: at.column }
    },
  })
}

interface PlacementSite {
  readonly fileName: string
  readonly line: number | undefined
  readonly column: number | undefined
}

type AnonymousFunctionOrClass = FunctionExpression | ClassExpression

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

const withTrailingSlash = (basePath: string): string => {
  const normalized = normalizeSeparators(basePath)
  return Boolean.match(normalized.endsWith('/'), {
    onTrue: () => normalized,
    onFalse: () => `${normalized}/`,
  })
}

const relativeTo = (basePath: string, fileName: string): string => {
  const prefix = withTrailingSlash(basePath)
  const normalizedFile = normalizeSeparators(fileName)
  return Boolean.match(normalizedFile.startsWith(prefix), {
    onTrue: () => normalizedFile.slice(prefix.length),
    onFalse: () => fileName,
  })
}

const classOrFunctionExpressionNamedIfNeeded = (path: TraversePath): Option.Option<Expression> =>
  Match.value(path.node).pipe(
    Match.when(isAnonymousFunctionOrClass, (node) => nameFromParent(path, node)),
    Match.orElse(() => Option.none()),
  )

const nameFromParent = (path: TraversePath, node: AnonymousFunctionOrClass): Option.Option<Expression> =>
  Match.value(path.parentPath?.node).pipe(
    Match.when(isVariableDeclarator, (declarator) => adoptDeclaredName(node, declarator)),
    Match.when({ type: 'Property', key: { type: 'Identifier' } }, () => namedPropertyValue(path, node)),
    Match.orElse(() => Option.none()),
  )

const namedPropertyValue = (path: TraversePath, node: AnonymousFunctionOrClass): Option.Option<Expression> =>
  Match.value(path.getStatementParent()?.node.type).pipe(
    Match.when('VariableDeclaration', () => Option.some<Expression>(node)),
    Match.orElse(() => Option.none()),
  )

const adoptIdentifier = (node: AnonymousFunctionOrClass, identifier: IdentifierReference): Expression => {
  node.id = identifier
  return node
}

const isAnonymousFunctionOrClass = (node: Node): node is AnonymousFunctionOrClass =>
  isFunctionOrClassExpression(node) && node.id == null

const isFunctionOrClassExpression = (node: Node): node is AnonymousFunctionOrClass =>
  node.type === 'FunctionExpression' || node.type === 'ClassExpression'

const arrowFunctionExpressionNamedIfNeeded = (path: TraversePath): Option.Option<Expression> =>
  Match.value(path.node).pipe(
    Match.when({ type: 'ArrowFunctionExpression' }, (node) => arrowNamedByDeclarator(node, path.parentPath)),
    Match.orElse(() => Option.none()),
  )

const arrowNamedByDeclarator = (
  node: ArrowFunctionExpression,
  parentPath: TraversePath | null,
): Option.Option<Expression> =>
  Option.match(declaratorIdentifier(parentPath), {
    onNone: () => Option.none(),
    onSome: (identifier) => Option.some(namedArrowExpression(node, identifier)),
  })

const namedArrowExpression = (node: ArrowFunctionExpression, identifier: IdentifierReference): Expression => {
  const declaration = variableDeclaration('const', [variableDeclarator(identifier, node)])
  return callExpression(
    arrowFunctionExpression([], blockStatement([declaration, returnStatement(identifier)])),
    [],
  )
}

const declaratorIdentifier = (parentPath: TraversePath | null): Option.Option<IdentifierReference> =>
  Option.flatMap(Option.fromNullishOr(parentPath), (parent) =>
    Match.value(parent.node).pipe(
      Match.when(isVariableDeclarator, (declarator) => declaredName(declarator)),
      Match.orElse(() => Option.none<IdentifierReference>()),
    ))

const isVariableDeclarator = (node: unknown): node is VariableDeclarator => nodeType(node) === 'VariableDeclarator'

const adoptDeclaredName = (node: AnonymousFunctionOrClass, declarator: VariableDeclarator): Option.Option<Expression> =>
  Option.match(declaredName(declarator), {
    onNone: () => Option.none(),
    onSome: (identifier) => Option.some(adoptIdentifier(node, identifier)),
  })

const declaredName = (declarator: VariableDeclarator): Option.Option<IdentifierReference> =>
  Match.value(declarator.id).pipe(
    Match.when(isIdentifierReference, (identifier) => Option.some(identifier)),
    Match.orElse(() => Option.none<IdentifierReference>()),
  )

const isIdentifierReference = (node: unknown): node is IdentifierReference => nodeType(node) === 'Identifier'

const nameIfAnonymous = (path: TraversePath): Result.Result<Expression, NodeKindMismatch> =>
  Option.match(classOrFunctionExpressionNamedIfNeeded(path), {
    onNone: () => arrowNameOrNode(path),
    onSome: (expression) => Result.succeed(expression),
  })

const arrowNameOrNode = (path: TraversePath): Result.Result<Expression, NodeKindMismatch> =>
  Option.match(arrowFunctionExpressionNamedIfNeeded(path), {
    onNone: () => expressionOf(path.node),
    onSome: (expression) => Result.succeed(expression),
  })

const isChainLink = (node: Node | undefined): boolean =>
  [isMemberExpressionNode(node), isCallExpressionNode(node), isNonNullExpression(node)].some((holds) => holds)

const isMemberExpressionNode = (node: Node | undefined): boolean => nodeType(node) === 'MemberExpression'

const isCallExpressionNode = (node: Node | undefined): boolean => nodeType(node) === 'CallExpression'

const isNonNullExpression = (node: Node | undefined): boolean => nodeType(node) === 'TSNonNullExpression'

const isValidExpression = (path: TraversePath): boolean => {
  const parent = path.parentPath
  return parent === null || !isUnmutatableContext(path, parent)
}

const isUnmutatableContext = (path: TraversePath, parent: TraversePath): boolean =>
  [
    isObjectPropertyKey(path, parent),
    isPartOfChain(path, parent),
    isTaggedTemplateTag(parent),
    isDeletedOperand(path, parent),
    isAssignedTarget(path, parent),
  ].some((invalid) => invalid)

const isObjectPropertyKey = (path: TraversePath, parent: TraversePath): boolean => {
  const parentNode = parent.node
  return parentNode.type === 'Property' && parentNode.key === path.node
}

const isTaggedTemplateTag = (parent: TraversePath): boolean => parent.node.type === 'TaggedTemplateExpression'

const isDeletedOperand = (path: TraversePath, parent: TraversePath): boolean => {
  const parentNode = parent.node
  return parentNode.type === 'UnaryExpression' && parentNode.operator === 'delete'
}

const isAssignedTarget = (path: TraversePath, parent: TraversePath): boolean => {
  const parentNode = parent.node
  return parentNode.type === 'AssignmentExpression' && parentNode.left === path.node
}

const isPartOfChain = (path: TraversePath, parent: TraversePath): boolean =>
  isChainLink(path.node) && chainContinuesIn(path, parent)

const chainContinuesIn = (path: TraversePath, parent: TraversePath): boolean =>
  [
    isMemberAccessParent(path, parent),
    isNonNullExpression(parent.node),
    isCalleeParent(path, parent),
  ].some((continues) => continues)

const isMemberAccessParent = (path: TraversePath, parent: TraversePath): boolean => {
  const parentNode = parent.node
  return parentNode.type === 'MemberExpression' && isNotACallOnTheNode(parentNode, path.node)
}

const isCalleeParent = (path: TraversePath, parent: TraversePath): boolean => {
  const parentNode = parent.node
  return parentNode.type === 'CallExpression' && parentNode.callee === path.node
}

const isNotACallOnTheNode = (member: MemberExpression, node: Node): boolean =>
  !(member.computed && member.property === node)

const unwrapParenthesizedExpression = (node: Node): Node =>
  Option.getOrElse(innerExpression(node), () => node)

interface ParenthesizedWrapper {
  readonly expression?: Node | null
}

const innerExpression = (node: Node): Option.Option<Node> =>
  Option.flatMap(
    Option.filter(Option.some(node), isParenthesizedWrapper),
    (parenthesized) => Option.map(Option.fromNullishOr(parenthesized.expression), unwrapParenthesizedExpression),
  )

const isParenthesizedWrapper = (value: unknown): value is ParenthesizedWrapper =>
  Predicate.hasProperty(value, 'type') && value['type'] === 'ParenthesizedExpression'

const expressionMutantPlacer: MutantPlacer = {
  name: 'expressionMutantPlacer',
  canPlace(path) {
    return path.isExpression() && isValidExpression(path)
  },
  place(path, appliedMutants) {
    const expression = [...appliedMutants].reduce(
      (expression, [mutant, appliedMutant]) =>
        Result.flatMap(expression, (current) =>
          Result.map(
            nodeOfKind(mutant, unwrapParenthesizedExpression(appliedMutant), isExpressionKind, 'an expression'),
            (replacement) => conditionalExpression(mutantTestExpression(mutant.id), replacement, current),
          )),
      Result.map(nameIfAnonymous(path), (target) => mutationCoverageSequenceExpression(appliedMutants.keys(), target)),
    )
    return Result.map(expression, (instrumented) => {
      path.replaceWith(instrumented)
    })
  },
}

const statementMutantPlacer: MutantPlacer = {
  name: 'statementMutantPlacer',
  canPlace(path) {
    return path.isStatement()
  },
  place(path, appliedMutants) {
    return Result.flatMap(statementsOf(path), (statements) => {
      const body = [expressionStatement(mutationCoverageSequenceExpression(appliedMutants.keys())), ...statements]
      const statement = [...appliedMutants].reduce<Result.Result<Statement, NodeKindMismatch>>(
        (statement, entry) =>
          Result.flatMap(statement, (current) =>
            Result.map(
              nodeOfKind(entry[0], entry[1], isStatementKind, 'a statement'),
              (replacement) => ifStatement(mutantTestExpression(entry[0].id), blockStatement([replacement]), current),
            )),
        Result.succeed(blockStatement(body)),
      )
      return Result.map(statement, (instrumented) => {
        path.replaceWith(wrappedStatement(path, instrumented))
      })
    })
  },
}

const isBlockStatementNode = (node: Node): node is Node & { readonly body: Array<Statement> } =>
  nodeType(node) === 'BlockStatement'

const statementsOf = (path: TraversePath): Result.Result<readonly Statement[], NodeKindMismatch> =>
  Match.value(path.node).pipe(
    Match.when(isBlockStatementNode, (block) => Result.succeed(block.body)),
    Match.orElse((node) => Result.map(statementOf(node), (statement) => [statement])),
  )

const wrappedStatement = (path: TraversePath, statement: Statement): Statement =>
  Match.value(nodeType(path.node)).pipe(
    Match.when('BlockStatement', () => blockStatement([statement])),
    Match.orElse(() => statement),
  )

const switchCaseMutantPlacer: MutantPlacer = {
  name: 'switchCaseMutantPlacer',
  canPlace(path) {
    return nodeType(path.node) === 'SwitchCase'
  },
  place(path, appliedMutants) {
    return Result.flatMap(switchCaseOf(path.node), (currentCase) => {
      const consequence = [...appliedMutants].reduce<Result.Result<Statement, NodeKindMismatch>>(
        (consequence, [mutant, appliedMutant]) =>
          Result.flatMap(consequence, (current) =>
            Result.map(
              Result.flatMap(
                nodeOfKind(mutant, appliedMutant, isSwitchCaseNode, 'a switch case'),
                (replacement) => Result.succeed(replacement.consequent),
              ),
              (consequent) =>
                ifStatement(mutantTestExpression(mutant.id), blockStatement(consequent), current),
            )),
        Result.succeed(
          blockStatement([
            expressionStatement(mutationCoverageSequenceExpression(appliedMutants.keys())),
            ...currentCase.consequent,
          ]),
        ),
      )
      return Result.map(consequence, (instrumented) => {
        path.replaceWith(switchCase(currentCase.test, [instrumented]))
      })
    })
  },
}

const allMutantPlacers: readonly MutantPlacer[] = Object.freeze([
  expressionMutantPlacer,
  statementMutantPlacer,
  switchCaseMutantPlacer,
])

const INSTRUMENTATION_HEADER_SOURCE = `// @ts-nocheck
var ${STRYKER_NAMESPACE_HELPER} = function(){
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.${ID.NAMESPACE} || (g.${ID.NAMESPACE} = {});
  if (ns.${ID.ACTIVE_MUTANT} === undefined && g.process && g.process.env && g.process.env.${ID.ACTIVE_MUTANT_ENV_VARIABLE}) {
    ns.${ID.ACTIVE_MUTANT} = g.process.env.${ID.ACTIVE_MUTANT_ENV_VARIABLE};
  }
  function retrieveNS(){
    return ns;
  }
  ${STRYKER_NAMESPACE_HELPER} = retrieveNS;
  return retrieveNS();
};
${STRYKER_NAMESPACE_HELPER}();

var ${COVER_MUTANT_HELPER} = function() {
  var ns = ${STRYKER_NAMESPACE_HELPER}();
  var cov = ns.${ID.MUTATION_COVERAGE_OBJECT} || (ns.${ID.MUTATION_COVERAGE_OBJECT} = { static: {}, perTest: {} });
  function cover() {
    var c = cov.static;
    if (ns.${ID.CURRENT_TEST_ID}) {
      c = cov.perTest[ns.${ID.CURRENT_TEST_ID}] = cov.perTest[ns.${ID.CURRENT_TEST_ID}] || {};
    }
    var a = arguments;
    for(var i=0; i < a.length; i++){
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  ${COVER_MUTANT_HELPER} = cover;
  cover.apply(null, arguments);
};
var ${IS_MUTANT_ACTIVE_HELPER} = function(id) {
  var ns = ${STRYKER_NAMESPACE_HELPER}();
  function isActive(id) {
    if (ns.${ID.ACTIVE_MUTANT} === id) {
      if (ns.${ID.HIT_COUNT} !== void 0 && ++ns.${ID.HIT_COUNT} > ns.${ID.HIT_LIMIT}) {
        throw new Error('Stryker: Hit count limit reached (' + ns.${ID.HIT_COUNT} + ')');
      }
      return true;
    }
    return false;
  }
  ${IS_MUTANT_ACTIVE_HELPER} = isActive;
  return isActive(id);
}`

const instrumentationHeaderOf = (parser: ParserShape): Effect.Effect<readonly Statement[], ParserError> =>
  Effect.map(
    parser.parse(INSTRUMENTATION_HEADER_SOURCE, 'instrumenter-header.js', 'js'),
    (ast) => deepFreeze(ast.root.body),
  )

const placeHeaderIfNeeded = (
  mutantCollector: MutantCollector,
  originFileName: string,
  options: MutatorOptions,
  root: Program,
  header: readonly Statement[],
): Effect.Effect<void, ParseFailed> =>
  Boolean.match(shouldPlaceHeader(mutantCollector, originFileName, options), {
    onTrue: () => placeHeader(root, header),
    onFalse: () => Effect.void,
  })

const placeHeader = (root: Program, header: readonly Statement[]): Effect.Effect<void, ParseFailed> =>
  Result.match(headerFor(root, header), {
    onSuccess: (resolved) =>
      Effect.sync(() => {
        root.body.unshift(...resolved)
      }),
    onFailure: (failure) => Effect.die(failure),
  })

const shouldPlaceHeader = (
  mutantCollector: MutantCollector,
  originFileName: string,
  options: MutatorOptions,
): boolean => hasPlacedMutants(mutantCollector, originFileName) && options.noHeader !== true

const headerFor = (
  root: Program,
  header: readonly Statement[],
): Result.Result<readonly Statement[], HeaderEmpty> =>
  Option.match(leadingCommentsOf(root), {
    onNone: () => Result.succeed(header),
    onSome: (leadingComments) =>
      Result.map(
        firstHeaderOf(header),
        (first) => [commentedHeader(leadingComments, first), ...header.slice(1)],
      ),
  })

const firstHeaderOf = (header: readonly Statement[]): Result.Result<Statement, HeaderEmpty> =>
  Result.fromOption(Option.fromNullishOr(header[0]), () => HeaderEmpty.make())

const leadingCommentsOf = (root: Program) =>
  Option.fromUndefinedOr(root.body[0]).pipe(
    Option.flatMap(leadingCommentsIn),
    Option.flatMap((comments) => Option.fromUndefinedOr(comments)),
  )

const commentedHeader = (leadingComments: readonly LocatedComment[], firstHeader: Statement): Statement => {
  const cloned = cloneNode(firstHeader)
  Object.assign(cloned, { leadingComments })
  return cloned
}

const deepFreeze = <A = unknown>(value: A): A =>
  Option.match(frozenContainer(value), {
    onNone: () => value,
    onSome: (frozen) => frozen,
  })

const frozenContainer = <A = unknown>(value: A): Option.Option<A> =>
  Option.map(Option.filter(Option.some(value), isObjectValue), (object) => {
    freezableChildren(object).forEach((child) => {
      deepFreeze(child)
    })
    Object.freeze(object)
    return value
  })

const freezableChildren = (value: Record<string, object | null | undefined>): readonly (object | null | undefined)[] => [
  ...mapEntries(value),
  ...setItems(value),
  ...Object.values(value),
]

const mapEntries = (value: object): readonly (object | null | undefined)[] =>
  Option.getOrElse(
    Option.map(Option.filter(Option.some(value), isMap), (map) => [...map.entries()].flat()),
    () => NO_CHILDREN,
  )

const setItems = (value: object): readonly (object | null | undefined)[] =>
  Option.getOrElse(Option.map(Option.filter(Option.some(value), isSet), (set) => [...set]), () => NO_CHILDREN)

const isObjectValue = (value: unknown): value is Record<string, object | null | undefined> =>
  value !== null && typeof value === 'object'

const isMap = (value: object): value is Map<object | null | undefined, object | null | undefined> =>
  value instanceof Map

const isSet = (value: object): value is Set<object | null | undefined> => value instanceof Set

const transformOf = (header: readonly Statement[], mutators: MutatorsShape): Transform => {
  const transform: Transform = dual(
    3,
    (
      ast: Ast,
      mutantCollector: MutantCollector,
      transformerContext: Omit<TransformerContext, 'transform'>,
    ): Effect.Effect<readonly string[], ParseFailed> => {
      const context: TransformerContext = {
        ...transformerContext,
        transform,
      }
      return Match.value(ast).pipe(
        Match.when({ format: 'html' }, (html) => transformHtml(html, mutantCollector, context)),
        Match.when({ format: 'js' }, (script) => transformScript(script, mutantCollector, context, header, mutators)),
        Match.when({ format: 'ts' }, (script) => transformScript(script, mutantCollector, context, header, mutators)),
        Match.when({ format: 'tsx' }, (script) => transformScript(script, mutantCollector, context, header, mutators)),
        Match.when({ format: 'svelte' }, (svelte) => transformSvelte(svelte, mutantCollector, context, header)),
        Match.exhaustive,
      )
    },
  )
  return transform
}

export type AstTransformer<T extends AstFormat> = (
  ast: AstByFormat[T],
  mutantCollector: MutantCollector,
  context: TransformerContext,
) => Effect.Effect<readonly string[], ParseFailed>

export interface TransformerContext {
  transform: AstTransformer<AstFormat>
  options: TransformerOptions
  mutateDescription: MutateDescription
  readonly basePath?: string | undefined
}

const transformHtml: AstTransformer<'html'> = (
  { root },
  mutantCollector,
  context,
) =>
  Effect.map(
    Effect.forEach(root.scripts, (script) => context.transform(script, mutantCollector, context)),
    (perScript) => perScript.flat(),
  )

const moduleScriptStart = '<script context="module">\n'
const moduleScript = `${moduleScriptStart}\n</script>\n`

const transformSvelte = (
  svelte: AstByFormat['svelte'],
  mutantCollector: MutantCollector,
  context: TransformerContext,
  header: readonly Statement[],
) =>
  Effect.gen(function*() {
    const { root } = svelte
    const scripts = [root.moduleScript, ...root.additionalScripts].filter(Predicate.isNotNullish)
    const perScript = yield* Effect.forEach(scripts, (script) =>
      context.transform(script.ast, mutantCollector, {
        ...context,
        options: {
          ...context.options,
          noHeader: true,
        },
      }))
    const warnings: string[] = perScript.flat()
    yield* placeModuleHeaderIfNeeded(svelte, mutantCollector, header)
    return warnings
  })

const placeModuleHeaderIfNeeded = (
  svelte: AstByFormat['svelte'],
  mutantCollector: MutantCollector,
  header: readonly Statement[],
): Effect.Effect<void, ParseFailed> =>
  Boolean.match(hasPlacedMutants(mutantCollector, svelte.originFileName), {
    onTrue: () => placeModuleHeader(svelte, header),
    onFalse: () => Effect.void,
  })

const placeModuleHeader = (
  svelte: AstByFormat['svelte'],
  header: readonly Statement[],
): Effect.Effect<void, ParseFailed> =>
  Effect.flatMap(ensureModuleScriptOf(svelte), (moduleScript) => placeHeader(moduleScript.ast.root, header))

const ensureModuleScriptOf = (svelte: AstByFormat['svelte']) =>
  Option.match(Option.fromUndefinedOr(svelte.root.moduleScript), {
    onSome: (moduleScript) => Effect.succeed(moduleScript),
    onNone: () =>
      Effect.sync(() => {
        const created: TemplateScript = {
          ast: {
            format: 'js',
            root: emptyProgram(),
            comments: [],
            rawContent: '',
            originFileName: svelte.originFileName,
          },
          range: {
            start: moduleScriptStart.length,
            end: moduleScriptStart.length,
          },
          isExpression: false,
        }
        svelte.root.moduleScript = created
        svelte.rawContent = `${moduleScript}${svelte.rawContent}`
        svelte.root.additionalScripts.forEach((script) => {
          script.range.start += moduleScript.length
          script.range.end += moduleScript.length
        })
        return created
      }),
  })

const emptyProgram = (): Program => ({ type: 'Program', sourceType: 'module', body: [], hashbang: null })

interface MutantsPlacement {
  appliedMutants: Map<Mutant, Node>
  placer: MutantPlacer
}

type PlacementMap = Map<Node, MutantsPlacement>

const emptyAppliedMutants = (): Map<Mutant, Node> => new Map()

const isMutateRangeList = (value: MutateDescription): value is readonly SourceLocationInFile[] =>
  Array.isArray(value)

const transformScript = (
  { root, originFileName, rawContent, offset, comments }: ScriptAst,
  mutantCollector: MutantCollector,
  { options, mutateDescription, basePath }: TransformerContext,
  header: readonly Statement[],
  mutators: MutatorsShape,
) => {
  const placementMap: PlacementMap = new Map()
  const broken: { current: TransformerFailure | undefined } = { current: undefined }
  const recordFailure = (candidate: TransformerFailure): void => {
    broken.current = broken.current ?? candidate
  }
  return Effect.gen(function*() {
    const lineTable = yield* Effect.orDie(S.decodeEffect(LineTableFromText)(rawContent))

    attachComments(make(root), comments, lineTable)
    const directives: { rule: Rule } = { rule: rootRule }
    const mutatorEntries = Object.entries(mutators.mutators)
    const allMutatorNames = mutatorEntries.map(([name]) => name.toLowerCase())

    const warnings: string[] = []

    const nodeLocationOf = (node: Node): Option.Option<SourceLocationInFile> =>
      Option.map(Option.fromNullishOr(spanOf(node)), (span) => lineTable.locationAt(span))
    const shouldSkip = (path: TraversePath): boolean =>
      [
        isTypeNode(path),
        isImportDeclaration(path),
        nodeType(path.node) === 'Decorator',
        mutateDescription === false,
        isOutsideMutateRanges(path),
      ].some((skip) => skip)
    const mutateRanges = (): Option.Option<readonly SourceLocationInFile[]> =>
      Option.filter(Option.some(mutateDescription), isMutateRangeList)
    const isOutsideMutateRanges = (path: TraversePath): boolean =>
      Option.exists(
        mutateRanges(),
        (ranges) =>
          Option.match(nodeLocationOf(path.node), {
            onNone: () => true,
            onSome: (location) => ranges.every((range) => !locationOverlaps(range, location)),
          }),
      )
    const shouldMutate = (path: TraversePath): boolean =>
      mutateDescription === true || isInsideMutateRanges(path)
    const isInsideMutateRanges = (path: TraversePath): boolean =>
      Option.exists(
        mutateRanges(),
        (ranges) =>
          Option.match(nodeLocationOf(path.node), {
            onNone: () => false,
            onSome: (location) => ranges.some((range) => locationIncluded(range, location)),
          }),
      )
    const ignoreMessageFor = (node: Node, ancestors: readonly Node[]): string | undefined =>
      ignorerReason(node, ancestors)
    const ignorerReason = (node: Node, ancestors: readonly Node[]): string | undefined =>
      options.ignorers.map((ignorer) => ignorer.shouldIgnore(node, ancestors)).find((reason) =>
        reason !== undefined
      )
    const collectMutants = (path: TraversePath): Mutant[] =>
      mutablesFor(path).map((mutable) => collect(mutable, path))
        .filter((mutant) => mutant.ignoreReason === undefined)
    function collect(mutable: Mutable, path: TraversePath): Mutant {
      const mutant = mutators.create({
        id: mutantCollector.length.toString(),
        fileName: originFileName,
        original: path.node,
        specs: mutable,
        offset,
        lineTable: lineTable.lineStarts,
      })
      mutantCollector.push(mutant)
      return mutant
    }
    const mutablesFor = (path: TraversePath): readonly Mutable[] =>
      Option.match(nodeLocationOf(path.node), {
        onNone: () => [],
        onSome: (location) => {
          const ancestors = ancestorsOf(path)
          const context = toMutatorContext(ancestors)
          const line = location.start.line
          return mutatorEntries.flatMap(([mutatorName, mutate]) =>
            [...mutate(path.node, context)].map((replacement) =>
              mutableFor(path.node, ancestors, mutatorName, replacement, line)
            )
          )
        },
      })
    const mutableFor = (
      node: Node,
      ancestors: readonly Node[],
      mutatorName: string,
      replacement: Node,
      line: number,
    ): Mutable => {
      const mutableEntry: Mutable = { replacement, mutatorName }
      return Option.match(Option.fromUndefinedOr(ignoreReasonFor(node, ancestors, mutatorName, line)), {
        onNone: () => mutableEntry,
        onSome: (ignoreReason) => ({ ...mutableEntry, ignoreReason }),
      })
    }
    const ignoreReasonFor = (
      node: Node,
      ancestors: readonly Node[],
      mutatorName: string,
      line: number,
    ): string | undefined => directiveOrExclusion(mutatorName, line) ?? ignoreMessageFor(node, ancestors)
    const directiveOrExclusion = (mutatorName: string, line: number): string | undefined =>
      findIgnoreReason(directives.rule, mutatorName, line) ?? findExcludedMutatorIgnoreReason(mutatorName)
    const findExcludedMutatorIgnoreReason = (mutatorName: string): string | undefined =>
      Boolean.match(options.excludedMutations.includes(mutatorName), {
        onTrue: () => `Ignored because of excluded mutation "${mutatorName}"`,
        onFalse: () => undefined,
      })


    traverse(make(root), {
      enter(path) {
        Option.match(Option.fromNullishOr(broken.current), {
          onNone: () => {
            const result = processStrykerDirectives(directives.rule, path.node, allMutatorNames, originFileName)
            directives.rule = result.rule
            warnings.push(...result.warnings)
            Option.match(result.failure, {
              onNone: () => undefined,
              onSome: recordFailure,
            })
            visitNode(path)
          },
          onSome: () => undefined,
        })
      },
      exit(path) {
        Option.match(Option.fromNullishOr(broken.current), {
          onNone: () =>
            Option.match(
              Option.filter(Option.some(placementMap.get(path.node)), hasAppliedMutants),
              {
                onNone: () => undefined,
                onSome: (placement) => applyPlacement(path, placement),
              },
            ),
          onSome: () => undefined,
        })
      },
    })

    yield* placeHeaderIfNeeded(mutantCollector, originFileName, options, root, header)

    yield* Option.match(Option.fromNullishOr(broken.current), {
      onNone: () => Effect.void,
      onSome: (failure) => Effect.die(failure),
    })

    return warnings

    function visitNode(path: TraversePath): void {
      Boolean.match(shouldSkip(path), {
        onTrue: () => path.skip(),
        onFalse: () => {
          addToPlacementMapIfPossible(path)
          placeCollectedMutantsIfMutating(path)
        },
      })
    }
    function addToPlacementMapIfPossible(path: TraversePath): void {
      Option.match(Arr.findFirst(allMutantPlacers, (candidate) => candidate.canPlace(path)), {
        onSome: (placer) => placementMap.set(path.node, { appliedMutants: emptyAppliedMutants(), placer }),
        onNone: () => undefined,
      })
    }
    function hasAppliedMutants(placement: MutantsPlacement | undefined): placement is MutantsPlacement {
      return placement !== undefined && placement.appliedMutants.size > 0
    }
    function applyPlacement(path: TraversePath, placement: MutantsPlacement): void {
      Result.match(
        Result.mapError(
          Result.flatMap(
            Result.try({
              try: () => placement.placer.place(path, placement.appliedMutants),
              catch: (cause) =>
                Result.fail(
                  MutantPlacementFailed.make({
                    ...placementLocation(path.node, lineTable, basePath, originFileName),
                    placerName: placement.placer.name,
                    mutatorNames: [...placement.appliedMutants.keys()].map((mutant) => mutant.mutatorName),
                    cause,
                  }),
                ),
            }),
            (placed) => placed,
          ),
          (kindMismatch) =>
            MutantPlacementFailed.make({
              ...placementLocation(path.node, lineTable, basePath, originFileName),
              placerName: placement.placer.name,
              mutatorNames: [...placement.appliedMutants.keys()].map((mutant) => mutant.mutatorName),
              cause: kindMismatch,
            }),
        ),
        {
          onSuccess: () => path.skip(),
          onFailure: recordFailure,
        },
      )
    }
    function placeCollectedMutantsIfMutating(path: TraversePath): void {
      Boolean.match(shouldMutate(path), {
        onTrue: () => placeCollectedMutants(path),
        onFalse: () => undefined,
      })
    }
    function placeCollectedMutants(path: TraversePath): void {
      const mutantsToPlace = collectMutants(path)
      Boolean.match(mutantsToPlace.length === 0, {
        onTrue: () => undefined,
        onFalse: () => {
          Option.match(Option.fromNullishOr(path.find((ancestor) => placementMap.has(ancestor.node))), {
            onNone: () =>
              recordFailure(MutantsUnplaced.make({ mutants: JSON.stringify(mutantsToPlace, null, 2) })),
            onSome: (placementPath) =>
              Option.match(Option.fromNullishOr(placementMap.get(placementPath.node)), {
                onNone: () => recordFailure(PlacementMissing.make({})),
                onSome: (placement) => {
                  mutantsToPlace.forEach((mutant) =>
                    Result.match(mutators.apply(mutant, placementPath.node), {
                      onSuccess: (applied) => {
                        placement.appliedMutants.set(mutant, applied)
                      },
                      onFailure: recordFailure,
                    }))
                },
              }),
          })
        },
      })
    }
  })
}

function toMutatorContext(ancestors: readonly Node[]): MutatorContext {
  return {
    parent: ancestors[0],
    grandParent: ancestors[1],
    ancestors: [...ancestors],
  }
}
