import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
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

export const FileFacts = S.Struct({
  typescriptModule: S.Boolean,
  declaresGlobal: S.Boolean,
})
export type FileFacts = typeof FileFacts.Type

export const EditSiteFacts = S.Struct({
  span: EditSpan,
  ...FileFacts.fields,
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

const SIGNATURE_FREE_KINDS: ReadonlyArray<SyntaxKind> = [SET_ACCESSOR]

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
  readonly inspected: number
}

const scanOf = (sourceFile: SourceFile, span: Span): SiteScan => {
  const enclosing: Array<FunctionLikeFacts> = []
  let moduleReference = false
  let inspected = 0
  const inspect = (node: Node): true | undefined => {
    inspected += 1
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
  const visit = (node: Node): true | undefined =>
    Boolean.match(span.end < node.pos, {
      onTrue: () => true,
      onFalse: () => Boolean.match(node.end < span.start, { onTrue: () => undefined, onFalse: () => inspect(node) }),
    })
  sourceFile.forEachChild(visit)
  return { enclosing, moduleReference, inspected }
}

export const fileFactsOf = (sourceFile: SourceFile): FileFacts => ({
  typescriptModule: Boolean.and(
    isTypeScriptModuleFileName(sourceFile.fileName),
    sourceFile.externalModuleIndicator !== undefined,
  ),
  declaresGlobal: declaresGlobalOf(sourceFile),
})

export const editSiteFactsOf: {
  (span: Span, syntaxErrors: boolean): (sourceFile: SourceFile) => EditSiteFacts
  (sourceFile: SourceFile, span: Span, syntaxErrors: boolean): EditSiteFacts
} = dual(3, (sourceFile: SourceFile, span: Span, syntaxErrors: boolean): EditSiteFacts => {
  const scan = scanOf(sourceFile, span)
  return {
    span: { start: span.start, length: span.end - span.start },
    ...fileFactsOf(sourceFile),
    moduleReference: scan.moduleReference,
    syntaxErrors,
    enclosing: scan.enclosing,
  }
})

const accepts = {
  editSpan: S.is(EditSpan),
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { API } = await import('typescript/unstable/sync')
  const { createVirtualFileSystem } = await import('typescript/unstable/fs')
  const { admitImporterShortcut } = await import('./admit-importer-shortcut.workflow.js')
  const { DecideImporterShortcutCommand } = await import('./CheckerCommands.schema.js')
  const { ShortcutTaken } = await import('./ImporterShortcut.schema.js')

  const TSCONFIG = '/law/tsconfig.json'
  const SITE = '/law/site.ts'
  const TSCONFIG_TEXT = JSON.stringify({
    compilerOptions: { noEmit: true, target: 'es2022', module: 'esnext', types: [] },
  })

  const readFile = <A>(fileName: string, text: string, read: (sourceFile: SourceFile) => A): Option.Option<A> => {
    const api = new API({ fs: createVirtualFileSystem({ [TSCONFIG]: TSCONFIG_TEXT, [fileName]: text }) })
    const snapshot = api.updateSnapshot({ openProjects: [TSCONFIG] })
    const read_ = Option.map(
      Option.flatMap(
        Option.fromUndefinedOr(snapshot.getProject(TSCONFIG)),
        (project) => Option.fromUndefinedOr(project.program.getSourceFile(fileName)),
      ),
      read,
    )
    api.close()
    return read_
  }

  const readSite = <A>(text: string, read: (sourceFile: SourceFile) => A): Option.Option<A> =>
    readFile(SITE, text, read)

  const isPlacedSpan = (start: number, length: number): boolean => Boolean.and(start >= 0, length >= 0)

  it.prop(
    '∀e_EditSpanRefusal_≡ANegativeStartOrLength',
    { of: [S.Int, S.Int], subject: accepts },
    (subject, [start, length]) =>
      Arr.every(
        [[start, length], [-1, length], [start, -1], [0, 0]] as const,
        ([s, l]) => subject.editSpan({ start: s, length: l }) === isPlacedSpan(s, l),
      ),
  )

  const FileExtension = S.Literals(['.ts', '.tsx', '.mts', '.cts', '.d.ts'])
  const ALWAYS_MODULE = ['.mts', '.cts']
  const isModuleFile = (extension: string, exported: boolean): boolean =>
    Boolean.and(extension !== '.d.ts', Boolean.or(exported, ALWAYS_MODULE.includes(extension)))
  const EXPORT_LINE = { true: 'export const x = 1\n', false: 'const x = 1\n' } as const
  const GLOBAL_BLOCK = {
    true: 'declare global {\n  interface Probe {\n    readonly n: number\n  }\n}\n',
    false: '',
  } as const

  it.prop(
    '∀f_FileFactsOf_≡AModuleOnlyForANonDeclarationFileWithAnExportAndGlobalOnlyWhenDeclared',
    { of: [FileExtension, S.Boolean, S.Boolean], subject: fileFactsOf, runs: 30 },
    (subject, [extension, exported, global]) =>
      Option.exists(
        readFile(`/law/file${extension}`, `${EXPORT_LINE[`${exported}`]}${GLOBAL_BLOCK[`${global}`]}`, subject),
        (facts) =>
          Boolean.and(
            facts.typescriptModule === isModuleFile(extension, exported),
            facts.declaresGlobal === global,
          ),
      ),
  )

  const admits = (facts: EditSiteFacts): boolean =>
    Result.match(admitImporterShortcut(DecideImporterShortcutCommand.make({ original: facts, mutated: facts })), {
      onFailure: () => false,
      onSuccess: S.is(ShortcutTaken),
    })

  const SHAPES = {
    function: { header: 'export function f(x: number): number ', tail: '\n' },
    method: { header: 'export class C {\n  m(x: number): number ', tail: '\n}\n' },
    arrow: { header: 'export const f = (x: number): number => ', tail: '\n' },
  } as const
  const Shape = S.Literals(['function', 'method', 'arrow'])
  type Shape = typeof Shape.Type
  const BODY = '{\n  return x + 1\n}'

  interface Site {
    readonly text: string
    readonly bodyStart: number
    readonly closingBrace: number
  }

  const siteOf = (shape: Shape, later: number): Site => {
    const { header, tail } = SHAPES[shape]
    const bodyStart = header.length
    const later_ = Arr.makeBy(later, (index) => `export function g${index}(): number {\n  return ${index}\n}\n`).join(
      '',
    )
    return {
      text: header + BODY + tail + later_,
      bodyStart,
      closingBrace: bodyStart + BODY.length - 1,
    }
  }

  const Offset = S.Int.check(S.isBetween({ minimum: 0, maximum: BODY.length }))

  const spanOf = (site: Site, from: number, to: number): Span => ({
    start: site.bodyStart + Math.min(from, to),
    end: site.bodyStart + Math.max(from, to),
  })

  it.prop(
    '∀s_EditSiteFactsOf_≡AdmittedOnlyWhenTheSpanStopsBeforeTheClosingBrace',
    { of: [Shape, Offset, Offset], subject: editSiteFactsOf, runs: 40 },
    (subject, [shape, from, to]) => {
      const site = siteOf(shape, 0)
      const span = spanOf(site, from, to)
      return Option.exists(
        readSite(site.text, (sourceFile) => admits(subject(sourceFile, span, false))),
        (admitted) => admitted === (span.end <= site.closingBrace),
      )
    },
  )

  it.prop(
    '∀w_EditSiteFactsOf_≡WideningNeverTurnsARefusalIntoAnAdmit',
    { of: [Shape, Offset, Offset, Offset, Offset], subject: editSiteFactsOf, runs: 40 },
    (subject, [shape, from, to, before, after]) => {
      const site = siteOf(shape, 0)
      const narrow = spanOf(site, from, to)
      const wide = { start: Math.max(0, narrow.start - before), end: Math.min(site.text.length, narrow.end + after) }
      return Option.exists(
        readSite(site.text, (sourceFile) => ({
          narrow: admits(subject(sourceFile, narrow, false)),
          wide: admits(subject(sourceFile, wide, false)),
        })),
        (admitted) => Boolean.or(Boolean.not(admitted.wide), admitted.narrow),
      )
    },
  )

  const childrenOf = (node: Node): ReadonlyArray<Node> => {
    const children: Array<Node> = []
    node.forEachChild((child) => {
      children.push(child)
    })
    return children
  }

  const overlappingNodesOf = (node: Node, span: Span): number =>
    Boolean.match(Boolean.or(span.end < node.pos, node.end < span.start), {
      onTrue: () => 0,
      onFalse: () => 1 + Arr.reduce(childrenOf(node), 0, (total, child) => total + overlappingNodesOf(child, span)),
    })

  it.prop(
    '∀k_ScanOf_≡InspectsExactlyTheNodesWhoseAncestorsAllReachTheEdit',
    {
      of: [Shape, Offset, Offset, S.Int.check(S.isBetween({ minimum: 0, maximum: 12 }))],
      subject: scanOf,
      runs: 20,
    },
    (subject, [shape, from, to, later]) => {
      const site = siteOf(shape, later)
      const span = spanOf(site, from, to)
      return Option.exists(
        readSite(site.text, (sourceFile) => ({
          inspected: subject(sourceFile, span).inspected,
          model: Arr.reduce(childrenOf(sourceFile), 0, (total, child) => total + overlappingNodesOf(child, span)),
        })),
        ({ inspected, model }) => inspected === model,
      )
    },
  )
}
