import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import type {
  CallExpression,
  FunctionLikeWithBodyBase,
  ModifierFlags,
  ModuleDeclaration,
  Node,
  SourceFile,
  SyntaxKind,
} from 'typescript/unstable/ast'

export interface Span {
  readonly start: number
  readonly end: number
}

export const EditSpan = S.Struct({
  start: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  length: S.Int.check(S.isGreaterThanOrEqualTo(0)),
})
export type EditSpan = typeof EditSpan.Type

export const FunctionLikeFacts = S.Struct({
  kind: S.Int,
  start: S.Int,
  bodyStart: S.Int,
  bodyEnd: S.Int,
  blockBody: S.Boolean,
  header: S.String,
  bodyIndependentSignature: S.Boolean,
})
export type FunctionLikeFacts = typeof FunctionLikeFacts.Type

export const EditSiteFacts = S.Struct({
  span: EditSpan,
  typescriptModule: S.Boolean,
  declaresGlobal: S.Boolean,
  moduleReference: S.Boolean,
  syntaxErrors: S.Boolean,
  enclosing: S.Array(FunctionLikeFacts),
})
export type EditSiteFacts = typeof EditSiteFacts.Type

const IDENTIFIER: SyntaxKind.Identifier = 79
const IMPORT_KEYWORD: SyntaxKind.ImportKeyword = 101
const METHOD_DECLARATION: SyntaxKind.MethodDeclaration = 175
const CONSTRUCTOR: SyntaxKind.Constructor = 177
const GET_ACCESSOR: SyntaxKind.GetAccessor = 178
const SET_ACCESSOR: SyntaxKind.SetAccessor = 179
const IMPORT_TYPE: SyntaxKind.ImportType = 206
const CALL_EXPRESSION: SyntaxKind.CallExpression = 214
const FUNCTION_EXPRESSION: SyntaxKind.FunctionExpression = 219
const ARROW_FUNCTION: SyntaxKind.ArrowFunction = 220
const BLOCK: SyntaxKind.Block = 242
const FUNCTION_DECLARATION: SyntaxKind.FunctionDeclaration = 263
const MODULE_DECLARATION: SyntaxKind.ModuleDeclaration = 268
const AMBIENT: ModifierFlags.Ambient = 128

const FUNCTION_LIKE_KINDS: ReadonlyArray<SyntaxKind> = [
  FUNCTION_DECLARATION,
  FUNCTION_EXPRESSION,
  ARROW_FUNCTION,
  METHOD_DECLARATION,
  CONSTRUCTOR,
  GET_ACCESSOR,
  SET_ACCESSOR,
]

const SIGNATURE_FREE_KINDS: ReadonlyArray<SyntaxKind> = [CONSTRUCTOR, SET_ACCESSOR]

const isFunctionLikeWithBody = (node: Node): node is FunctionLikeWithBodyBase =>
  Arr.contains(FUNCTION_LIKE_KINDS, node.kind)

const isModuleDeclaration = (node: Node): node is ModuleDeclaration => node.kind === MODULE_DECLARATION

const isCallExpression = (node: Node): node is CallExpression => node.kind === CALL_EXPRESSION

const isAmbientGlobal = (sourceFile: SourceFile, statement: Node): boolean =>
  Option.exists(
    Option.liftPredicate(isModuleDeclaration)(statement),
    (declaration) =>
      Boolean.and(
        (declaration.modifierFlags & AMBIENT) !== 0,
        declaration.name.getText(sourceFile) === 'global',
      ),
  )

const declaresGlobalOf = (sourceFile: SourceFile): boolean =>
  Arr.some(sourceFile.statements, (statement) => isAmbientGlobal(sourceFile, statement))

const MODULE_FILE_NAME = /\.(ts|tsx|mts|cts)$/iu
const DECLARATION_FILE_NAME = /\.d\.(ts|mts|cts)$/iu

const isTypeScriptModuleFileName = (fileName: string): boolean =>
  Boolean.and(MODULE_FILE_NAME.test(fileName), Boolean.not(DECLARATION_FILE_NAME.test(fileName)))

const containsSpan = (node: Node, span: Span): boolean =>
  Boolean.and(node.getStart(node.getSourceFile()) <= span.start, span.end <= node.end)

const overlapsSpan = (node: Node, span: Span): boolean =>
  Boolean.and(node.getStart(node.getSourceFile()) <= span.end, span.start <= node.end)

const isImportCall = (node: Node): boolean =>
  Option.exists(Option.liftPredicate(isCallExpression)(node), (call) => call.expression.kind === IMPORT_KEYWORD)

const isRequireCall = (node: Node, sourceFile: SourceFile): boolean =>
  Option.exists(
    Option.liftPredicate(isCallExpression)(node),
    (call) => Boolean.and(call.expression.kind === IDENTIFIER, call.expression.getText(sourceFile) === 'require'),
  )

const isModuleReference = (node: Node, sourceFile: SourceFile): boolean =>
  Boolean.or(node.kind === IMPORT_TYPE, Boolean.or(isImportCall(node), isRequireCall(node, sourceFile)))

const bodyIndependentSignatureOf = (node: FunctionLikeWithBodyBase): boolean =>
  Boolean.or(Arr.contains(SIGNATURE_FREE_KINDS, node.kind), node.type !== undefined)

interface FunctionLikeBody {
  readonly node: FunctionLikeWithBodyBase
  readonly body: Node
}

const functionLikeBodyOf = (node: Node): Option.Option<FunctionLikeBody> =>
  Option.flatMap(
    Option.liftPredicate(isFunctionLikeWithBody)(node),
    (found) => Option.map(Option.fromUndefinedOr(found.body), (body) => ({ node: found, body })),
  )

const factsOf = (found: FunctionLikeBody, sourceFile: SourceFile): FunctionLikeFacts => {
  const start = found.node.getStart(sourceFile)
  const bodyStart = found.body.getStart(sourceFile)
  return {
    kind: found.node.kind,
    start,
    bodyStart,
    bodyEnd: found.body.end,
    blockBody: found.body.kind === BLOCK,
    header: sourceFile.text.slice(start, bodyStart),
    bodyIndependentSignature: bodyIndependentSignatureOf(found.node),
  }
}

interface SiteScan {
  readonly enclosing: ReadonlyArray<FunctionLikeFacts>
  readonly moduleReference: boolean
}

const scanOf = (sourceFile: SourceFile, span: Span): SiteScan => {
  const enclosing: Array<FunctionLikeFacts> = []
  let moduleReference = false
  const inspect = (node: Node): undefined => {
    Option.match(Option.filter(functionLikeBodyOf(node), (found) => containsSpan(found.node, span)), {
      onNone: () => undefined,
      onSome: (found) => enclosing.push(factsOf(found, sourceFile)),
    })
    moduleReference = Boolean.or(
      moduleReference,
      Boolean.and(isModuleReference(node, sourceFile), overlapsSpan(node, span)),
    )
    return node.forEachChild(visit)
  }
  const visit = (node: Node): undefined =>
    Boolean.match(node.end < span.start, { onTrue: () => undefined, onFalse: () => inspect(node) })
  sourceFile.forEachChild(visit)
  return { enclosing, moduleReference }
}

export const editSiteFactsOf: {
  (span: Span, syntaxErrors: boolean): (sourceFile: SourceFile) => EditSiteFacts
  (sourceFile: SourceFile, span: Span, syntaxErrors: boolean): EditSiteFacts
} = dual(3, (sourceFile: SourceFile, span: Span, syntaxErrors: boolean): EditSiteFacts => {
  const scan = scanOf(sourceFile, span)
  return {
    span: { start: span.start, length: span.end - span.start },
    typescriptModule: Boolean.and(
      isTypeScriptModuleFileName(sourceFile.fileName),
      sourceFile.externalModuleIndicator !== undefined,
    ),
    declaresGlobal: declaresGlobalOf(sourceFile),
    moduleReference: scan.moduleReference,
    syntaxErrors,
    enclosing: scan.enclosing,
  }
})
