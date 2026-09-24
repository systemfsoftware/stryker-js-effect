import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import {
  type ArrowFunctionExpression,
  arrowFunctionExpression,
  attachComments,
  blockStatement,
  buildLineTable,
  callExpression,
  type ClassExpression,
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
import { decodeDirective, DecodeDirectiveCommand } from './directives/decode-directive.workflow.js'
import { type Directive, type LocatedDirective } from './directives/directive.schema.js'
import { foldRule, FoldRuleCommand, type MutantRule } from './directives/fold-rule.workflow.js'
import type { FormatRegistry } from './format-registry.js'
import { COVER_MUTANT_HELPER, IS_MUTANT_ACTIVE_HELPER, placeHeaderIfNeeded } from './instrument-header.js'
import { MutantsUnapplied, type MutateDescription, type PlacerName } from './Instrument.schema.js'
import { InstrumentError } from './Instrument.schema.js'
import { type MutatorContext, type MutatorOptions } from './Mutator.js'
import { allMutators, applyMutant, createMutant, type Mutant } from './Mutator.js'
import { type ParseFailed } from './Parser.js'
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
  ignorers: readonly Ignorer[]
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

const decidedDirective = (commentText: string): Option.Option<Directive> =>
  Match.value(decodeDirective(DecodeDirectiveCommand.make({ commentText }))).pipe(
    Match.when(Result.isSuccess, (decoded) =>
      Match.value(decoded.success).pipe(
        Match.tag('DirectiveDecoded', (decision) => Option.some(decision.directive)),
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
  Match.value(foldRule(FoldRuleCommand.make({ rule, directive }))).pipe(
    Match.when(Result.isSuccess, (folded) => folded.success.rule),
    Match.orElse(() => rule),
  )

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
  return leadingCommentsOn(node) ?? NO_COMMENTS
}

function leadingCommentsOn<A = unknown>(value: A): readonly LocatedComment[] | undefined {
  if (isCommentBearing(value)) return value.leadingComments
  return undefined
}

function isCommentBearing(value: unknown): value is NodeWithLeadingComments {
  return Predicate.hasProperty(value, 'leadingComments')
}

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
  nodePath: TraversePath,
  mutants: readonly Mutant[],
  fileName: string,
  lineTable: readonly number[],
  basePath?: string,
): Error => {
  const message = `${refusalPlacer(refusal)} could not place mutants with type(s): "${
    placementListFormat.format(mutants.map((mutant) => mutant.mutatorName))
  }"`
  return new Error(
    `${
      placementLocation(nodePath.node, fileName, lineTable, basePath)
    } ${message}. Either remove this file from the list of files to be mutated, or exclude the mutator (using \`mutator.excludedMutations\`). Original error: ${
      refusalDetail(refusal)
    }`,
  )
}

export function nodeOfKind<T extends Node>(
  mutant: Mutant,
  node: Node,
  isKind: (candidate: Node) => candidate is T,
  kind: string,
): T {
  return narrowNode(node, isKind, `Cannot place mutant ${mutant.id}: expected ${kind}, got ${node.type}`)
}

function narrowNode<T extends Node>(
  node: Node,
  isKind: (candidate: Node) => candidate is T,
  message: string,
): T {
  if (isKind(node)) return node
  throw new Error(message)
}

function expressionOf(node: Node): Expression {
  return narrowNode(node, isExpressionKind, `Expected an expression, got ${node.type}`)
}

function statementOf(node: Node): Statement {
  return narrowNode(node, isStatementKind, `Expected a statement, got ${node.type}`)
}

interface SwitchCaseShape {
  readonly test: Expression | null
  readonly consequent: Statement[]
}

function isSwitchCase(node: Node): node is Node & SwitchCaseShape {
  return nodeType(node) === 'SwitchCase'
}

function switchCaseOf(node: Node): Node & SwitchCaseShape {
  return narrowNode(node, isSwitchCase, `Expected a switch case, got ${node.type}`)
}

const fileNameWithin = (basePath: string | undefined, fileName: string): string => {
  if (basePath === undefined) {
    return fileName
  }
  return relativeTo(basePath, fileName)
}

function placementLocation(node: Node, fileName: string, lineTable: readonly number[], basePath?: string): string {
  const relativeFile = fileNameWithin(basePath, fileName)
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
const placementListFormat = new Intl.ListFormat('en')

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

const withTrailingSlash = (basePath: string): string => {
  const normalized = normalizeSeparators(basePath)
  if (normalized.endsWith('/')) {
    return normalized
  }
  return `${normalized}/`
}

const relativeTo = (basePath: string, fileName: string): string => {
  const prefix = withTrailingSlash(basePath)
  const normalizedFile = normalizeSeparators(fileName)
  if (!normalizedFile.startsWith(prefix)) {
    return fileName
  }
  return normalizedFile.slice(prefix.length)
}

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
  return arrowFunctionExpressionNamedIfNeeded(path) ?? expressionOf(path.node)
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
    let expression = nameIfAnonymous(path)
    expression = mutationCoverageSequenceExpression(
      appliedMutants.keys(),
      expression,
    )
    for (const [mutant, appliedMutant] of appliedMutants) {
      expression = conditionalExpression(
        mutantTestExpression(mutant.id),
        nodeOfKind(
          mutant,
          unwrapParenthesizedExpression(appliedMutant),
          isExpressionKind,
          'an expression',
        ),
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
  return [statementOf(node)]
}

function guardedStatement(statement: Statement, entry: readonly [Mutant, Node]): Statement {
  return ifStatement(
    mutantTestExpression(entry[0].id),
    blockStatement([nodeOfKind(entry[0], entry[1], isStatementKind, 'a statement')]),
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
    const currentCase = switchCaseOf(path.node)
    let consequence: Statement = blockStatement([
      expressionStatement(
        mutationCoverageSequenceExpression(appliedMutants.keys()),
      ),
      ...currentCase.consequent,
    ])
    for (const [mutant, appliedMutant] of appliedMutants) {
      const appliedCase = nodeOfKind(mutant, appliedMutant, isSwitchCase, 'a switch case')
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

export const transform = (
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

const emptyAppliedMutants = (): Map<Mutant, Node> => new Map()

function isMutateRangeList(value: MutateDescription): value is readonly SourceLocationInFile[] {
  return Array.isArray(value)
}

export const transformScript: AstTransformer<ScriptAst> = (
  { root, originFileName, rawContent, offset, comments },
  mutantCollector,
  { options, mutateDescription, basePath },
) => {
  const placementMap: PlacementMap = new Map()
  return Effect.gen(function*() {
    const lineTable = buildLineTable(rawContent)

    attachComments(root, comments, lineTable)
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

    yield* placeHeaderIfNeeded(hasLiveMutants, options, root)

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
        Match.tag('ExpressionSite', (): PlacerName => 'expression'),
        Match.tag('StatementSite', (): PlacerName => 'statement'),
        Match.tag('SwitchCaseSite', (): PlacerName => 'switch-case'),
        Match.exhaustive,
      )
    }
    function addToPlacementMapIfPossible(path: TraversePath): void {
      const facts = placementFacts(path)
      const claimed = placeMutants(PlaceMutantsCommand.make({ fileName: originFileName, facts, mutants: [] }))
      Match.value(claimed).pipe(
        Match.when(
          Result.isSuccess,
          () => placementMap.set(path.node, { appliedMutants: emptyAppliedMutants(), facts }),
        ),
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
      throw placementFailure(
        refusal,
        path,
        [...placement.appliedMutants.keys()],
        originFileName,
        lineTable,
        basePath,
      )
    }
    function placeSite(site: EditSite, placement: MutantsPlacement, path: TraversePath): void {
      try {
        placerBuilders[placerNameOf(site)].place(path, placement.appliedMutants)
        path.skip()
      } catch (error) {
        raisePlacementRefusal(
          MutantsUnapplied.make({
            fileName: originFileName,
            placer: placerNameOf(site),
            mutatorNames: [...placement.appliedMutants.keys()].map((mutant) => mutant.mutatorName),
            cause: toError(error),
          }),
          placement,
          path,
        )
      }
    }
    function applyPlacement(path: TraversePath, placement: MutantsPlacement): void {
      const decision = placeMutants(
        PlaceMutantsCommand.make({
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
    function placeCollectedMutants(path: TraversePath, directives: readonly LocatedDirective[]): void {
      const candidates = candidateSteps(path)
      Match.value(needsPlan(candidates, directives)).pipe(
        Match.when(true, () => planAndPlace(path, candidates, directives)),
        Match.when(false, () => undefined),
        Match.exhaustive,
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
    function planFor(
      path: TraversePath,
      candidates: readonly MutableCandidate[],
      directives: readonly LocatedDirective[],
    ): Option.Option<readonly Mutant[]> {
      const plan = planMutants(
        PlanMutantsCommand.make({
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
        Match.tag('MutantsPlanned', (planned) => {
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
        (reason, ignorer) => Option.orElse(reason, () => Option.fromNullishOr(ignorer.shouldIgnore(node, ancestors))),
        Option.none<string>(),
      )
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

function toError<A = unknown>(value: A): Error {
  if (value instanceof Error) {
    return value
  }
  return new Error('Unexpected error', { cause: value })
}
