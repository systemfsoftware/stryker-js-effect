import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  type ArrowFunctionExpression,
  arrowFunctionExpression,
  attachComments,
  blockStatement,
  callExpression,
  childNodes,
  type ClassExpression,
  conditionalExpression,
  type Expression,
  expressionStatement,
  formatKeyOf,
  type FunctionExpression,
  identifier,
  type IdentifierReference,
  ifStatement,
  isExpressionKind,
  isStatementKind,
  make,
  type MemberExpression,
  type Node,
  nodeType,
  type Program,
  returnStatement,
  sequenceExpression,
  spanOf,
  type Statement,
  stringLiteral,
  switchCase,
  traverse,
  type TraversePath,
  variableDeclaration,
  type VariableDeclarator,
  variableDeclarator,
} from './Ast.handle.js'
import { type Ast, type ScriptAst, type SourceLocationInFile, type SpannedComment } from './Ast.schema.js'
import { decodeDirective, DecodeDirectiveCommand } from './directives/decode-directive.workflow.js'
import { type Directive, type LocatedDirective } from './directives/directive.schema.js'
import { foldRule, FoldRuleCommand, type MutantRule } from './directives/fold-rule.workflow.js'
import { ErrorText } from './ErrorText.schema.js'
import type { FormatRegistry } from './Format.schema.js'
import {
  MutantsUnapplied,
  MutantsUnplaced,
  type MutateDescription,
  NodeWithoutSpan,
  PlacementRefused,
  type PlacerName,
} from './Instrument.schema.js'
import { InstrumentError } from './Instrument.schema.js'
import { COVER_MUTANT_HELPER, IS_MUTANT_ACTIVE_HELPER, placeHeaderIfNeeded } from './InstrumentHeader.js'
import { type LineTable, LineTableFromText, type Position } from './Location.schema.js'
import { type MutatorContext, type MutatorEntry, type MutatorOptions } from './Mutator.service.js'
import {
  applyMutant,
  createMutant,
  defaultMutators,
  type Mutant,
  type MutatorRegistry,
  optInMutators,
  selectMutators,
} from './Mutator.service.js'
import { type ParseFailed } from './Parser.service.js'
import {
  type EditSite,
  type PlacedMutant,
  type PlacementFacts,
  type PlacementRefusal,
  placeMutants,
  PlaceMutantsCommand,
} from './place-mutants.workflow.js'
import {
  type MutantCandidate,
  type MutantPlan,
  type MutantWithoutLocation,
  planMutants,
  PlanMutantsCommand,
  type PlannedMutant,
} from './plan-mutants.workflow.js'
import { printNode } from './print/SourceText.js'

const comparePositions = (a: Position, b: Position): number => {
  const lineDelta = a.line - b.line
  return lineDelta !== 0 ? lineDelta : a.column - b.column
}

const locationIncluded = (haystack: SourceLocationInFile, needle: SourceLocationInFile): boolean =>
  comparePositions(haystack.start, needle.start) <= 0 && comparePositions(haystack.end, needle.end) >= 0

const locationOverlaps = (a: SourceLocationInFile, b: SourceLocationInFile): boolean =>
  comparePositions(a.start, b.end) <= 0 && comparePositions(a.end, b.start) >= 0

const errorTextOf = <A = unknown>(cause: A): string =>
  Option.getOrElse(Option.map(ErrorText.fromCause(cause), (rendered) => rendered.text), () => '')

const traversalFailure = <A = unknown>(cause: A): InstrumentError =>
  InstrumentError.make({
    message: cause instanceof Error ? cause.message : errorTextOf(cause),
    cause,
  })

export interface TransformerOptions extends MutatorOptions {
  ignorers: readonly Ignorer[]
}

const DEFAULT_MUTATOR_REGISTRY: MutatorRegistry = { defaults: defaultMutators, optIn: optInMutators }

export interface MutantCollector {
  readonly nextIndex: number
  readonly append: (mutants: readonly Mutant[]) => void
  readonly map: <A>(transform: (mutant: Mutant) => A) => readonly A[]
}

export const createMutantCollector = (): MutantCollector => {
  const mutants: Mutant[] = []
  return {
    get nextIndex(): number {
      return mutants.length
    },
    append: (added) => {
      mutants.push(...added)
    },
    map: (transform) => mutants.map(transform),
  }
}

const decidedDirective = (commentText: string): Option.Option<Directive> =>
  Match.value(decodeDirective(DecodeDirectiveCommand.make({ commentText }))).pipe(
    Match.when(Result.isSuccess, (decoded) =>
      Match.value(decoded.success).pipe(
        Match.tag('DirectiveDecoded', (decision) => Option.some(decision.directive)),
        Match.orElse(() => Option.none<Directive>()),
      )),
    Match.orElse(() => Option.none<Directive>()),
  )

const locatedDirective = (comment: LocatedComment, governedLine: number): Option.Option<LocatedDirective> =>
  Option.flatMap(
    Option.fromNullishOr(comment.loc),
    (loc) =>
      Option.map(
        decidedDirective(comment.value),
        (directive): LocatedDirective => ({ directive, at: loc.start, governedLine }),
      ),
  )

const directivesOf = (node: Node, governedLine: number): readonly LocatedDirective[] =>
  attachedComments(node).flatMap((comment) => Option.toArray(locatedDirective(comment, governedLine)))

const foldInto = (rule: MutantRule, directive: LocatedDirective): MutantRule =>
  Match.value(foldRule(FoldRuleCommand.make({ rule, directive }))).pipe(
    Match.when(Result.isSuccess, (folded) => folded.success.rule),
    Match.orElse(() => rule),
  )

interface LocatedComment extends SpannedComment {
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}

interface NodeWithLeadingComments {
  readonly leadingComments: readonly LocatedComment[]
}

const NO_COMMENTS: readonly LocatedComment[] = []

const attachedComments = (node: Node): readonly LocatedComment[] =>
  hasLeadingComments(node) ? node.leadingComments : NO_COMMENTS

const hasLeadingComments = (value: object): value is NodeWithLeadingComments =>
  Predicate.hasProperty(value, 'leadingComments') && Array.isArray(value.leadingComments)

export function isTypeNode(node: Node): boolean {
  return [
    tsTypeAnnotationNodeTypes.includes(node.type),
    flowTypeAnnotationNodeTypes.includes(node.type),
    isDeclareVariableStatement(node),
    isDeclareModule(node),
  ].some((isType) => isType)
}

function isDeclareVariableStatement(node: Node): boolean {
  return isDeclared(node) && nodeType(node) === 'VariableDeclaration'
}

function isDeclareModule(node: Node): boolean {
  return isDeclared(node) && nodeType(node) === 'TSModuleDeclaration'
}

function isDeclared(node: Node): boolean {
  return 'declare' in node && node.declare === true
}

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

export function isImportDeclaration(node: Node): boolean {
  return (
    nodeType(node) === 'TSImportEqualsDeclaration' || node.type === 'ImportDeclaration'
  )
}

export function mutantTestExpression(
  mutantId: string,
): Expression {
  return callExpression(identifier(IS_MUTANT_ACTIVE_HELPER), [stringLiteral(mutantId)])
}

function mutationCoverageSequenceExpression(
  mutants: Iterable<Mutant>,
  targetExpression?: Expression,
): Expression {
  const mutantIds = [...mutants].map((mutant) => stringLiteral(mutant.id))
  const sequence: Expression[] = [
    callExpression(identifier(COVER_MUTANT_HELPER), mutantIds),
  ]
  return sequenceExpression(targetExpression === undefined ? sequence : [...sequence, targetExpression])
}

export interface MutantPlacer {
  name: PlacerName
  place(path: TraversePath, appliedMutants: Map<Mutant, Node>): Result.Result<void, Error>
}

const refusalPlacer = (refusal: PlacementRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('MutantKindMismatch', (mismatch) => mismatch.placer),
    Match.tag('MutantsUnapplied', (unapplied) => unapplied.placer),
    Match.tag('NoPlacerClaimsNode', () => 'no placer'),
    Match.tag('MutantNotApplied', () => 'no placer'),
    Match.exhaustive,
  )

const refusalDetail = (refusal: PlacementRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('MutantKindMismatch', (mismatch) => `Expected ${mismatch.expected} for mutant ${mismatch.mutantId}`),
    Match.tag('MutantsUnapplied', (unapplied) => `Failed to apply ${unapplied.mutatorNames.join(', ')}`),
    Match.tag('NoPlacerClaimsNode', () => 'No placer claims the node'),
    Match.tag('MutantNotApplied', (unapplied) => `Could not apply the ${unapplied.mutatorName} mutant`),
    Match.exhaustive,
  )

const placementFailureMessage = (
  refusal: PlacementRefusal,
  node: Node,
  mutants: readonly Mutant[],
  fileName: string,
  lineTable: LineTable,
  basePath?: string,
): string => {
  const message = `${refusalPlacer(refusal)} could not place mutants with type(s): "${
    placementListFormat.format(mutants.map((mutant) => mutant.mutatorName))
  }"`
  return `${
    placementLocation(node, fileName, lineTable, basePath)
  } ${message}. Either remove this file from the list of files to be mutated, or exclude the mutator (using \`mutator.excludedMutations\`). Original error: ${
    refusalDetail(refusal)
  }`
}

function nodeOfKind<T extends Node>(
  mutant: Mutant,
  node: Node,
  isKind: (candidate: Node) => candidate is T,
  kind: string,
): Result.Result<T, Error> {
  return isKind(node)
    ? Result.succeed(node)
    : Result.fail(new Error(`Cannot place mutant ${mutant.id}: expected ${kind}, got ${node.type}`))
}

function expressionOf(node: Node): Result.Result<Expression, Error> {
  return isExpressionKind(node)
    ? Result.succeed(node)
    : Result.fail(new Error(`Expected an expression, got ${node.type}`))
}

function statementOf(node: Node): Result.Result<Statement, Error> {
  return isStatementKind(node)
    ? Result.succeed(node)
    : Result.fail(new Error(`Expected a statement, got ${node.type}`))
}

interface SwitchCaseShape {
  readonly test: Expression | null
  readonly consequent: Statement[]
}

function isSwitchCase(node: Node): node is Node & SwitchCaseShape {
  return nodeType(node) === 'SwitchCase'
}

function switchCaseOf(node: Node): Result.Result<Node & SwitchCaseShape, Error> {
  return isSwitchCase(node)
    ? Result.succeed(node)
    : Result.fail(new Error(`Expected a switch case, got ${node.type}`))
}

const fileNameWithin = (basePath: string | undefined, fileName: string): string =>
  basePath === undefined ? fileName : relativeTo(basePath, fileName)

function placementLocation(node: Node, fileName: string, lineTable: LineTable, basePath?: string): string {
  const relativeFile = fileNameWithin(basePath, fileName)
  const position = Option.map(
    Option.fromNullishOr(spanOf(node)),
    (span) => lineTable.positionAt(span.start),
  )
  return Option.match(position, {
    onNone: () => `${relativeFile}:undefined:undefined`,
    onSome: (at) => `${relativeFile}:${at.line}:${at.column}`,
  })
}

type AnonymousFunctionOrClass = FunctionExpression | ClassExpression
const placementListFormat = new Intl.ListFormat('en')

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

const withTrailingSlash = (basePath: string): string => {
  const normalized = normalizeSeparators(basePath)
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

const relativeTo = (basePath: string, fileName: string): string => {
  const prefix = withTrailingSlash(basePath)
  const normalizedFile = normalizeSeparators(fileName)
  return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : fileName
}

function classOrFunctionExpressionNamedIfNeeded(path: TraversePath): Option.Option<Expression> {
  return Option.flatMap(
    Option.filter(Option.some(path.node), isAnonymousFunctionOrClass),
    (node) => nameFromParent(path, node),
  )
}

function nameFromParent(path: TraversePath, node: AnonymousFunctionOrClass): Option.Option<Expression> {
  return Match.value(path.parentPath?.node).pipe(
    Match.when(isVariableDeclarator, (declarator) => adoptDeclaredName(node, declarator)),
    Match.when({ type: 'Property', key: { type: 'Identifier' } }, () => namedPropertyValue(path, node)),
    Match.orElse(() => Option.none<Expression>()),
  )
}

/** A property value only survives by name when the declaration above it carries one. */
function namedPropertyValue(path: TraversePath, node: AnonymousFunctionOrClass): Option.Option<Expression> {
  return Match.value(path.getStatementParent()?.node.type).pipe(
    Match.when('VariableDeclaration', () => Option.some<Expression>(node)),
    Match.orElse(() => Option.none<Expression>()),
  )
}

function adoptIdentifier(node: AnonymousFunctionOrClass, identifier: IdentifierReference): Expression {
  node.id = identifier
  return node
}

function isAnonymousFunctionOrClass(node: Node): node is AnonymousFunctionOrClass {
  return isFunctionOrClassExpression(node) && node.id == null
}

function isFunctionOrClassExpression(node: Node): node is AnonymousFunctionOrClass {
  return node.type === 'FunctionExpression' || node.type === 'ClassExpression'
}

function arrowFunctionExpressionNamedIfNeeded(path: TraversePath): Option.Option<Expression> {
  return Match.value(path.node).pipe(
    Match.when({ type: 'ArrowFunctionExpression' }, (node) => arrowNamedByDeclarator(node, path.parentPath)),
    Match.orElse(() => Option.none<Expression>()),
  )
}

/** An arrow bound to a named declaration is re-emitted as a named function. */
function arrowNamedByDeclarator(
  node: ArrowFunctionExpression,
  parentPath: TraversePath | null,
): Option.Option<Expression> {
  return Option.map(declaratorIdentifier(parentPath), (identifier) => namedArrowExpression(node, identifier))
}

function namedArrowExpression(node: ArrowFunctionExpression, identifier: IdentifierReference): Expression {
  const declaration = variableDeclaration('const', [variableDeclarator(identifier, node)])
  return callExpression(
    arrowFunctionExpression([], blockStatement([declaration, returnStatement(identifier)])),
    [],
  )
}

function declaratorIdentifier(parentPath: TraversePath | null): Option.Option<IdentifierReference> {
  return Option.flatMap(Option.fromNullishOr(parentPath), (parent) =>
    Match.value(parent.node).pipe(
      Match.when(isVariableDeclarator, (declarator) => declaredName(declarator)),
      Match.orElse(() => Option.none<IdentifierReference>()),
    ))
}

function isVariableDeclarator(node: unknown): node is VariableDeclarator {
  return nodeType(node) === 'VariableDeclarator'
}

function adoptDeclaredName(node: AnonymousFunctionOrClass, declarator: VariableDeclarator): Option.Option<Expression> {
  return Option.map(declaredName(declarator), (identifier) => adoptIdentifier(node, identifier))
}

function declaredName(declarator: VariableDeclarator): Option.Option<IdentifierReference> {
  return Match.value(declarator.id).pipe(
    Match.when(isIdentifierReference, (identifier) => Option.some(identifier)),
    Match.orElse(() => Option.none<IdentifierReference>()),
  )
}

function isIdentifierReference(node: unknown): node is IdentifierReference {
  return nodeType(node) === 'Identifier'
}

function nameIfAnonymous(path: TraversePath): Result.Result<Expression, Error> {
  return Option.match(
    Option.orElse(classOrFunctionExpressionNamedIfNeeded(path), () => arrowFunctionExpressionNamedIfNeeded(path)),
    {
      onNone: () => expressionOf(path.node),
      onSome: (named) => Result.succeed(named),
    },
  )
}

function isChainLink(node: Node | undefined): boolean {
  return [isMemberExpressionNode(node), isCallExpressionNode(node), isNonNullExpression(node)].some((holds) => holds)
}

function isMemberExpressionNode(node: Node | undefined): boolean {
  return nodeType(node) === 'MemberExpression'
}

function isCallExpressionNode(node: Node | undefined): boolean {
  return nodeType(node) === 'CallExpression'
}

function isNonNullExpression(node: Node | undefined): boolean {
  return nodeType(node) === 'TSNonNullExpression'
}

function isValidExpression(node: Node, parent: Node | null): boolean {
  return parent === null || !isUnmutatableContext(node, parent)
}

function isUnmutatableContext(node: Node, parent: Node): boolean {
  return [
    isObjectPropertyKey(node, parent),
    isPartOfChain(node, parent),
    isTaggedTemplateTag(parent),
    isDeletedOperand(node, parent),
    isAssignedTarget(node, parent),
  ].some((invalid) => invalid)
}

function isObjectPropertyKey(node: Node, parent: Node): boolean {
  return parent.type === 'Property' && parent.key === node
}

function isTaggedTemplateTag(parent: Node): boolean {
  return parent.type === 'TaggedTemplateExpression'
}

function isDeletedOperand(node: Node, parent: Node): boolean {
  return parent.type === 'UnaryExpression' && parent.operator === 'delete'
}

function isAssignedTarget(node: Node, parent: Node): boolean {
  return parent.type === 'AssignmentExpression' && parent.left === node
}

function isPartOfChain(node: Node, parent: Node): boolean {
  return isChainLink(node) && chainContinuesIn(node, parent)
}

function chainContinuesIn(node: Node, parent: Node): boolean {
  return [
    isMemberAccessParent(node, parent),
    isNonNullExpression(parent),
    isCalleeParent(node, parent),
  ].some((continues) => continues)
}

function isMemberAccessParent(node: Node, parent: Node): boolean {
  return parent.type === 'MemberExpression' && isNotACallOnTheNode(parent, node)
}

function isCalleeParent(node: Node, parent: Node): boolean {
  return parent.type === 'CallExpression' && parent.callee === node
}

function isNotACallOnTheNode(member: MemberExpression, node: Node): boolean {
  return !(member.computed && member.property === node)
}

export function unwrapParenthesizedExpression(node: Node): Node {
  return Option.getOrElse(innerExpression(node), () => node)
}

interface ParenthesizedWrapper {
  readonly expression?: Node | null
}

function innerExpression(node: Node): Option.Option<Node> {
  return Option.flatMap(
    Option.filter(Option.some(node), isParenthesizedWrapper),
    (parenthesized) => Option.map(Option.fromNullishOr(parenthesized.expression), unwrapParenthesizedExpression),
  )
}

function isParenthesizedWrapper(value: unknown): value is ParenthesizedWrapper {
  return Predicate.hasProperty(value, 'type') && value['type'] === 'ParenthesizedExpression'
}

export const expressionMutantPlacer: MutantPlacer = {
  name: 'expression',
  place(path, appliedMutants) {
    return Result.gen(function*() {
      const base = yield* nameIfAnonymous(path)
      const sequenced = mutationCoverageSequenceExpression(appliedMutants.keys(), base)
      const expression = yield* [...appliedMutants].reduce<Result.Result<Expression, Error>>(
        (accumulated, [mutant, appliedMutant]) =>
          Result.flatMap(accumulated, (current) =>
            Result.map(
              nodeOfKind(mutant, unwrapParenthesizedExpression(appliedMutant), isExpressionKind, 'an expression'),
              (replacement) => conditionalExpression(mutantTestExpression(mutant.id), replacement, current),
            )),
        Result.succeed(sequenced),
      )
      path.replaceWith(expression)
      return undefined
    })
  },
}

export const statementMutantPlacer: MutantPlacer = {
  name: 'statement',
  place(path, appliedMutants) {
    return Result.gen(function*() {
      const statements = yield* statementsOf(path)
      const body = [expressionStatement(mutationCoverageSequenceExpression(appliedMutants.keys())), ...statements]
      const statement = yield* [...appliedMutants].reduce<Result.Result<Statement, Error>>(
        (accumulated, entry) => Result.flatMap(accumulated, (current) => guardedStatement(current, entry)),
        Result.succeed(blockStatement(body)),
      )
      path.replaceWith(wrappedStatement(path, statement))
      return undefined
    })
  },
}

const statementsOf = (path: TraversePath): Result.Result<readonly Statement[], Error> => {
  const node = path.node
  return node.type === 'BlockStatement'
    ? Result.succeed(node.body)
    : Result.map(statementOf(node), (statement) => [statement])
}

function guardedStatement(statement: Statement, entry: readonly [Mutant, Node]): Result.Result<Statement, Error> {
  return Result.map(
    nodeOfKind(entry[0], entry[1], isStatementKind, 'a statement'),
    (narrowed) => ifStatement(mutantTestExpression(entry[0].id), blockStatement([narrowed]), statement),
  )
}

function wrappedStatement(path: TraversePath, statement: Statement): Statement {
  return Match.value(nodeType(path.node)).pipe(
    Match.when('BlockStatement', () => blockStatement([statement])),
    Match.orElse(() => statement),
  )
}

export const switchCaseMutantPlacer: MutantPlacer = {
  name: 'switch-case',
  place(path, appliedMutants) {
    return Result.gen(function*() {
      const currentCase = yield* switchCaseOf(path.node)
      const consequence = yield* [...appliedMutants].reduce<Result.Result<Statement, Error>>(
        (accumulated, [mutant, appliedMutant]) =>
          Result.flatMap(accumulated, (current) =>
            Result.map(
              nodeOfKind(mutant, appliedMutant, isSwitchCase, 'a switch case'),
              (appliedCase) =>
                ifStatement(mutantTestExpression(mutant.id), blockStatement(appliedCase.consequent), current),
            )),
        Result.succeed(
          blockStatement([
            expressionStatement(mutationCoverageSequenceExpression(appliedMutants.keys())),
            ...currentCase.consequent,
          ]),
        ),
      )
      path.replaceWith(switchCase(currentCase.test, [consequence]))
      return undefined
    })
  },
}

export const placerBuilders: Readonly<Record<PlacerName, MutantPlacer>> = Object.freeze({
  expression: expressionMutantPlacer,
  statement: statementMutantPlacer,
  'switch-case': switchCaseMutantPlacer,
})

const transformDataFirst = (
  ast: Ast,
  mutantCollector: MutantCollector,
  transformerContext: Omit<TransformerContext, 'transform'>,
): Effect.Effect<readonly string[], ParseFailed | InstrumentError> => {
  const context: TransformerContext = {
    ...transformerContext,
    transform,
  }
  const formatKey = formatKeyOf(ast)
  return Match.value(transformerContext.registry.entryForFormat(formatKey)).pipe(
    Match.when(Option.isSome, (entry) => entry.value.transform(ast, mutantCollector, context)),
    Match.orElse(() =>
      Effect.fail(
        InstrumentError.make({
          message: `No registered format transforms the "${formatKey}" AST`,
          cause: new Error(`Missing format entry for "${formatKey}"`),
        }),
      )
    ),
  )
}

export const transform: {
  (
    ast: Ast,
    mutantCollector: MutantCollector,
    transformerContext: Omit<TransformerContext, 'transform'>,
  ): Effect.Effect<readonly string[], ParseFailed | InstrumentError>
  (
    mutantCollector: MutantCollector,
    transformerContext: Omit<TransformerContext, 'transform'>,
  ): (ast: Ast) => Effect.Effect<readonly string[], ParseFailed | InstrumentError>
} = dual((args: IArguments): boolean => args.length >= 3, transformDataFirst)

export type AstTransformer<T extends Ast = Ast> = (
  ast: T,
  mutantCollector: MutantCollector,
  context: TransformerContext,
) => Effect.Effect<readonly string[], ParseFailed | InstrumentError>

export interface TransformerContext {
  transform: AstTransformer
  options: TransformerOptions
  mutateDescription: MutateDescription
  registry: FormatRegistry
  readonly basePath?: string | undefined
}
interface MutableCandidate {
  readonly node: Node
  readonly replacement: Node
  readonly data: MutantCandidate
}

function isMutateRangeList(value: MutateDescription): value is readonly SourceLocationInFile[] {
  return Array.isArray(value)
}

const MUTATION_OFFSET: Position = { line: 1, column: 0 }

type InstrumentationRefusal = NodeWithoutSpan | MutantsUnplaced | PlacementRefused | MutantWithoutLocation

interface NodeFrame {
  readonly node: Node
  readonly parent: NodeFrame | null
}

interface ClaimedSite {
  readonly node: Node
  readonly facts: PlacementFacts
  readonly applied: readonly (readonly [Mutant, Node])[]
}

interface PlannedPlacement {
  readonly node: Node
  readonly placer: PlacerName
  readonly applied: readonly (readonly [Mutant, Node])[]
}

interface InstrumentationPlan {
  readonly mutants: readonly Mutant[]
  readonly placements: readonly PlannedPlacement[]
  readonly warnings: readonly string[]
  readonly hasLiveMutants: boolean
}

interface PlacementContext {
  readonly fileName: string
  readonly lineTable: LineTable
  readonly mutateDescription: MutateDescription
  readonly offset: Position
  readonly basePath?: string | undefined
  readonly mutatorEntries: readonly MutatorEntry[]
  readonly allMutatorNames: readonly string[]
  readonly excludedMutations: readonly string[]
  readonly ignorers: readonly Ignorer[]
}

interface FoldState {
  readonly directiveRule: MutantRule
  readonly nextIndex: number
  readonly mutants: readonly Mutant[]
  readonly warnings: readonly string[]
  readonly claims: readonly ClaimedSite[]
  readonly placements: readonly PlannedPlacement[]
  readonly hasLiveMutants: boolean
}

const initialFoldState = (firstIndex: number): FoldState => ({
  directiveRule: [],
  nextIndex: firstIndex,
  mutants: [],
  warnings: [],
  claims: [],
  placements: [],
  hasLiveMutants: false,
})

const framesUpward = (frame: NodeFrame): readonly NodeFrame[] => [frame, ...framesAbove(frame)]

const framesAbove = (frame: NodeFrame): readonly NodeFrame[] =>
  Option.match(Option.fromNullishOr(frame.parent), {
    onNone: () => [],
    onSome: (parent) => framesUpward(parent),
  })

const parentNodeOf = (frame: NodeFrame): Node | null =>
  Option.getOrNull(Option.map(Option.fromNullishOr(frame.parent), (parent) => parent.node))

const ancestorsOfFrame = (frame: NodeFrame): readonly Node[] =>
  Option.match(Option.fromNullishOr(frame.parent), {
    onNone: () => [],
    onSome: (parent) => [parent.node, ...ancestorsOfFrame(parent)],
  })

const placementFactsOf = (frame: NodeFrame): PlacementFacts => ({
  isExpression: isExpressionKind(frame.node),
  isStatement: isStatementKind(frame.node),
  isSwitchCase: nodeType(frame.node) === 'SwitchCase',
  expressionIsValid: isValidExpression(frame.node, parentNodeOf(frame)),
})

const placerNameOf = (site: EditSite): PlacerName =>
  Match.value(site).pipe(
    Match.tag('ExpressionSite', (): PlacerName => 'expression'),
    Match.tag('StatementSite', (): PlacerName => 'statement'),
    Match.tag('SwitchCaseSite', (): PlacerName => 'switch-case'),
    Match.exhaustive,
  )

const replacementRecord = (mutant: Mutant, applied: Node): PlacedMutant => {
  const replacement = unwrapParenthesizedExpression(applied)
  return {
    id: mutant.id,
    mutatorName: mutant.mutatorName,
    replacement: {
      isExpression: isExpressionKind(replacement),
      isStatement: isStatementKind(replacement),
      isSwitchCase: nodeType(replacement) === 'SwitchCase',
    },
  }
}

const plannedWithNodes = (
  candidates: readonly MutableCandidate[],
  planned: readonly PlannedMutant[],
  fileName: string,
): readonly Mutant[] =>
  candidates.flatMap((candidate, index) =>
    Option.match(Option.fromNullishOr(planned[index]), {
      onNone: () => [],
      onSome: (mutant) => [createMutant(mutant, fileName, candidate.node, candidate.replacement)],
    })
  )

const ignorersReasonFor = (
  node: Node,
  ancestors: readonly Node[],
  ignorers: readonly Ignorer[],
): Option.Option<string> =>
  ignorers.reduce(
    (reason, ignorer) => Option.orElse(reason, () => Option.fromNullishOr(ignorer.shouldIgnore(node, ancestors))),
    Option.none<string>(),
  )

const mutablesFor = (
  frame: NodeFrame,
  location: SourceLocationInFile,
  context: PlacementContext,
): readonly MutableCandidate[] => {
  const ancestors = ancestorsOfFrame(frame)
  const mutatorContext = toMutatorContext(ancestors)
  const replacements = context.mutatorEntries.flatMap(([mutatorName, mutate]) =>
    [...mutate(frame.node, mutatorContext)].map((replacement) => ({ mutatorName, replacement }))
  )
  const ignorerReason = replacements.length === 0
    ? undefined
    : Option.getOrUndefined(ignorersReasonFor(frame.node, ancestors, context.ignorers))
  return replacements.map(({ mutatorName, replacement }): MutableCandidate => ({
    node: frame.node,
    replacement,
    data: {
      mutatorName,
      replacementCode: printNode(replacement),
      location,
      ignorerReason,
    },
  }))
}

const mutateRangesOf = (mutateDescription: MutateDescription): Option.Option<readonly SourceLocationInFile[]> =>
  Option.filter(Option.some(mutateDescription), isMutateRangeList)

const isOutsideMutateRanges = (location: SourceLocationInFile, mutateDescription: MutateDescription): boolean =>
  Option.exists(
    mutateRangesOf(mutateDescription),
    (ranges) => ranges.every((range) => !locationOverlaps(range, location)),
  )

const isInsideMutateRanges = (location: SourceLocationInFile, mutateDescription: MutateDescription): boolean =>
  Option.exists(
    mutateRangesOf(mutateDescription),
    (ranges) => ranges.some((range) => locationIncluded(range, location)),
  )

const shouldMutateAt = (location: SourceLocationInFile, mutateDescription: MutateDescription): boolean =>
  mutateDescription === true || isInsideMutateRanges(location, mutateDescription)

const shouldSkipNode = (
  frame: NodeFrame,
  location: SourceLocationInFile,
  mutateDescription: MutateDescription,
): boolean =>
  [
    isTypeNode(frame.node),
    isImportDeclaration(frame.node),
    nodeType(frame.node) === 'Decorator',
    mutateDescription === false,
    isOutsideMutateRanges(location, mutateDescription),
  ].some((skip) => skip)

const locationOfNode = (
  frame: NodeFrame,
  context: PlacementContext,
): Result.Result<SourceLocationInFile, NodeWithoutSpan> =>
  Option.match(
    Option.map(Option.fromNullishOr(spanOf(frame.node)), (span) => ({
      start: context.lineTable.positionAt(span.start),
      end: context.lineTable.positionAt(span.end),
    })),
    {
      onNone: () => Result.fail(NodeWithoutSpan.make({ fileName: context.fileName })),
      onSome: Result.succeed,
    },
  )

const refusedPlacement = (
  refusal: PlacementRefusal,
  node: Node,
  mutants: readonly Mutant[],
  context: PlacementContext,
): PlacementRefused =>
  PlacementRefused.make({
    message: placementFailureMessage(refusal, node, mutants, context.fileName, context.lineTable, context.basePath),
  })

const applyMutantToClaim = (
  mutant: Mutant,
  target: Node,
  appliedSoFar: readonly Mutant[],
  context: PlacementContext,
): Result.Result<Node, InstrumentationRefusal> =>
  Result.mapError(
    applyMutant(mutant, target),
    (failure) => refusedPlacement(failure, target, appliedSoFar, context),
  )

const applyToClaim = (
  mutants: readonly Mutant[],
  target: NodeFrame,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> => {
  const existing = state.claims.find((claim) => claim.node === target.node)
  const priorMutants = existing === undefined ? [] : existing.applied.map(([mutant]) => mutant)
  const applied = mutants.reduce<Result.Result<readonly (readonly [Mutant, Node])[], InstrumentationRefusal>>(
    (accumulated, mutant) =>
      Result.flatMap(accumulated, (entries) =>
        Result.map(
          applyMutantToClaim(mutant, target.node, [...priorMutants, ...entries.map(([entry]) => entry)], context),
          (tree) => [...entries, [mutant, tree] as const],
        )),
    Result.succeed([]),
  )
  return Result.map(applied, (entries) => ({
    ...state,
    claims: state.claims.map((claim) =>
      claim.node === target.node ? { ...claim, applied: [...claim.applied, ...entries] } : claim
    ),
  }))
}

const attachPlaceable = (
  mutants: readonly Mutant[],
  frame: NodeFrame,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> =>
  Match.value(mutants.length > 0).pipe(
    Match.when(false, () => Result.succeed(state)),
    Match.when(true, () =>
      Option.match(
        Option.fromNullishOr(
          framesUpward(frame).find((candidate) => state.claims.some((claim) => claim.node === candidate.node)),
        ),
        {
          onNone: () =>
            Result.fail(
              MutantsUnplaced.make({ fileName: context.fileName, detail: JSON.stringify(mutants, null, 2) }),
            ),
          onSome: (target) => applyToClaim(mutants, target, state, context),
        },
      )),
    Match.exhaustive,
  )

const collectPlan = (
  frame: NodeFrame,
  candidates: readonly MutableCandidate[],
  plan: MutantPlan,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> => {
  const collected = plannedWithNodes(candidates, plan.mutants, context.fileName)
  const nextState: FoldState = {
    ...state,
    mutants: [...state.mutants, ...collected],
    warnings: [...state.warnings, ...plan.warnings],
    nextIndex: plan.nextIndex,
  }
  return Match.value(plan).pipe(
    Match.tag('MutantsPlanned', (planned) =>
      attachPlaceable(
        plannedWithNodes(candidates, planned.placeable, context.fileName),
        frame,
        { ...nextState, hasLiveMutants: true },
        context,
      )),
    Match.orElse(() => Result.succeed(nextState)),
  )
}

const planMutantsAt = (
  frame: NodeFrame,
  candidates: readonly MutableCandidate[],
  directives: readonly LocatedDirective[],
  location: SourceLocationInFile,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> => {
  const plan = planMutants(
    PlanMutantsCommand.make({
      fileName: context.fileName,
      firstIndex: state.nextIndex,
      offset: context.offset,
      line: location.start.line,
      mutatorNames: [...context.allMutatorNames],
      excludedMutations: [...context.excludedMutations],
      rule: [...state.directiveRule],
      directives: [...directives],
      candidates: candidates.map((candidate) => candidate.data),
    }),
  )
  return Match.value(plan).pipe(
    Match.when(Result.isFailure, (failed) => Result.fail(failed.failure)),
    Match.orElse((succeeded) => collectPlan(frame, candidates, succeeded.success, state, context)),
  )
}

const candidatesFor = (
  frame: NodeFrame,
  location: SourceLocationInFile,
  context: PlacementContext,
): readonly MutableCandidate[] =>
  Match.value(shouldMutateAt(location, context.mutateDescription)).pipe(
    Match.when(true, () => mutablesFor(frame, location, context)),
    Match.orElse((): readonly MutableCandidate[] => []),
  )

const needsPlan = (
  candidates: readonly MutableCandidate[],
  directives: readonly LocatedDirective[],
): boolean => [candidates.length > 0, directives.length > 0].some(Boolean)

const planAtNode = (
  frame: NodeFrame,
  directives: readonly LocatedDirective[],
  location: SourceLocationInFile,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> => {
  const candidates = candidatesFor(frame, location, context)
  return Match.value(needsPlan(candidates, directives)).pipe(
    Match.when(false, () => Result.succeed(state)),
    Match.when(true, () => planMutantsAt(frame, candidates, directives, location, state, context)),
    Match.exhaustive,
  )
}

const claimSelf = (
  frame: NodeFrame,
  facts: PlacementFacts,
  claims: readonly ClaimedSite[],
  context: PlacementContext,
): readonly ClaimedSite[] => {
  const claimed = placeMutants(PlaceMutantsCommand.make({ fileName: context.fileName, facts, mutants: [] }))
  return Match.value(claimed.pipe(Result.isSuccess)).pipe(
    Match.when(true, () => [...claims, { node: frame.node, facts, applied: [] }]),
    Match.orElse(() => claims),
  )
}

const siteOfClaim = (
  claim: ClaimedSite,
  context: PlacementContext,
): Result.Result<EditSite, InstrumentationRefusal> => {
  const mutants = claim.applied.map(([mutant]) => mutant)
  const decision = placeMutants(
    PlaceMutantsCommand.make({
      fileName: context.fileName,
      facts: claim.facts,
      mutants: claim.applied.map(([mutant, applied]) => replacementRecord(mutant, applied)),
    }),
  )
  return Match.value(decision).pipe(
    Match.when(
      Result.isFailure,
      (refused) => Result.fail(refusedPlacement(refused.failure, claim.node, mutants, context)),
    ),
    Match.orElse((decided) => Result.succeed(decided.success)),
  )
}

const emitClaim = (
  claim: ClaimedSite,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> =>
  Match.value(claim.applied.length > 0).pipe(
    Match.when(false, () => Result.succeed(state)),
    Match.when(true, () =>
      Result.map(
        siteOfClaim(claim, context),
        (site) => ({
          ...state,
          placements: [...state.placements, { node: claim.node, placer: placerNameOf(site), applied: claim.applied }],
        }),
      )),
    Match.exhaustive,
  )

const emitPlacement = (
  frame: NodeFrame,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> =>
  Option.match(
    Option.fromNullishOr(state.claims.find((claim) => claim.node === frame.node)),
    {
      onNone: () => Result.succeed(state),
      onSome: (claim) => emitClaim(claim, state, context),
    },
  )

const foldChildren = (
  frame: NodeFrame,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> =>
  childNodes(frame.node).reduce<Result.Result<FoldState, InstrumentationRefusal>>(
    (accumulated, child) =>
      Result.flatMap(accumulated, (current) => foldPlacements({ node: child.node, parent: frame }, current, context)),
    Result.succeed(state),
  )

const visitFrame = (
  frame: NodeFrame,
  directives: readonly LocatedDirective[],
  location: SourceLocationInFile,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> => {
  const facts = placementFactsOf(frame)
  const claimed = claimSelf(frame, facts, state.claims, context)
  return Result.flatMap(
    planAtNode(frame, directives, location, { ...state, claims: claimed }, context),
    (afterPlan) =>
      Result.flatMap(
        foldChildren(frame, afterPlan, context),
        (afterChildren) => emitPlacement(frame, afterChildren, context),
      ),
  )
}

const foldPlacements = (
  frame: NodeFrame,
  state: FoldState,
  context: PlacementContext,
): Result.Result<FoldState, InstrumentationRefusal> =>
  Result.flatMap(locationOfNode(frame, context), (location) => {
    const directives = directivesOf(frame.node, location.start.line)
    const ruled: FoldState = { ...state, directiveRule: directives.reduce(foldInto, state.directiveRule) }
    return Match.value(shouldSkipNode(frame, location, context.mutateDescription)).pipe(
      Match.when(true, () => Result.succeed(ruled)),
      Match.when(false, () => visitFrame(frame, directives, location, ruled, context)),
      Match.exhaustive,
    )
  })

const planInstrumentation = (
  root: Program,
  firstIndex: number,
  context: PlacementContext,
): Result.Result<InstrumentationPlan, InstrumentationRefusal> =>
  Result.map(
    foldPlacements({ node: root, parent: null }, initialFoldState(firstIndex), context),
    (state) => ({
      mutants: state.mutants,
      placements: state.placements,
      warnings: state.warnings,
      hasLiveMutants: state.hasLiveMutants,
    }),
  )

const applyOnePlacement = (
  placement: PlannedPlacement,
  path: TraversePath,
  previous: Error | undefined,
  context: PlacementContext,
): Error | undefined => {
  const result = placerBuilders[placement.placer].place(path, new Map(placement.applied))
  return Result.match(result, {
    onFailure: (cause) =>
      new Error(
        placementFailureMessage(
          MutantsUnapplied.make({
            fileName: context.fileName,
            placer: placement.placer,
            mutatorNames: placement.applied.map(([mutant]) => mutant.mutatorName),
            cause: toError(cause),
          }),
          placement.node,
          placement.applied.map(([mutant]) => mutant),
          context.fileName,
          context.lineTable,
          context.basePath,
        ),
      ),
    onSuccess: () => previous,
  })
}

const applyPlacementsToAst = (
  root: Program,
  places: ReadonlyMap<Node, PlannedPlacement>,
  context: PlacementContext,
): Error | undefined => {
  let failure: Error | undefined
  traverse(make(root), {
    exit(path) {
      Option.match(Option.fromNullishOr(places.get(path.node)), {
        onNone: () => undefined,
        onSome: (placement) => {
          failure = applyOnePlacement(placement, path, failure, context)
        },
      })
    },
  })
  return failure
}

const applyPlan = (
  root: Program,
  plan: InstrumentationPlan,
  context: PlacementContext,
): Effect.Effect<void, InstrumentError> => {
  const places = new Map(plan.placements.map((placement) => [placement.node, placement] as const))
  return Option.match(Option.fromNullishOr(applyPlacementsToAst(root, places, context)), {
    onNone: () => Effect.void,
    onSome: (error) => Effect.fail(InstrumentError.make({ message: error.message, cause: error })),
  })
}

const refusalError = (refusal: InstrumentationRefusal): InstrumentError =>
  Match.value(refusal).pipe(
    Match.tag('NodeWithoutSpan', () => InstrumentError.make({ message: 'Node without a span', cause: undefined })),
    Match.tag('MutantsUnplaced', (unplaced) =>
      InstrumentError.make({
        message: `Mutants cannot be placed. This shouldn't happen! Unplaced mutants: ${unplaced.detail}`,
        cause: undefined,
      })),
    Match.tag('PlacementRefused', (refused) =>
      InstrumentError.make({ message: refused.message, cause: new Error(refused.message) })),
    Match.tag('MutantWithoutLocation', (failed) =>
      InstrumentError.make({
        message: `Mutant without a source location: ${failed.mutatorName} in ${failed.fileName}`,
        cause: undefined,
      })),
    Match.exhaustive,
  )

const transformScriptDataFirst: AstTransformer<ScriptAst> = (
  { root, originFileName, rawContent, offset, comments },
  mutantCollector,
  { options, mutateDescription, basePath },
) =>
  Effect.gen(function*() {
    const lineTable = yield* Effect.orDie(S.decodeEffect(LineTableFromText)(rawContent))
    attachComments(make(root), comments, lineTable)

    const selection = selectMutators(DEFAULT_MUTATOR_REGISTRY, options.optInMutations)
    const context: PlacementContext = {
      fileName: originFileName,
      lineTable,
      mutateDescription,
      offset: offset ?? MUTATION_OFFSET,
      basePath,
      mutatorEntries: selection.active,
      allMutatorNames: selection.known.map((name) => name.toLowerCase()),
      excludedMutations: options.excludedMutations,
      ignorers: options.ignorers,
    }

    const planned = yield* Effect.try({
      try: () => planInstrumentation(root, mutantCollector.nextIndex, context),
      catch: traversalFailure,
    })
    const plan = yield* Match.value(planned).pipe(
      Match.when(Result.isFailure, (refused) => {
        const error = refusalError(refused.failure)
        return Effect.fail(error)
      }),
      Match.orElse((succeeded) => Effect.succeed(succeeded.success)),
    )

    mutantCollector.append(plan.mutants)
    yield* applyPlan(root, plan, context)
    yield* placeHeaderIfNeeded(plan.hasLiveMutants, options, root)

    return plan.warnings
  })

export const transformScript: {
  (
    ast: ScriptAst,
    mutantCollector: MutantCollector,
    context: TransformerContext,
  ): Effect.Effect<readonly string[], ParseFailed | InstrumentError>
  (
    mutantCollector: MutantCollector,
    context: TransformerContext,
  ): (ast: ScriptAst) => Effect.Effect<readonly string[], ParseFailed | InstrumentError>
} = dual((args: IArguments): boolean => args.length >= 3, transformScriptDataFirst)

function toMutatorContext(ancestors: readonly Node[]): MutatorContext {
  return {
    parent: ancestors[0],
    grandParent: ancestors[1],
    ancestors: [...ancestors],
  }
}

const toError = <A = unknown>(value: A): Error =>
  value instanceof Error ? value : new Error('Unexpected error', { cause: value })
