// oxlint-disable typescript/no-unsafe-type-assertion typescript/no-unnecessary-type-assertion

import { type IgnorerService } from '@systemfsoftware/stryker-js-language'
import { type MutateDescription } from '@systemfsoftware/stryker-js-language'
import { propertyPath, type StrykerOptions, strykerReportBugUrl } from '@systemfsoftware/stryker-js-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import path from 'node:path'

import {
  type ArrowFunctionExpression,
  arrowFunctionExpression,
  attachComments,
  blockStatement,
  buildLineTable,
  callExpression,
  type ClassExpression,
  cloneNode,
  type Comment,
  conditionalExpression,
  type Expression,
  expressionStatement,
  type FunctionExpression,
  identifier,
  type IdentifierReference,
  ifStatement,
  isExpressionKind,
  isStatementKind,
  type MemberExpression,
  type Node,
  nodeType,
  positionFromLineTable,
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
} from './Ast.js'
import { decodeDirective, DecodeDirectiveCommand, DirectiveDecoded } from './directives/decode-directive.workflow.js'
import { type Directive, type LocatedDirective } from './directives/directive.schema.js'
import { foldRule, FoldRuleCommand, type MutantRule } from './directives/fold-rule.workflow.js'
import type { FormatRegistry } from './format-registry.js'
import { clonedHeader, COVER_MUTANT_HELPER, IS_MUTANT_ACTIVE_HELPER, shouldPlaceHeader } from './instrument-header.js'
import { MutantsUnapplied, type PlacerName } from './Instrument.schema.js'
import { applyMutant, createMutant, type Mutant } from './Mutator.js'
import { type MutatorContext, type MutatorOptions } from './Mutator.js'
import { allMutators } from './Mutator.js'
import {
  type EditSite,
  ExpressionSite,
  type PlacedMutant,
  type PlacementFacts,
  type PlacementRefusal,
  placeMutants,
  PlaceMutantsCommand,
  StatementSite,
  SwitchCaseSite,
} from './place-mutants.workflow.js'
import {
  type MutantCandidate,
  type MutantPlan,
  MutantsPlanned,
  type PlanFailure,
  planMutants,
  PlanMutantsCommand,
  type PlannedMutant,
} from './plan-mutants.workflow.js'
import { printNode } from './print/index.js'
import {
  type Ast,
  formatKeyOf,
  locationIncluded,
  locationOverlaps,
  type ScriptAst,
  type SourceLocationInFile,
} from './Syntax.js'
import { PlacementFailed, TransformFailed } from './Transformer.schema.js'
export { PlacementFailed, TransformFailed }

export interface TransformerOptions extends MutatorOptions {
  ignorers: IgnorerService[]
}

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

interface LocatedComment extends Comment {
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}

interface NodeWithLeadingComments {
  readonly leadingComments?: readonly LocatedComment[]
}

const NO_COMMENTS: readonly LocatedComment[] = []

function attachedComments(node: Node): readonly LocatedComment[] {
  const host = node as NodeWithLeadingComments
  return host.leadingComments ?? NO_COMMENTS
}

const decidedDirective = (commentText: string): Option.Option<Directive> =>
  Match.value(decodeDirective(new DecodeDirectiveCommand({ commentText }))).pipe(
    Match.when(Result.isSuccess, (decoded) =>
      Match.value(decoded.success).pipe(
        Match.when(S.is(DirectiveDecoded), (decision) => Option.some(decision.directive)),
        Match.orElse(() => Option.none<Directive>()),
      )),
    Match.orElse(() => Option.none<Directive>()),
  )

const locatedDirective = (comment: LocatedComment): Option.Option<LocatedDirective> =>
  Option.flatMap(
    Option.fromNullishOr(comment.loc),
    (loc) =>
      Option.map(decidedDirective(comment.value), (directive): LocatedDirective => ({ directive, at: loc.start })),
  )

const directivesOf = (node: Node): readonly LocatedDirective[] =>
  attachedComments(node).flatMap((comment) => Option.toArray(locatedDirective(comment)))

const foldInto = (rule: MutantRule, directive: LocatedDirective): MutantRule =>
  Match.value(foldRule(new FoldRuleCommand({ rule, directive }))).pipe(
    Match.when(Result.isSuccess, (folded) => folded.success.rule),
    Match.orElse(() => rule),
  )

function ancestorsOf(path: TraversePath): Node[] {
  const ancestors: Node[] = []
  for (let current = path.parentPath; current !== null; current = current.parentPath) {
    ancestors.push(current.node)
  }
  return ancestors
}

export function isTypeNode(path: TraversePath): boolean {
  return [
    tsTypeAnnotationNodeTypes.includes(path.node.type),
    flowTypeAnnotationNodeTypes.includes(path.node.type),
    isDeclareVariableStatement(path.node),
    isDeclareModule(path.node),
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
  'TSAsExpression',
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

export function isImportDeclaration(path: TraversePath): boolean {
  return (
    nodeType(path.node) === 'TSImportEqualsDeclaration' || path.node.type === 'ImportDeclaration'
  )
}

export function mutantTestExpression(
  mutantId: string,
): Expression {
  return callExpression(identifier(IS_MUTANT_ACTIVE_HELPER), [stringLiteral(mutantId)])
}

export function mutationCoverageSequenceExpression(
  mutants: Iterable<Mutant>,
  targetExpression?: Expression,
): Expression {
  const mutantIds = [...mutants].map((mutant) => stringLiteral(mutant.id))
  const sequence: Expression[] = [
    callExpression(identifier(COVER_MUTANT_HELPER), mutantIds),
  ]
  if (targetExpression) {
    sequence.push(targetExpression)
  }
  return sequenceExpression(sequence)
}

export interface MutantPlacer {
  name: PlacerName
  place(path: TraversePath, appliedMutants: Map<Mutant, Node>): void
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

export const placementFailure = (
  refusal: PlacementRefusal,
  node: Node,
  mutants: readonly Mutant[],
  fileName: string,
  lineTable: readonly number[],
): Error => {
  const message = `${refusalPlacer(refusal)} could not place mutants with type(s): "${
    new Intl.ListFormat('en').format(mutants.map((mutant) => mutant.mutatorName))
  }"`
  return new Error(
    `${
      placementLocation(node, fileName, lineTable)
    } ${message}. Either remove this file from the list of files to be mutated, or exclude the mutator (using ${
      propertyPath<StrykerOptions>()('mutator', 'excludedMutations')
    }). Please report this issue at ${strykerReportBugUrl(message)}. Original error: ${refusalDetail(refusal)}`,
  )
}

function placementLocation(node: Node, fileName: string, lineTable: readonly number[]): string {
  const relativeFile = path.relative(process.cwd(), fileName)
  const position = Option.map(
    Option.fromNullishOr(spanOf(node)),
    (span) => positionFromLineTable(span.start, lineTable),
  )
  return Option.match(position, {
    onNone: () => `${relativeFile}:undefined:undefined`,
    onSome: (at) => `${relativeFile}:${at.line}:${at.column}`,
  })
}

type AnonymousFunctionOrClass = FunctionExpression | ClassExpression

function classOrFunctionExpressionNamedIfNeeded(path: TraversePath): Expression | undefined {
  return Match.value(path.node).pipe(
    Match.when(isAnonymousFunctionOrClass, (node) => nameFromParent(path, node)),
    Match.orElse(() => undefined),
  )
}

function nameFromParent(path: TraversePath, node: AnonymousFunctionOrClass): Expression | undefined {
  return Match.value(path.parentPath?.node).pipe(
    Match.when(isVariableDeclarator, (declarator) => adoptDeclaredName(node, declarator)),
    Match.when({ type: 'Property', key: { type: 'Identifier' } }, () => namedPropertyValue(path, node)),
    Match.orElse(() => undefined),
  )
}

/** A property value only survives by name when the declaration above it carries one. */
function namedPropertyValue(path: TraversePath, node: AnonymousFunctionOrClass): Expression | undefined {
  return Match.value(path.getStatementParent()?.node.type).pipe(
    Match.when('VariableDeclaration', () => node),
    Match.orElse(() => undefined),
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

function arrowFunctionExpressionNamedIfNeeded(path: TraversePath): Expression | undefined {
  return Match.value(path.node).pipe(
    Match.when({ type: 'ArrowFunctionExpression' }, (node) => arrowNamedByDeclarator(node, path.parentPath)),
    Match.orElse(() => undefined),
  )
}

/** An arrow bound to a named declaration is re-emitted as a named function. */
function arrowNamedByDeclarator(
  node: ArrowFunctionExpression,
  parentPath: TraversePath | null,
): Expression | undefined {
  return Option.match(declaratorIdentifier(parentPath), {
    onNone: () => undefined,
    onSome: (identifier) => namedArrowExpression(node, identifier),
  })
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

function adoptDeclaredName(node: AnonymousFunctionOrClass, declarator: VariableDeclarator): Expression | undefined {
  return Option.match(declaredName(declarator), {
    onNone: () => undefined,
    onSome: (identifier) => adoptIdentifier(node, identifier),
  })
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

function nameIfAnonymous(path: TraversePath): Expression {
  return classOrFunctionExpressionNamedIfNeeded(path) ?? arrowNameOrNode(path)
}

function arrowNameOrNode(path: TraversePath): Expression {
  return arrowFunctionExpressionNamedIfNeeded(path) ?? (path.node as Expression)
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

function isValidExpression(path: TraversePath): boolean {
  const parent = path.parentPath
  return parent === null || !isUnmutatableContext(path, parent)
}

function isUnmutatableContext(path: TraversePath, parent: TraversePath): boolean {
  return [
    isObjectPropertyKey(path, parent),
    isPartOfChain(path, parent),
    isTaggedTemplateTag(parent),
    isDeletedOperand(path, parent),
    isAssignedTarget(path, parent),
  ].some((invalid) => invalid)
}

function isObjectPropertyKey(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'Property' && parentNode.key === path.node
}

function isTaggedTemplateTag(parent: TraversePath): boolean {
  return parent.node.type === 'TaggedTemplateExpression'
}

function isDeletedOperand(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'UnaryExpression' && parentNode.operator === 'delete'
}

function isAssignedTarget(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'AssignmentExpression' && parentNode.left === path.node
}

function isPartOfChain(path: TraversePath, parent: TraversePath): boolean {
  return isChainLink(path.node) && chainContinuesIn(path, parent)
}

function chainContinuesIn(path: TraversePath, parent: TraversePath): boolean {
  return [
    isMemberAccessParent(path, parent),
    isNonNullExpression(parent.node),
    isCalleeParent(path, parent),
  ].some((continues) => continues)
}

function isMemberAccessParent(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'MemberExpression' && isNotACallOnTheNode(parentNode, path.node)
}

function isCalleeParent(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'CallExpression' && parentNode.callee === path.node
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
    Option.filter(Option.some<unknown>(node), isParenthesizedWrapper),
    (parenthesized) => Option.map(Option.fromNullishOr(parenthesized.expression), unwrapParenthesizedExpression),
  )
}

function isParenthesizedWrapper(value: unknown): value is ParenthesizedWrapper {
  return Predicate.hasProperty(value, 'type') && value['type'] === 'ParenthesizedExpression'
}

export const expressionMutantPlacer: MutantPlacer = {
  name: 'expression',
  place(path, appliedMutants) {
    let expression = nameIfAnonymous(path)
    expression = mutationCoverageSequenceExpression(
      appliedMutants.keys(),
      expression,
    )
    for (const [mutant, appliedMutant] of appliedMutants) {
      expression = conditionalExpression(
        mutantTestExpression(mutant.id),
        unwrapParenthesizedExpression(appliedMutant) as Expression,
        expression,
      )
    }
    path.replaceWith(expression)
  },
}

export const statementMutantPlacer: MutantPlacer = {
  name: 'statement',
  place(path, appliedMutants) {
    const body = [expressionStatement(mutationCoverageSequenceExpression(appliedMutants.keys())), ...statementsOf(path)]
    const statement = [...appliedMutants].reduce(guardedStatement, blockStatement(body))
    path.replaceWith(wrappedStatement(path, statement))
  },
}

function statementsOf(path: TraversePath): readonly Statement[] {
  const node = path.node
  if (node.type === 'BlockStatement') {
    return node.body
  }
  return [node as Statement]
}

function guardedStatement(statement: Statement, entry: readonly [Mutant, Node]): Statement {
  return ifStatement(
    mutantTestExpression(entry[0].id),
    blockStatement([entry[1] as Statement]),
    statement,
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
    const currentCase = path.node as unknown as { test: Expression | null; consequent: Statement[] }
    let consequence: Statement = blockStatement([
      expressionStatement(
        mutationCoverageSequenceExpression(appliedMutants.keys()),
      ),
      ...currentCase.consequent,
    ])
    for (const [mutant, appliedMutant] of appliedMutants) {
      const appliedCase = appliedMutant as unknown as { consequent: Statement[] }
      consequence = ifStatement(
        mutantTestExpression(mutant.id),
        blockStatement(appliedCase.consequent),
        consequence,
      )
    }
    path.replaceWith(switchCase(currentCase.test, [consequence]))
  },
}

export const placerBuilders: Readonly<Record<PlacerName, MutantPlacer>> = Object.freeze({
  expression: expressionMutantPlacer,
  statement: statementMutantPlacer,
  'switch-case': switchCaseMutantPlacer,
})

export const instrumentationHeader = async (): Promise<readonly Statement[]> => clonedHeader()

export async function placeHeaderIfNeeded(
  hasLiveMutants: boolean,
  options: MutatorOptions,
  root: Program,
): Promise<void> {
  if (shouldPlaceHeader(hasLiveMutants, options.noHeader)) {
    await placeHeader(root)
  }
}

export async function placeHeader(root: Program): Promise<void> {
  root.body.unshift(...(await headerFor(root)))
}

interface CommentBearing {
  leadingComments?: unknown
}

async function headerFor(root: Program): Promise<readonly Statement[]> {
  const header = await clonedHeader()
  return Option.match(leadingCommentsOf(root), {
    onNone: () => header,
    onSome: (leadingComments) => [commentedHeader(leadingComments, header), ...header.slice(1)],
  })
}

function isCommentArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function leadingCommentsOf(root: Program): Option.Option<readonly unknown[]> {
  const firstStatement = root.body[0] as CommentBearing | undefined
  return Option.filter(Option.fromNullishOr(firstStatement?.leadingComments), isCommentArray)
}

function commentedHeader(leadingComments: readonly unknown[], header: readonly Statement[]): Statement {
  const firstHeader = Option.getOrThrowWith(
    Option.fromNullishOr(header[0]),
    () => new Error('Instrumentation header is empty'),
  )
  const cloned = cloneNode(firstHeader) as unknown as CommentBearing
  cloned.leadingComments = leadingComments
  return cloned as unknown as Statement
}

export async function transform(
  ast: Ast,
  mutantCollector: MutantCollector,
  transformerContext: Omit<TransformerContext, 'transform'>,
): Promise<readonly string[]> {
  const context: TransformerContext = {
    ...transformerContext,
    transform,
  }
  const formatKey = formatKeyOf(ast)
  const entry = Option.getOrUndefined(transformerContext.registry.entryForFormat(formatKey))
  if (entry === undefined) {
    throw new Error(`No registered format transforms the "${formatKey}" AST`)
  }
  return entry.transform(ast, mutantCollector, context)
}

export type AstTransformer<T extends Ast = Ast> = (
  ast: T,
  mutantCollector: MutantCollector,
  context: TransformerContext,
) => Promise<readonly string[]>

export interface TransformerContext {
  transform: AstTransformer
  options: TransformerOptions
  mutateDescription: MutateDescription
  registry: FormatRegistry
}

interface MutantsPlacement {
  appliedMutants: Map<Mutant, Node>
  facts: PlacementFacts
}

interface MutableCandidate {
  readonly node: Node
  readonly replacement: Node
  readonly data: MutantCandidate
}

type PlacementMap = Map<Node, MutantsPlacement>

function isMutateRangeList(value: MutateDescription): value is readonly SourceLocationInFile[] {
  return Array.isArray(value)
}

export const transformScript: AstTransformer<ScriptAst> = async (
  { root, originFileName, rawContent, offset, comments },
  mutantCollector,
  { options, mutateDescription },
) => {
  const lineTable = buildLineTable(rawContent)

  attachComments(root, comments, lineTable)

  const placementMap: PlacementMap = new Map()

  let directiveRule: MutantRule = []
  let hasLiveMutants = false
  const mutatorEntries = Object.entries(allMutators)
  const allMutatorNames = mutatorEntries.map(([name]) => name.toLowerCase())

  const warnings: string[] = []

  traverse(root, {
    enter(path) {
      const directives = directivesOf(path.node)
      directiveRule = directives.reduce(foldInto, directiveRule)
      visitNode(path, directives)
    },
    exit(path) {
      const placement = placementMap.get(path.node)
      if (hasAppliedMutants(placement)) {
        applyPlacement(path, placement)
      }
    },
  })

  await placeHeaderIfNeeded(hasLiveMutants, options, root)

  return warnings

  function visitNode(path: TraversePath, directives: readonly LocatedDirective[]): void {
    if (shouldSkip(path)) {
      path.skip()
      return
    }
    addToPlacementMapIfPossible(path)
    placeCollectedMutants(path, directives)
  }
  function placementFacts(path: TraversePath): PlacementFacts {
    return {
      isExpression: path.isExpression(),
      isStatement: path.isStatement(),
      isSwitchCase: nodeType(path.node) === 'SwitchCase',
      expressionIsValid: isValidExpression(path),
    }
  }
  function placerNameOf(site: EditSite): PlacerName {
    return Match.value(site).pipe(
      Match.when(S.is(ExpressionSite), (): PlacerName => 'expression'),
      Match.when(S.is(StatementSite), (): PlacerName => 'statement'),
      Match.when(S.is(SwitchCaseSite), (): PlacerName => 'switch-case'),
      Match.exhaustive,
    )
  }
  function addToPlacementMapIfPossible(path: TraversePath): void {
    const facts = placementFacts(path)
    const claimed = placeMutants(new PlaceMutantsCommand({ fileName: originFileName, facts, mutants: [] }))
    Match.value(claimed).pipe(
      Match.when(Result.isSuccess, () => placementMap.set(path.node, { appliedMutants: new Map(), facts })),
      Match.orElse(() => undefined),
    )
  }
  function hasAppliedMutants(placement: MutantsPlacement | undefined): placement is MutantsPlacement {
    return placement !== undefined && placement.appliedMutants.size > 0
  }
  function replacementRecord(mutant: Mutant, applied: Node): PlacedMutant {
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
  function raisePlacementRefusal(
    refusal: PlacementRefusal,
    placement: MutantsPlacement,
    path: TraversePath,
  ): never {
    throw placementFailure(refusal, path.node, [...placement.appliedMutants.keys()], originFileName, lineTable)
  }
  function placeSite(site: EditSite, placement: MutantsPlacement, path: TraversePath): void {
    try {
      placerBuilders[placerNameOf(site)].place(path, placement.appliedMutants)
      path.skip()
    } catch (error) {
      raisePlacementRefusal(
        new MutantsUnapplied({
          fileName: originFileName,
          placer: placerNameOf(site),
          mutatorNames: [...placement.appliedMutants.keys()].map((mutant) => mutant.mutatorName),
          cause: error,
        }),
        placement,
        path,
      )
    }
  }
  function applyPlacement(path: TraversePath, placement: MutantsPlacement): void {
    const decision = placeMutants(
      new PlaceMutantsCommand({
        fileName: originFileName,
        facts: placement.facts,
        mutants: [...placement.appliedMutants].map(([mutant, applied]) => replacementRecord(mutant, applied)),
      }),
    )
    Match.value(decision).pipe(
      Match.when(Result.isFailure, (refused) => raisePlacementRefusal(refused.failure, placement, path)),
      Match.orElse((decided) => placeSite(decided.success, placement, path)),
    )
  }
  function candidateSteps(path: TraversePath): readonly MutableCandidate[] {
    return Match.value(shouldMutate(path)).pipe(
      Match.when(true, () => mutablesFor(path)),
      Match.when(false, (): readonly MutableCandidate[] => []),
      Match.exhaustive,
    )
  }
  function needsPlan(candidates: readonly MutableCandidate[], directives: readonly LocatedDirective[]): boolean {
    return [candidates.length > 0, directives.length > 0].some(Boolean)
  }
  function planAndPlace(
    path: TraversePath,
    candidates: readonly MutableCandidate[],
    directives: readonly LocatedDirective[],
  ): void {
    Match.value(planFor(path, candidates, directives)).pipe(
      Match.when(Option.isSome, (toPlace) => placeOnPath(path, toPlace.value)),
      Match.orElse(() => undefined),
    )
  }
  function placeCollectedMutants(path: TraversePath, directives: readonly LocatedDirective[]): void {
    const candidates = candidateSteps(path)
    Match.value(needsPlan(candidates, directives)).pipe(
      Match.when(true, () => planAndPlace(path, candidates, directives)),
      Match.when(false, () => undefined),
      Match.exhaustive,
    )
  }
  function planFor(
    path: TraversePath,
    candidates: readonly MutableCandidate[],
    directives: readonly LocatedDirective[],
  ): Option.Option<readonly Mutant[]> {
    const plan = planMutants(
      new PlanMutantsCommand({
        fileName: originFileName,
        firstIndex: mutantCollector.nextIndex,
        offset: offset ?? { line: 0, column: 0 },
        line: getNodeLocation(path.node).start.line,
        mutatorNames: allMutatorNames,
        excludedMutations: options.excludedMutations,
        rule: directiveRule,
        directives: [...directives],
        candidates: candidates.map((candidate) => candidate.data),
      }),
    )
    return Match.value(plan).pipe(
      Match.when(Result.isFailure, (failed) => raisePlanFailure(failed.failure)),
      Match.orElse((succeeded) => collectPlanned(candidates, succeeded.success)),
    )
  }
  function raisePlanFailure(failure: PlanFailure): never {
    throw new Error(`Mutant without a source location: ${failure.mutatorName} in ${failure.fileName}`)
  }
  function collectPlanned(
    candidates: readonly MutableCandidate[],
    plan: MutantPlan,
  ): Option.Option<readonly Mutant[]> {
    mutantCollector.append(plannedWithNodes(candidates, plan.mutants))
    warnings.push(...plan.warnings)
    return Match.value(plan).pipe(
      Match.when(S.is(MutantsPlanned), (planned) => {
        hasLiveMutants = true
        return Option.some(plannedWithNodes(candidates, planned.placeable))
      }),
      Match.orElse(() => Option.none<readonly Mutant[]>()),
    )
  }
  function plannedWithNodes(
    candidates: readonly MutableCandidate[],
    planned: readonly PlannedMutant[],
  ): readonly Mutant[] {
    return candidates.flatMap((candidate, index) =>
      Option.match(Option.fromNullishOr(planned[index]), {
        onNone: () => [],
        onSome: (mutant) => [createMutant(mutant, originFileName, candidate.node, candidate.replacement)],
      })
    )
  }
  function placeOnPath(path: TraversePath, mutantsToPlace: readonly Mutant[]): void {
    const placementPath = requiredPlacementPath(path, mutantsToPlace)
    const placement = requiredPlacement(placementPath.node)
    mutantsToPlace.forEach((mutant) => {
      Match.value(applyMutant(mutant, placementPath.node)).pipe(
        Match.when(Result.isFailure, (failed) => raisePlacementRefusal(failed.failure, placement, path)),
        Match.orElse((applied) => placement.appliedMutants.set(mutant, applied.success)),
      )
    })
  }
  function requiredPlacementPath(path: TraversePath, mutantsToPlace: readonly Mutant[]): TraversePath {
    return Option.getOrThrowWith(
      Option.fromNullishOr(path.find((ancestor) => placementMap.has(ancestor.node))),
      () => unplacedMutantsError(mutantsToPlace),
    )
  }
  function unplacedMutantsError(mutantsToPlace: readonly Mutant[]): Error {
    return new Error(
      `Mutants cannot be placed. This shouldn't happen! Unplaced mutants: ${JSON.stringify(mutantsToPlace, null, 2)}`,
    )
  }
  function requiredPlacement(node: Node): MutantsPlacement {
    return Option.getOrThrowWith(
      Option.fromNullishOr(placementMap.get(node)),
      () => new Error('Placement not found for node'),
    )
  }
  function shouldSkip(path: TraversePath): boolean {
    return [
      isTypeNode(path),
      isImportDeclaration(path),
      nodeType(path.node) === 'Decorator',
      mutateDescription === false,
      isOutsideMutateRanges(path),
    ].some((skip) => skip)
  }
  function mutateRanges(): Option.Option<readonly SourceLocationInFile[]> {
    return Option.filter(Option.some(mutateDescription), isMutateRangeList)
  }
  function isOutsideMutateRanges(path: TraversePath): boolean {
    return Option.exists(
      mutateRanges(),
      (ranges) => ranges.every((range) => !locationOverlaps(range, getNodeLocation(path.node))),
    )
  }
  function shouldMutate(path: TraversePath): boolean {
    return mutateDescription === true || isInsideMutateRanges(path)
  }
  function isInsideMutateRanges(path: TraversePath): boolean {
    return Option.exists(
      mutateRanges(),
      (ranges) => ranges.some((range) => locationIncluded(range, getNodeLocation(path.node))),
    )
  }
  function getNodeLocation(node: Node): SourceLocationInFile {
    const span = spanOf(node)
    if (span === undefined) {
      throw new Error('Node without a span')
    }
    return {
      start: positionFromLineTable(span.start, lineTable),
      end: positionFromLineTable(span.end, lineTable),
    }
  }
  function mutablesFor(path: TraversePath): readonly MutableCandidate[] {
    const ancestors = ancestorsOf(path)
    const context = toMutatorContext(ancestors)
    const location = Option.map(Option.fromNullishOr(spanOf(path.node)), (span) => ({
      start: positionFromLineTable(span.start, lineTable),
      end: positionFromLineTable(span.end, lineTable),
    }))
    return mutatorEntries.flatMap(([mutatorName, mutate]) =>
      [...mutate(path.node, context)].map((replacement): MutableCandidate => ({
        node: path.node,
        replacement,
        data: {
          mutatorName,
          replacementCode: printNode(replacement),
          location: Option.getOrUndefined(location),
          ignorerReason: Option.getOrUndefined(ignorersReason(path.node, ancestors)),
        },
      }))
    )
  }
  function ignorersReason(node: Node, ancestors: readonly Node[]): Option.Option<string> {
    return options.ignorers.reduce(
      (reason, ignorer) => Option.orElse(reason, () => ignorer.shouldIgnore(node, ancestors)),
      Option.none<string>(),
    )
  }
}

function toMutatorContext(ancestors: readonly Node[]): MutatorContext {
  return {
    parent: ancestors[0],
    grandParent: ancestors[1],
    ancestors: [...ancestors],
  }
}
