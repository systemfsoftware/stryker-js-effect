import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import type { FunctionLikeWithBodyBase, Node, SourceFile } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import {
  isArrowFunction,
  isCallExpression,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportTypeNode,
  isMethodDeclaration,
  isModuleDeclaration,
  isSetAccessorDeclaration,
} from 'typescript/unstable/ast/is'
import { ModifierFlags } from 'typescript/unstable/async'

import type { EditSiteFacts, EditSpan, FunctionLikeFacts } from './CheckerCommands.schema.js'

interface Span {
  readonly start: number
  readonly end: number
}

const isAmbientGlobal = (sourceFile: SourceFile, statement: Node): boolean =>
  isModuleDeclaration(statement)
    ? Boolean.and(
      (statement.modifierFlags & ModifierFlags.Ambient) !== 0,
      statement.name.getText(sourceFile) === 'global',
    )
    : false

export const declaresGlobalScope = (sourceFile: SourceFile): boolean =>
  Boolean.or(
    sourceFile.externalModuleIndicator === undefined,
    Arr.some(sourceFile.statements, (statement) => isAmbientGlobal(sourceFile, statement)),
  )

const MODULE_FILE_NAME = /\.(ts|tsx|mts|cts)$/iu
const DECLARATION_FILE_NAME = /\.d\.(ts|mts|cts)$/iu

const isTypeScriptModuleFileName = (fileName: string): boolean =>
  Boolean.and(MODULE_FILE_NAME.test(fileName), Boolean.not(DECLARATION_FILE_NAME.test(fileName)))

const isFunctionLikeWithBody = (node: Node): node is FunctionLikeWithBodyBase =>
  Boolean.or(
    Boolean.or(isFunctionDeclaration(node), isFunctionExpression(node)),
    Boolean.or(
      Boolean.or(isArrowFunction(node), isMethodDeclaration(node)),
      Boolean.or(
        Boolean.or(isConstructorDeclaration(node), isGetAccessorDeclaration(node)),
        isSetAccessorDeclaration(node),
      ),
    ),
  )

const containsSpan = (node: Node, span: Span): boolean => {
  const start = node.getStart(node.getSourceFile())
  return Boolean.and(start <= span.start, span.end <= node.end)
}

const overlapsSpan = (node: Node, span: Span): boolean => {
  const start = node.getStart(node.getSourceFile())
  return Boolean.and(start <= span.end, span.start <= node.end)
}

const isImportCall = (node: Node): boolean =>
  isCallExpression(node) ? node.expression.kind === SyntaxKind.ImportKeyword : false

const isRequireCall = (node: Node, sourceFile: SourceFile): boolean =>
  isCallExpression(node)
    ? Boolean.and(isIdentifier(node.expression), node.expression.getText(sourceFile) === 'require')
    : false

const isModuleReference = (node: Node, sourceFile: SourceFile): boolean =>
  Boolean.or(
    isImportTypeNode(node),
    Boolean.or(isImportCall(node), isRequireCall(node, sourceFile)),
  )

const bodyIndependentSignatureOf = (node: FunctionLikeWithBodyBase): boolean =>
  Boolean.or(
    Boolean.or(isConstructorDeclaration(node), isSetAccessorDeclaration(node)),
    node.type !== undefined,
  )

const factsOf = (node: FunctionLikeWithBodyBase, body: Node, sourceFile: SourceFile): FunctionLikeFacts => {
  const start = node.getStart(sourceFile)
  const bodyStart = body.getStart(sourceFile)
  return {
    kind: node.kind,
    start,
    bodyStart,
    bodyEnd: body.end,
    header: sourceFile.text.slice(start, bodyStart),
    bodyIndependentSignature: bodyIndependentSignatureOf(node),
  }
}

interface FunctionLikeBody {
  readonly node: FunctionLikeWithBodyBase
  readonly body: Node
}

const functionLikeBodyOf = (node: Node): Option.Option<FunctionLikeBody> => {
  if (!isFunctionLikeWithBody(node)) return Option.none()
  return Option.map(Option.fromUndefinedOr(node.body), (body) => ({ node, body }))
}

interface SiteScan {
  readonly enclosing: ReadonlyArray<FunctionLikeFacts>
  readonly moduleReference: boolean
}

const recordEnclosing = (
  into: Array<FunctionLikeFacts>,
  found: FunctionLikeBody,
  span: Span,
  sourceFile: SourceFile,
): void => {
  if (containsSpan(found.node, span)) into.push(factsOf(found.node, found.body, sourceFile))
}

const scanOf = (sourceFile: SourceFile, span: Span): SiteScan => {
  const enclosing: Array<FunctionLikeFacts> = []
  let moduleReference = false
  const visit = (node: Node): void => {
    Option.match(functionLikeBodyOf(node), {
      onNone: () => undefined,
      onSome: (found) => recordEnclosing(enclosing, found, span, sourceFile),
    })
    moduleReference = Boolean.or(
      moduleReference,
      Boolean.and(isModuleReference(node, sourceFile), overlapsSpan(node, span)),
    )
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return { enclosing, moduleReference }
}

export const editSiteFactsOf: {
  (span: Span): (sourceFile: SourceFile) => EditSiteFacts
  (sourceFile: SourceFile, span: Span): EditSiteFacts
} = dual(2, (sourceFile: SourceFile, span: Span): EditSiteFacts => {
  const scan = scanOf(sourceFile, span)
  const editSpan: EditSpan = { start: span.start, length: span.end - span.start }
  return {
    span: editSpan,
    typescriptModule: Boolean.and(
      isTypeScriptModuleFileName(sourceFile.fileName),
      sourceFile.externalModuleIndicator !== undefined,
    ),
    declaresGlobal: Arr.some(sourceFile.statements, (statement) => isAmbientGlobal(sourceFile, statement)),
    moduleReference: scan.moduleReference,
    enclosing: scan.enclosing,
  }
})
