/**
 * Owned ESTree/TS-ESTree printer — renders oxc-parser ASTs back to source.
 *
 * Structural codegen: one case per node kind, precedence-aware, no span reliance.
 * Synthesized nodes without start/end print correctly.
 */

// oxlint-disable typescript/no-unsafe-type-assertion typescript/no-unnecessary-type-assertion typescript/no-non-null-assertion typescript/switch-exhaustiveness-check @systemfsoftware/ban-classes

import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'

import type {
  AccessorProperty,
  ArrayExpression,
  ArrayPattern,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  BinaryExpression,
  BindingIdentifier,
  BindingProperty,
  BindingRestElement,
  BlockStatement,
  BreakStatement,
  CallExpression,
  CatchClause,
  Class,
  ClassBody,
  ConditionalExpression,
  ContinueStatement,
  Decorator,
  DoWhileStatement,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Expression,
  ExpressionStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Function as FunctionNode,
  IdentifierName,
  IdentifierReference,
  IfStatement,
  ImportAttribute,
  ImportDeclaration,
  JSDocNonNullableType,
  JSDocNullableType,
  JSXAttribute,
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
  JSXIdentifier,
  JSXMemberExpression,
  JSXNamespacedName,
  JSXOpeningElement,
  JSXSpreadAttribute,
  JSXSpreadChild,
  JSXText,
  LabeledStatement,
  LabelIdentifier,
  LogicalExpression,
  MemberExpression,
  MetaProperty,
  MethodDefinition,
  NewExpression,
  ObjectExpression,
  ObjectProperty,
  PrivateIdentifier,
  Program,
  PropertyDefinition,
  ReturnStatement,
  SequenceExpression,
  SpreadElement,
  StaticBlock,
  SwitchCase,
  SwitchStatement,
  TaggedTemplateExpression,
  TemplateElement,
  TemplateLiteral,
  ThrowStatement,
  TryStatement,
  TSArrayType,
  TSAsExpression,
  TSCallSignatureDeclaration,
  TSConditionalType,
  TSConstructorType,
  TSConstructSignatureDeclaration,
  TSEnumDeclaration,
  TSExportAssignment,
  TSFunctionType,
  TSImportEqualsDeclaration,
  TSImportType,
  TSIndexedAccessType,
  TSIndexSignature,
  TSInferType,
  TSInstantiationExpression,
  TSInterfaceBody,
  TSInterfaceDeclaration,
  TSIntersectionType,
  TSLiteralType,
  TSMappedType,
  TSMethodSignature,
  TSModuleBlock,
  TSModuleDeclaration,
  TSNamedTupleMember,
  TSNamespaceExportDeclaration,
  TSNonNullExpression,
  TSOptionalType,
  TSParenthesizedType,
  TSPropertySignature,
  TSQualifiedName,
  TSRestType,
  TSSatisfiesExpression,
  TSTemplateLiteralType,
  TSTupleType,
  TSType,
  // TS
  TSTypeAliasDeclaration,
  TSTypeAnnotation,
  TSTypeAssertion,
  TSTypeOperator,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
  TSTypePredicate,
  TSTypeQuery,
  TSTypeReference,
  TSUnionType,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
  WhileStatement,
  WithStatement,
  YieldExpression,
} from '../Ast.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Comment {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}

export interface Hashbang {
  readonly type: 'Hashbang'
  readonly value: string
  readonly start: number
}

export interface PrintOptions {
  readonly comments?: readonly Comment[]
  readonly hashbang?: Hashbang | null
}

export interface PrintProgramOptions extends PrintOptions {}

export function printProgram(program: Program, opts: PrintProgramOptions = {}): string {
  const state = new PrintState(opts)
  return state.printProgram(program)
}

// Convenience: print any single node (used for synthesized replacement snippets)
export function printNode(node: unknown, opts: PrintOptions = {}): string {
  const state = new PrintState(opts)
  return state.printAnyNode(node as { type: string })
}

// ---------------------------------------------------------------------------
// Precedence (higher = tighter binding)
// ---------------------------------------------------------------------------

const PREC = {
  Sequence: 0,
  Assignment: 1, // =, +=, etc.
  Conditional: 2, // ?:
  NullishCoalescing: 3,
  LogicalOR: 4,
  LogicalAND: 5,
  BitwiseOR: 6,
  BitwiseXOR: 7,
  BitwiseAND: 8,
  Equality: 9, // ==, !=, ===, !==
  Relational: 10, // <, >, <=, >=, in, instanceof
  Shift: 11, // <<, >>, >>>
  Additive: 12, // +, -
  Multiplicative: 13, // *, /, %
  Exponential: 14, // **  right-assoc
  Unary: 15,
  Update: 16,
  Call: 17,
  Member: 18,
  Primary: 19,
} as const

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': PREC.LogicalOR,
  '&&': PREC.LogicalAND,
  '??': PREC.NullishCoalescing,
  '|': PREC.BitwiseOR,
  '^': PREC.BitwiseXOR,
  '&': PREC.BitwiseAND,
  '==': PREC.Equality,
  '!=': PREC.Equality,
  '===': PREC.Equality,
  '!==': PREC.Equality,
  '<': PREC.Relational,
  '>': PREC.Relational,
  '<=': PREC.Relational,
  '>=': PREC.Relational,
  in: PREC.Relational,
  instanceof: PREC.Relational,
  '<<': PREC.Shift,
  '>>': PREC.Shift,
  '>>>': PREC.Shift,
  '+': PREC.Additive,
  '-': PREC.Additive,
  '*': PREC.Multiplicative,
  '/': PREC.Multiplicative,
  '%': PREC.Multiplicative,
  '**': PREC.Exponential,
}

const binaryPrec = (op: string): number => BINARY_PRECEDENCE[op] ?? PREC.Additive

const LOGICAL_PRECEDENCE: Readonly<Record<string, number>> = {
  '??': PREC.NullishCoalescing,
  '||': PREC.LogicalOR,
  '&&': PREC.LogicalAND,
}

function logicalPrec(op: string): number {
  return LOGICAL_PRECEDENCE[op] ?? PREC.LogicalAND
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * What a hoisted dispatch receives: the node, its kind, and the state that
 * renders it. Expression dispatch also carries the precedence the enclosing
 * node requires.
 */
interface NodeDispatch {
  readonly type: string
  readonly node: { readonly type: string } | null | undefined
  readonly state: PrintState
  readonly prec: number
}

interface KindDispatch {
  readonly type: string
  readonly node: { readonly type: string } | null | undefined
  readonly state: PrintState
}

/**
 * Builds one hoisted, open-union dispatch. `cases` maps a kind to its arm and
 * every kind they miss reaches `fallback` — the tolerant branch. The union
 * stays open on purpose: a closed `Match.exhaustive` would refuse to compile
 * where the printer's answer is a printed placeholder.
 */
const nodeDispatch = (
  cases: Readonly<Record<string, (dispatch: NodeDispatch) => unknown>>,
  fallback: (dispatch: NodeDispatch) => unknown,
): (dispatch: NodeDispatch) => void =>
  Match.type<NodeDispatch>().pipe(Match.discriminators('type')(cases), Match.orElse(fallback))

const kindDispatch = (
  cases: Readonly<Record<string, (dispatch: KindDispatch) => unknown>>,
  fallback: (dispatch: KindDispatch) => unknown,
): (dispatch: KindDispatch) => void =>
  Match.type<KindDispatch>().pipe(Match.discriminators('type')(cases), Match.orElse(fallback))

// The absent kind keys a dispatch table, so it is declared before the table: a
// static initializer cannot read a module constant declared below the class.
const ABSENT_NODE_KIND = '\u0000absent'
const ABSENT_NODE: { type: string } = { type: ABSENT_NODE_KIND }

function nodeKind(node: { type: string } | null | undefined): string {
  return (node ?? ABSENT_NODE).type
}

// ---------------------------------------------------------------------------
// Print state
// ---------------------------------------------------------------------------

class PrintState {
  private out = ''
  private indentLevel = 0
  private readonly hashbang: Hashbang | null
  private commentIdx = 0
  // Comments sorted by start position for ordered emission
  private readonly sortedComments: readonly Comment[]

  constructor(opts: PrintOptions) {
    this.hashbang = opts.hashbang ?? null
    this.sortedComments = [...sortedCommentsWithoutHashbang(opts.comments, this.hashbang), END_OF_COMMENTS]
  }

  printProgram(program: Program): string {
    this.out = ''
    this.indentLevel = 0
    this.commentIdx = 0

    this.printHashbang()

    // Leading comments: the sweep stops at the first statement, and bounds
    // nothing at all when the program carries none.
    this.emitCommentsBefore((program.body[0] as { start?: number } | undefined)?.start)
    this.printProgramBody(program.body)

    // Trailing comments
    this.emitCommentsBefore(undefined)

    return this.out
  }

  printAnyNode(node: { type: string }): string {
    this.out = ''
    this.indentLevel = 0
    this.printNode(node, PREC.Sequence)
    return this.out
  }

  // ---- comment interleaving ----

  private printHashbang(): void {
    if (this.hashbang) this.out += `#!${this.hashbang.value}\n`
  }

  private printProgramBody(body: readonly unknown[]): void {
    body.forEach((statement) => this.printProgramStatement(statement as { type: string; start?: number }))
  }

  private printProgramStatement(statement: { type: string; start?: number }): void {
    this.emitCommentsBefore(statement.start ?? -1)
    this.printStatement(statement as never)
    // Statement terminators: semicolons handled per-statement; ensure newline
    // between statements, and comments may sit between statements.
    this.out += '\n'
  }

  private printJumpStatement(keyword: string, label: LabelIdentifier | null): void {
    this.out += keyword
    if (label) this.out += ` ${label.name}`
    this.out += ';'
  }

  /** Emits every pending comment that starts before `pos`; an absent bound admits every comment. */
  private emitCommentsBefore(pos: number | undefined): void {
    this.emitPendingCommentsBefore(pos ?? EVERY_COMMENT_POSITION)
  }

  private emitPendingCommentsBefore(pos: number): void {
    for (
      let comment = this.sortedComments[this.commentIdx]!;
      comment.start < pos;
      comment = this.sortedComments[this.commentIdx]!
    ) {
      this.emitComment(comment)
      this.commentIdx++
    }
  }

  private emitComment(c: Comment): void {
    if (c.type === 'Line') {
      // c.value from oxc does NOT include leading //
      // But for Block comments, value is inner content
      // Check: Line value is " hello" for "// hello"
      this.out += `//${c.value}\n`
    } else {
      this.out += `/*${c.value}*/\n`
    }
  }

  // ---- indentation ----

  private indent(): string {
    return '  '.repeat(this.indentLevel)
  }

  private nl(): void {
    this.out += '\n'
  }

  /** Renders a fragment to a string without disturbing the pending output. */
  private capture(render: () => void): string {
    const saved = this.out
    this.out = ''
    render()
    const result = this.out
    this.out = saved
    return result
  }

  // ---- precedence-aware parens ----

  private needsParens(childPrec: number, parentPrec: number, isRight: boolean, op?: string): boolean {
    if (childPrec === parentPrec) {
      return this.equalPrecedenceNeedsParens(isRight, op)
    }
    return childPrec < parentPrec
  }

  /** Equal precedence — associativity decides. */
  private equalPrecedenceNeedsParens(isRight: boolean, op?: string): boolean {
    // right-associative: a ** (b ** c) needs no parens on right, but (a ** b) ** c does
    if (op === '**') {
      return !isRight
    }
    // For left-assoc operators, right child with same prec needs parens: a - (b - c) vs a - b - c
    // For assignment (right-assoc), left child with same prec needs parens
    // We call this for binary/logical/conditional/assignment right children as isRight=true
    return isRight
  }

  private wrapIfNeeded(
    node: { type: string },
    prec: number,
    parentPrec: number,
    isRight: boolean,
    op?: string,
  ): string {
    const inner = this.printExpressionToString(node as never, prec)
    if (this.needsParens(prec, parentPrec, isRight, op)) return `(${inner})`
    return inner
  }

  private printExpressionToString(node: Expression, prec: number): string {
    return this.capture(() => this.printNode(node as unknown as { type: string }, prec))
  }

  private sequenceNodeText(node: { type: string }): string {
    return this.capture(() => this.printNode(node, PREC.Sequence))
  }

  private assignmentNodeText(node: { type: string }): string {
    return this.capture(() => this.printNode(node, PREC.Assignment))
  }

  private nodeListText(nodes: readonly { type: string }[], prec: number): string {
    return nodes.map((node) => this.capture(() => this.printNode(node, prec))).join(', ')
  }

  private wrappedExpressionText(
    node: { type: string },
    prec: number,
    wrappedKinds: Readonly<Record<string, true>>,
  ): string {
    const printed = this.printExpressionToString(node as unknown as Expression, prec)
    return parenthesizedIf(wrappedKinds[node.type] === true, printed)
  }

  // ---- generic dispatch ----

  private printNode(node: { type: string } | null | undefined, prec: number): void {
    PrintState.NODE_PRINTER({ type: nodeKind(node), node, state: this, prec })
  }

  private static readonly NODE_PRINTER = nodeDispatch(
    {
      [ABSENT_NODE_KIND]: () => undefined,
      // oxc uses "Literal" for all literal kinds; delegate to literal printer
      Literal: (d) => d.state.printLiteral(d.node as never),
      // Expressions
      Identifier: (d) => d.state.printIdentifier(d.node as never),
      PrivateIdentifier: (d) => {
        d.state.out += `#${(d.node as PrivateIdentifier).name}`
      },
      ThisExpression: (d) => {
        d.state.out += 'this'
      },
      Super: (d) => {
        d.state.out += 'super'
      },
      ArrayExpression: (d) => d.state.printArrayExpression(d.node as ArrayExpression),
      ObjectExpression: (d) => d.state.printObjectExpression(d.node as ObjectExpression),
      Property: (d) => d.state.printProperty(d.node as never),
      TemplateLiteral: (d) => d.state.printTemplateLiteral(d.node as TemplateLiteral),
      TemplateElement: (d) => {
        // handled inside TemplateLiteral / TSTemplateLiteralType
        d.state.out += (d.node as TemplateElement).value.raw
      },
      TaggedTemplateExpression: (d) => d.state.printTaggedTemplate(d.node as TaggedTemplateExpression),
      MemberExpression: (d) => d.state.printMemberExpression(d.node as MemberExpression, d.prec),
      CallExpression: (d) => d.state.printCallExpression(d.node as CallExpression, d.prec),
      NewExpression: (d) => d.state.printNewExpression(d.node as NewExpression, d.prec),
      MetaProperty: (d) => d.state.printMetaProperty(d.node as MetaProperty),
      SpreadElement: (d) => {
        d.state.out += '...'
        d.state.printNode((d.node as SpreadElement).argument as unknown as { type: string }, PREC.Assignment)
      },
      RestElement: (d) => {
        d.state.out += '...'
        d.state.printNode(
          (d.node as BindingRestElement).argument as unknown as { type: string },
          PREC.Assignment,
        )
      },
      UpdateExpression: (d) => d.state.printUpdateExpression(d.node as UpdateExpression, d.prec),
      UnaryExpression: (d) => d.state.printUnaryExpression(d.node as UnaryExpression, d.prec),
      BinaryExpression: (d) => d.state.printBinaryExpression(d.node as BinaryExpression, d.prec),
      LogicalExpression: (d) => d.state.printLogicalExpression(d.node as LogicalExpression, d.prec),
      ConditionalExpression: (d) => d.state.printConditionalExpression(d.node as ConditionalExpression, d.prec),
      AssignmentExpression: (d) => d.state.printAssignmentExpression(d.node as AssignmentExpression, d.prec),
      AssignmentPattern: (d) => d.state.printAssignmentPattern(d.node as AssignmentPattern, d.prec),
      ObjectPattern: (d) => d.state.printObjectPattern(d.node as never),
      ArrayPattern: (d) => d.state.printArrayPattern(d.node as ArrayPattern),
      SequenceExpression: (d) => d.state.printSequenceExpression(d.node as SequenceExpression, d.prec),
      AwaitExpression: (d) => {
        d.state.out += 'await '
        d.state.printNode(
          (d.node as YieldExpression & { argument: Expression }).argument as unknown as {
            type: string
          },
          PREC.Unary,
        )
      },
      YieldExpression: (d) => d.state.printYieldExpression(d.node as YieldExpression, d.prec),
      ChainExpression: (d) => {
        d.state.printNode(
          (d.node as unknown as { expression: { type: string } }).expression as { type: string },
          d.prec,
        )
      },
      ParenthesizedExpression: (d) => {
        d.state.out += '('
        d.state.printNode(
          (d.node as unknown as { expression: { type: string } }).expression as { type: string },
          PREC.Sequence,
        )
        d.state.out += ')'
      },
      ImportExpression: (d) => d.state.printImportExpression(d.node as never),
      V8IntrinsicExpression: (d) => d.state.printV8Intrinsic(d.node as never),
      ArrowFunctionExpression: (d) => d.state.printArrowFunction(d.node as ArrowFunctionExpression, d.prec),
      FunctionExpression: (d) => d.state.printFunction(d.node as FunctionNode, d.prec),
      FunctionDeclaration: (d) => d.state.printFunction(d.node as FunctionNode, d.prec),
      TSDeclareFunction: (d) => d.state.printFunction(d.node as FunctionNode, d.prec),
      TSEmptyBodyFunctionExpression: (d) => d.state.printFunction(d.node as FunctionNode, d.prec),
      ClassDeclaration: (d) => d.state.printClass(d.node as Class, d.prec),
      ClassExpression: (d) => d.state.printClass(d.node as Class, d.prec),
      JSXElement: (d) => d.state.printJSXElement(d.node as JSXElement),
      JSXFragment: (d) => d.state.printJSXFragment(d.node as JSXFragment),
      JSXOpeningElement: (d) => d.state.printJSXOpeningElement(d.node as JSXOpeningElement),
      JSXClosingElement: () => undefined, // handled in JSXElement
      JSXIdentifier: (d) => {
        d.state.out += (d.node as JSXIdentifier).name
      },
      JSXNamespacedName: (d) => {
        d.state.out += `${(d.node as JSXNamespacedName).namespace.name}:${(d.node as JSXNamespacedName).name.name}`
      },
      JSXMemberExpression: (d) => d.state.printJSXMemberExpression(d.node as JSXMemberExpression),
      JSXAttribute: (d) => d.state.printJSXAttribute(d.node as JSXAttribute),
      JSXSpreadAttribute: (d) => {
        d.state.out += '{...'
        d.state.printNode((d.node as JSXSpreadAttribute).argument as unknown as { type: string }, PREC.Assignment)
        d.state.out += '}'
      },
      JSXExpressionContainer: (d) => {
        d.state.out += '{'
        d.state.printNode(
          (d.node as JSXExpressionContainer).expression as unknown as { type: string },
          PREC.Sequence,
        )
        d.state.out += '}'
      },
      JSXEmptyExpression: () => undefined,
      JSXText: (d) => {
        d.state.out += (d.node as JSXText).value
      },
      JSXSpreadChild: (d) => {
        d.state.out += '{...'
        d.state.printNode(
          (d.node as JSXSpreadChild).expression as unknown as { type: string },
          PREC.Assignment,
        )
        d.state.out += '}'
      },
      // TS expressions
      TSAsExpression: (d) => d.state.printTSAsExpression(d.node as TSAsExpression, d.prec),
      TSSatisfiesExpression: (d) => d.state.printTSSatisfiesExpression(d.node as TSSatisfiesExpression, d.prec),
      TSTypeAssertion: (d) => d.state.printTSTypeAssertion(d.node as TSTypeAssertion, d.prec),
      TSNonNullExpression: (d) => {
        d.state.printNode(
          (d.node as TSNonNullExpression).expression as unknown as { type: string },
          PREC.Member,
        )
        d.state.out += '!'
      },
      TSInstantiationExpression: (d) =>
        d.state.printTSInstantiationExpression(d.node as TSInstantiationExpression, d.prec),
      // Statements
      BlockStatement: (d) => d.state.printBlockStatement(d.node as BlockStatement),
      EmptyStatement: (d) => {
        d.state.out += ';'
      },
      ExpressionStatement: (d) => d.state.printExpressionStatement(d.node as ExpressionStatement),
      IfStatement: (d) => d.state.printIfStatement(d.node as IfStatement),
      DoWhileStatement: (d) => d.state.printDoWhileStatement(d.node as DoWhileStatement),
      WhileStatement: (d) => d.state.printWhileStatement(d.node as WhileStatement),
      ForStatement: (d) => d.state.printForStatement(d.node as ForStatement),
      ForInStatement: (d) => d.state.printForInStatement(d.node as ForInStatement),
      ForOfStatement: (d) => d.state.printForOfStatement(d.node as ForOfStatement),
      ContinueStatement: (d) => d.state.printJumpStatement('continue', (d.node as ContinueStatement).label),
      BreakStatement: (d) => d.state.printJumpStatement('break', (d.node as BreakStatement).label),
      ReturnStatement: (d) => d.state.printReturnStatement(d.node as ReturnStatement),
      WithStatement: (d) => d.state.printWithStatement(d.node as WithStatement),
      SwitchStatement: (d) => d.state.printSwitchStatement(d.node as SwitchStatement),
      SwitchCase: () => undefined, // handled in switch
      LabeledStatement: (d) => d.state.printLabeledStatement(d.node as LabeledStatement),
      ThrowStatement: (d) => {
        d.state.out += 'throw '
        d.state.printNode((d.node as ThrowStatement).argument as unknown as { type: string }, PREC.Sequence)
        d.state.out += ';'
      },
      TryStatement: (d) => d.state.printTryStatement(d.node as TryStatement),
      CatchClause: () => undefined, // handled in try
      DebuggerStatement: (d) => {
        d.state.out += 'debugger;'
      },
      VariableDeclaration: (d) => d.state.printVariableDeclaration(d.node as VariableDeclaration),
      VariableDeclarator: (d) => d.state.printVariableDeclarator(d.node as VariableDeclarator),
      ClassBody: (d) => d.state.printClassBody(d.node as ClassBody),
      MethodDefinition: (d) => d.state.printMethodDefinition(d.node as MethodDefinition),
      TSAbstractMethodDefinition: (d) => d.state.printMethodDefinition(d.node as MethodDefinition),
      PropertyDefinition: (d) => d.state.printPropertyDefinition(d.node as PropertyDefinition),
      TSAbstractPropertyDefinition: (d) => d.state.printPropertyDefinition(d.node as PropertyDefinition),
      AccessorProperty: (d) => d.state.printAccessorProperty(d.node as AccessorProperty),
      TSAbstractAccessorProperty: (d) => d.state.printAccessorProperty(d.node as AccessorProperty),
      StaticBlock: (d) => d.state.printStaticBlock(d.node as StaticBlock),
      ImportDeclaration: (d) => d.state.printImportDeclaration(d.node as ImportDeclaration),
      ExportNamedDeclaration: (d) => d.state.printExportNamedDeclaration(d.node as ExportNamedDeclaration),
      ExportDefaultDeclaration: (d) => d.state.printExportDefaultDeclaration(d.node as ExportDefaultDeclaration),
      ExportAllDeclaration: (d) => d.state.printExportAllDeclaration(d.node as ExportAllDeclaration),
      Decorator: (d) => {
        d.state.out += '@'
        d.state.printNode((d.node as Decorator).expression as unknown as { type: string }, PREC.Member)
      },
      // TS Declarations / Types
      TSTypeAliasDeclaration: (d) => d.state.printTSTypeAliasDeclaration(d.node as TSTypeAliasDeclaration),
      TSInterfaceDeclaration: (d) => d.state.printTSInterfaceDeclaration(d.node as TSInterfaceDeclaration),
      TSEnumDeclaration: (d) => d.state.printTSEnumDeclaration(d.node as TSEnumDeclaration),
      TSModuleDeclaration: (d) => d.state.printTSModuleDeclaration(d.node as TSModuleDeclaration),
      TSImportEqualsDeclaration: (d) => d.state.printTSImportEqualsDeclaration(d.node as TSImportEqualsDeclaration),
      TSExportAssignment: (d) => {
        d.state.out += `export = `
        d.state.printNode(
          (d.node as TSExportAssignment).expression as unknown as { type: string },
          PREC.Sequence,
        )
        d.state.out += ';'
      },
      TSNamespaceExportDeclaration: (d) => {
        d.state.out += `export as namespace ${(d.node as TSNamespaceExportDeclaration).id.name};`
      },
    },
    (d) => d.state.printUnclassifiedNode(d.node, d.type),
  )

  /** TS type nodes and the wrappers that carry them, which oxc kinds apart from expressions. */
  private printUnclassifiedNode(node: { type: string } | null | undefined, kind: string): void {
    if (isTSTypeNode(kind)) {
      this.printTSType(node as unknown as TSType)
      return
    }
    this.printTypeHolderNode(node, kind)
  }

  private printTypeHolderNode(node: { type: string } | null | undefined, kind: string): void {
    PrintState.TYPE_HOLDER_PRINTER({ type: kind, node, state: this })
  }

  private static readonly TYPE_HOLDER_PRINTER = kindDispatch(
    {
      TSTypeAnnotation: (d) => {
        d.state.out += ': '
        d.state.printTSType((d.node as TSTypeAnnotation).typeAnnotation)
      },
      TSTypeParameterDeclaration: (d) => d.state.printTSTypeParameterDeclaration(d.node as TSTypeParameterDeclaration),
      TSTypeParameterInstantiation: (d) =>
        d.state.printTSTypeParameterInstantiation(d.node as TSTypeParameterInstantiation),
      TSTypeParameter: (d) => d.state.printTSTypeParameter(d.node as never),
    },
    (d) => {
      // Unknown node — emit as comment for debuggability, still valid enough to not crash corpus run
      d.state.out += `/* unknown:${d.type} */`
    },
  )

  // -----------------------------------------------------------------------
  // Literals
  // -----------------------------------------------------------------------

  private printLiteral(node: LiteralSource): void {
    this.out += literalText(node)
  }

  private printIdentifier(
    node: IdentifierName | IdentifierReference | BindingIdentifier | LabelIdentifier,
  ): void {
    this.out += node.name
  }

  // -----------------------------------------------------------------------
  // Expressions
  // -----------------------------------------------------------------------

  private printArrayExpression(node: ArrayExpression): void {
    this.out += `[${node.elements.map((element) => this.arrayElementText(element)).join(', ')}]`
  }

  private arrayElementText(element: unknown): string {
    if (element === null) {
      return ''
    }
    return this.assignmentNodeText(element as { type: string })
  }

  private printObjectExpression(node: ObjectExpression): void {
    if (node.properties.length === 0) {
      this.out += '{}'
    } else {
      this.out += `{ ${this.nodeListText(node.properties, PREC.Sequence)} }`
    }
  }

  private printProperty(
    node:
      | ObjectProperty
      | BindingProperty
      | { type: 'Property'; key: unknown; value: unknown }
        & Record<
          string,
          unknown
        >,
  ): void {
    const fields = node as unknown as PropertyFields
    Match.value(propertyForm(fields)).pipe(
      Match.when('accessor', () => {
        this.out += `${fields.kind} `
        this.out += this.propertyKeyText(fields.key, fields.computed === true, PREC.Assignment)
        this.printFunctionTail(fields.value as unknown as FunctionNode)
      }),
      Match.when('method', () => {
        this.out += `${flagText(fields.async, 'async ')}${flagText(fields.generator, '*')}`
        this.out += this.propertyKeyText(fields.key, fields.computed === true, PREC.Assignment)
        this.printFunctionTail(fields.value as unknown as FunctionNode)
      }),
      Match.when('shorthand', () => {
        this.out += identifierName(fields.key)!
      }),
      Match.when('shorthandDefault', () => {
        this.printShorthandDefaultProperty(fields)
      }),
      Match.orElse(() => {
        this.out += this.propertyKeyText(fields.key, fields.computed === true, PREC.Assignment)
        this.out += ': '
        this.printNode(fields.value, PREC.Assignment)
      }),
    )
  }

  private printShorthandDefaultProperty(fields: PropertyFields): void {
    const right = this.assignmentNodeText((fields.value as unknown as AssignmentPattern).right as { type: string })
    this.out += `${identifierName(fields.key)!} = ${right}`
  }

  private propertyKeyText(key: { type: string }, computed: boolean, computedPrec: number): string {
    if (computed) {
      return `[${this.capture(() => this.printNode(key, computedPrec))}]`
    }
    return this.plainPropertyKeyText(key)
  }

  private plainPropertyKeyText(key: { type: string }): string {
    return Match.value(key.type).pipe(
      Match.when('Identifier', () => (key as IdentifierName).name),
      Match.when('PrivateIdentifier', () => `#${(key as PrivateIdentifier).name}`),
      Match.when('Literal', () => this.capture(() => this.printLiteral(key as never))),
      Match.orElse(() => this.capture(() => this.printNode(key, PREC.Assignment))),
    )
  }

  private printPropertyKeyForClass(key: { type: string }, computed: boolean): void {
    this.out += this.propertyKeyText(key, computed, PREC.Sequence)
  }

  private printFunctionTail(fn: FunctionNode): void {
    this.out += this.typeParametersText(fn.typeParameters)
    this.out += `(${this.paramsText(fn.params)})`
    this.out += this.typeAnnotationText(fn.returnType)
    this.out += this.functionBodyText(fn)
  }

  private functionBodyText(fn: FunctionNode): string {
    if (fn.body) {
      return ` ${this.capture(() => this.printBlockStatement(fn.body as BlockStatement))}`
    }
    return ';'
  }

  private paramsText(params: readonly unknown[]): string {
    return this.capture(() => this.printParams(params))
  }

  private typeParametersText(params: TSTypeParameterDeclaration | null | undefined): string {
    if (params) {
      return this.capture(() => this.printTSTypeParameterDeclaration(params as TSTypeParameterDeclaration))
    }
    return ''
  }

  private typeArgumentsText(args: TSTypeParameterInstantiation | null | undefined): string {
    if (args) {
      return this.capture(() => this.printTSTypeParameterInstantiation(args as TSTypeParameterInstantiation))
    }
    return ''
  }

  private typeAnnotationText(annotation: TSTypeAnnotation | null | undefined): string {
    if (annotation) {
      return this.capture(() => this.printTSTypeAnnotation(annotation as TSTypeAnnotation))
    }
    return ''
  }

  private printTemplateLiteral(node: TemplateLiteral): void {
    this.out += `\`${
      node.quasis
        .map((quasi, index) => this.quasiText(quasi, node.expressions[index] as unknown as { type: string }))
        .join('')
    }\``
  }

  private quasiText(quasi: TemplateElement, expression: { type: string }): string {
    if (quasi.tail) {
      return quasi.value.raw
    }
    return `${quasi.value.raw}\${${this.sequenceNodeText(expression)}}`
  }

  private printTaggedTemplate(node: TaggedTemplateExpression): void {
    this.printNode(node.tag as unknown as { type: string }, PREC.Member)
    if (node.typeArguments) this.printTSTypeParameterInstantiation(node.typeArguments)
    this.printTemplateLiteral(node.quasi)
  }

  private printMemberExpression(node: MemberExpression, _prec: number): void {
    const access = node as unknown as MemberAccess
    this.out += this.wrappedExpressionText(access.object, PREC.Member, MEMBER_OBJECT_WRAPPED_KINDS)
    this.out += flagText(access.optional, '?.')
    this.out += this.memberSelectorText(access)
  }

  private memberSelectorText(access: MemberAccess): string {
    if (access.computed) {
      return `[${this.sequenceNodeText(access.property)}]`
    }
    return `${flagText(!access.optional, '.')}${this.memberPropertyText(access.property)}`
  }

  private memberPropertyText(property: { type: string }): string {
    return Match.value(property.type).pipe(
      Match.when('Identifier', () => (property as IdentifierName).name),
      Match.when('PrivateIdentifier', () => `#${(property as PrivateIdentifier).name}`),
      Match.orElse(() => this.sequenceNodeText(property)),
    )
  }

  private printCallExpression(node: CallExpression, _prec: number): void {
    this.out += this.wrappedExpressionText(node.callee as { type: string }, PREC.Member, CALLEE_WRAPPED_KINDS)
    this.out += flagText(node.optional, '?.')
    this.out += this.typeArgumentsText(node.typeArguments)
    this.out += `(${this.nodeListText(node.arguments, PREC.Assignment)})`
  }

  private printNewExpression(node: NewExpression, _prec: number): void {
    this.out += 'new '
    this.out += this.printExpressionToString(node.callee as Expression, PREC.Member)
    this.out += this.typeArgumentsText(node.typeArguments)
    this.out += `(${this.nodeListText(node.arguments, PREC.Assignment)})`
  }

  private printMetaProperty(node: MetaProperty): void {
    this.out += `${node.meta.name}.${node.property.name}`
  }

  private printV8Intrinsic(node: { name: IdentifierName; arguments: unknown[] }): void {
    this.out += `%${node.name.name}(${
      this.nodeListText(node.arguments as readonly { type: string }[], PREC.Assignment)
    })`
  }

  private printImportExpression(node: { source: Expression; options: Expression | null; phase: string | null }): void {
    this.out += `import${flagText(node.phase, `.${node.phase}`)}(`
    this.out += this.assignmentNodeText(node.source as unknown as { type: string })
    this.out += flagText(node.options, `, ${this.assignmentNodeText(node.options as unknown as { type: string })}`)
    this.out += ')'
  }

  private printUpdateExpression(node: UpdateExpression, _prec: number): void {
    const operand = this.wrappedExpressionText(
      node.argument as { type: string },
      PREC.Update,
      MEMBER_OBJECT_WRAPPED_KINDS,
    )
    if (node.prefix) {
      this.out += `${node.operator}${operand}`
    } else {
      this.out += `${operand}${node.operator}`
    }
  }

  private printUnaryExpression(node: UnaryExpression, _prec: number): void {
    this.out += node.operator
    this.out += flagText(UNARY_WORD_OPERATORS[node.operator] === true, ' ')
    this.out += this.wrappedExpressionText(
      node.argument as { type: string },
      PREC.Unary,
      UNARY_OPERAND_WRAPPED_KINDS,
    )
  }

  private printBinaryExpression(node: BinaryExpression, prec: number): void {
    const myPrec = binaryPrec(node.operator)
    const leftStr = this.wrapIfNeeded(
      node.left as unknown as { type: string },
      precOf(node.left as unknown as Expression),
      myPrec,
      false,
      node.operator,
    )
    const rightStr = this.wrapIfNeeded(
      node.right as unknown as { type: string },
      precOf(node.right as unknown as Expression),
      myPrec,
      true,
      node.operator,
    )
    // Need to parenthesize the whole if parent prec higher
    const whole = `${leftStr} ${node.operator} ${rightStr}`
    if (myPrec < prec) {
      this.out += `(${whole})`
    } else {
      this.out += whole
    }
  }

  private printLogicalExpression(node: LogicalExpression, prec: number): void {
    const myPrec = logicalPrec(node.operator)
    const leftStr = this.wrapIfNeeded(
      node.left as unknown as { type: string },
      precOf(node.left as unknown as Expression),
      myPrec,
      false,
      node.operator,
    )
    const rightStr = this.wrapIfNeeded(
      node.right as unknown as { type: string },
      precOf(node.right as unknown as Expression),
      myPrec,
      true,
      node.operator,
    )
    const whole = `${leftStr} ${node.operator} ${rightStr}`
    if (myPrec < prec) this.out += `(${whole})`
    else this.out += whole
  }

  private printConditionalExpression(node: ConditionalExpression, prec: number): void {
    const myPrec = PREC.Conditional
    const testStr = this.wrapIfNeeded(
      node.test as unknown as { type: string },
      precOf(node.test as Expression),
      myPrec,
      false,
    )
    // consequent and alternate are assignment-prec
    const consStr = this.printExpressionToString(node.consequent, PREC.Assignment)
    const altStr = this.printExpressionToString(node.alternate, PREC.Assignment)
    const whole = `${testStr} ? ${consStr} : ${altStr}`
    if (myPrec < prec) this.out += `(${whole})`
    else this.out += whole
  }

  private printAssignmentExpression(node: AssignmentExpression, prec: number): void {
    const myPrec = PREC.Assignment
    const leftStr = this.printExpressionToString(node.left as unknown as Expression, myPrec)
    // right is right-associative
    const rightStr = this.printExpressionToString(node.right, myPrec - 0.1)
    const whole = `${leftStr} ${node.operator} ${rightStr}`
    if (myPrec < prec) this.out += `(${whole})`
    else this.out += whole
  }

  private printAssignmentPattern(node: AssignmentPattern, prec: number): void {
    const left = node.left as unknown as { typeAnnotation?: TSTypeAnnotation | null }
    const leftText = this.printExpressionToString(node.left as unknown as Expression, PREC.Assignment) +
      this.typeAnnotationText(left.typeAnnotation)
    const rightText = this.printExpressionToString(node.right, PREC.Assignment)
    this.out += parenthesizedIf(PREC.Assignment < prec, `${leftText} = ${rightText}`)
  }

  private printObjectPattern(node: { properties: { type: string }[] }): void {
    if (node.properties.length === 0) {
      this.out += '{}'
    } else {
      this.out += `{ ${this.nodeListText(node.properties, PREC.Sequence)} }`
    }
  }

  private printArrayPattern(node: ArrayPattern): void {
    this.out += `[${node.elements.map((element) => this.arrayElementText(element)).join(', ')}]`
  }

  private printSequenceExpression(node: SequenceExpression, prec: number): void {
    const whole = node.expressions
      .map((expression) => this.printExpressionToString(expression, PREC.Sequence))
      .join(', ')
    this.out += parenthesizedIf(PREC.Sequence < prec, whole)
  }

  private printYieldExpression(node: YieldExpression, _prec: number): void {
    if (node.delegate) {
      this.out += 'yield*'
    } else {
      this.out += 'yield'
    }
    this.out += flagText(node.argument, ` ${this.assignmentNodeText(node.argument as unknown as { type: string })}`)
  }

  private printArrowFunction(node: ArrowFunctionExpression, prec: number): void {
    const arrow = `${flagText(node.async, 'async ')}${this.typeParametersText(node.typeParameters)}` +
      `${this.arrowParamsText(node)}${this.typeAnnotationText(node.returnType)} => ${this.arrowBodyText(node)}`
    this.out += parenthesizedIf(PREC.Assignment < prec, arrow)
  }

  private arrowParamsText(node: ArrowFunctionExpression): string {
    const bareParam = bareArrowParamName(node)
    if (bareParam.length === 0) {
      return `(${this.paramsText(node.params)})`
    }
    return bareParam
  }

  private arrowBodyText(node: ArrowFunctionExpression): string {
    if (arrowBodyIsBlock(node.body)) {
      return this.capture(() => this.printBlockStatement(node.body as BlockStatement))
    }
    return this.assignmentNodeText(node.body as unknown as { type: string })
  }

  private printFunction(node: FunctionNode, _prec: number): void {
    this.out += functionHeaderText(node)
    this.printFunctionTail(node)
  }

  private printClass(node: Class, _prec: number): void {
    this.out += this.capture(() => this.printDecorators(node.decorators as Decorator[]))
    this.out += `${flagText(node.declare, 'declare ')}${flagText(node.abstract, 'abstract ')}class${
      namedDeclarationText(node)
    }`
    this.out += this.typeParametersText(node.typeParameters)
    this.out += this.classHeritageText(node)
    this.out += this.classImplementsText(node)
    this.out += ' '
    this.printClassBody(node.body)
  }

  private classHeritageText(node: Class): string {
    if (node.superClass) {
      return ` extends ${this.assignmentNodeText(node.superClass as unknown as { type: string })}${
        this.typeArgumentsText(node.superTypeArguments)
      }`
    }
    return ''
  }

  private classImplementsText(node: Class): string {
    const rendered = (node.implements ?? []).map((heritage) => this.heritageText(heritage)).join(', ')
    return flagText(rendered, ` implements ${rendered}`)
  }

  private heritageText(heritage: {
    readonly expression: unknown
    readonly typeArguments?: TSTypeParameterInstantiation | null
  }): string {
    return `${this.assignmentNodeText(heritage.expression as { type: string })}${
      this.typeArgumentsText(heritage.typeArguments)
    }`
  }

  private printDecorators(decorators: readonly Decorator[] | undefined): void {
    const rendered = (decorators ?? []).map((decorator) => this.decoratorText(decorator)).join(' ')
    this.out += flagText(rendered, `${rendered} `)
  }

  private decoratorText(decorator: Decorator): string {
    return `@${this.capture(() => this.printNode(decorator.expression as unknown as { type: string }, PREC.Member))}`
  }

  // -----------------------------------------------------------------------
  // JSX
  // -----------------------------------------------------------------------

  private printJSXElement(node: JSXElement): void {
    this.printJSXOpeningElement(node.openingElement)
    node.children.forEach((child) => this.printJSXChild(child))
    this.printJSXClosingElement(node)
  }

  private printJSXClosingElement(node: JSXElement): void {
    if (!node.closingElement) return
    this.out += `</${this.jsxElementNameText(node.closingElement.name)}>`
  }

  private printJSXFragment(node: JSXFragment): void {
    this.out += '<>'
    for (const child of node.children) {
      this.printJSXChild(child)
    }
    this.out += '</>'
  }

  private printJSXOpeningElement(node: JSXOpeningElement): void {
    this.out += `<${this.jsxElementNameText(node.name)}`
    this.out += this.typeArgumentsText(node.typeArguments)
    this.out += node.attributes
      .map((attribute) => ` ${this.sequenceNodeText(attribute as unknown as { type: string })}`)
      .join('')
    if (node.selfClosing) {
      this.out += ' />'
    } else {
      this.out += '>'
    }
  }

  private jsxElementNameText(name: JSXIdentifier | JSXNamespacedName | JSXMemberExpression): string {
    return Match.value(name.type).pipe(
      Match.when('JSXIdentifier', () => (name as JSXIdentifier).name),
      Match.when(
        'JSXNamespacedName',
        () => `${(name as JSXNamespacedName).namespace.name}:${(name as JSXNamespacedName).name.name}`,
      ),
      Match.orElse(() => this.capture(() => this.printJSXMemberExpression(name as JSXMemberExpression))),
    )
  }

  private printJSXMemberExpression(node: JSXMemberExpression): void {
    const obj = node.object
    if (obj.type === 'JSXIdentifier') {
      this.out += `${(obj as JSXIdentifier).name}.${node.property.name}`
    } else {
      this.printJSXMemberExpression(obj as JSXMemberExpression)
      this.out += `.${node.property.name}`
    }
  }

  private printJSXAttribute(node: JSXAttribute): void {
    this.out += jsxAttributeNameText(node.name)
    this.out += this.jsxAttributeValueClauseText(node.value)
  }

  private jsxAttributeValueClauseText(value: { type: string } | null): string {
    if (nodeKind(value) === ABSENT_NODE_KIND) {
      return ''
    }
    return `=${this.jsxAttributeValueText(value as { type: string })}`
  }

  private jsxAttributeValueText(value: { type: string }): string {
    return Match.value(value.type).pipe(
      Match.when('Literal', () => this.capture(() => this.printLiteral(value as never))),
      Match.when('JSXExpressionContainer', () => {
        const container = value as unknown as { readonly expression: { readonly type: string } }
        return `{${this.sequenceNodeText(container.expression)}}`
      }),
      Match.orElse(() => this.sequenceNodeText(value)),
    )
  }

  private printJSXChild(child: { type: string }): void {
    Match.value(child.type).pipe(
      Match.when('JSXText', () => {
        this.out += (child as JSXText).value
      }),
      Match.when('JSXElement', () => {
        this.printJSXElement(child as JSXElement)
      }),
      Match.when('JSXFragment', () => {
        this.printJSXFragment(child as JSXFragment)
      }),
      Match.when('JSXExpressionContainer', () => {
        this.out += '{'
        this.printNode(
          (child as JSXExpressionContainer).expression as unknown as { type: string },
          PREC.Sequence,
        )
        this.out += '}'
      }),
      Match.when('JSXSpreadChild', () => {
        this.out += '{...'
        this.printNode((child as JSXSpreadChild).expression as unknown as { type: string }, PREC.Assignment)
        this.out += '}'
      }),
      Match.orElse(() => {
        this.printNode(child, PREC.Sequence)
      }),
    )
  }

  // -----------------------------------------------------------------------
  // TS expressions
  // -----------------------------------------------------------------------

  private printTSAsExpression(node: TSAsExpression, prec: number): void {
    const myPrec = PREC.Relational // as is low
    const exprStr = this.printExpressionToString(node.expression, myPrec)
    const typeStr = this.printTSTypeToString(node.typeAnnotation)
    const whole = `${exprStr} as ${typeStr}`
    if (myPrec < prec) this.out += `(${whole})`
    else this.out += whole
  }

  private printTSSatisfiesExpression(node: TSSatisfiesExpression, prec: number): void {
    const myPrec = PREC.Relational
    const exprStr = this.printExpressionToString(node.expression, myPrec)
    const typeStr = this.printTSTypeToString(node.typeAnnotation)
    const whole = `${exprStr} satisfies ${typeStr}`
    if (myPrec < prec) this.out += `(${whole})`
    else this.out += whole
  }

  private printTSTypeAssertion(node: TSTypeAssertion, _prec: number): void {
    this.out += `<${this.printTSTypeToString(node.typeAnnotation)}>`
    this.printNode(node.expression as unknown as { type: string }, PREC.Unary)
  }

  private printTSInstantiationExpression(node: TSInstantiationExpression, _prec: number): void {
    this.printNode(node.expression as unknown as { type: string }, PREC.Member)
    this.printTSTypeParameterInstantiation(node.typeArguments)
  }

  // -----------------------------------------------------------------------
  // Statements
  // -----------------------------------------------------------------------

  private printStatement(node: unknown): void {
    const n = node as { type: string }
    this.printAttachedComments(n, 'leadingComments')
    PrintState.STATEMENT_PRINTER({ type: n.type, node: n, state: this })
    this.printAttachedComments(n, 'trailingComments')
  }

  private static readonly STATEMENT_PRINTER = kindDispatch(
    {
      BlockStatement: (d) => d.state.printBlockStatement(d.node as BlockStatement),
      VariableDeclaration: (d) => {
        d.state.printVariableDeclaration(d.node as VariableDeclaration)
        d.state.out += ';'
      },
      FunctionDeclaration: (d) => d.state.printFunction(d.node as FunctionNode, PREC.Sequence),
      TSDeclareFunction: (d) => d.state.printFunction(d.node as FunctionNode, PREC.Sequence),
      ClassDeclaration: (d) => d.state.printClass(d.node as Class, PREC.Sequence),
      ExpressionStatement: (d) => d.state.printExpressionStatement(d.node as ExpressionStatement),
      IfStatement: (d) => d.state.printIfStatement(d.node as IfStatement),
      ForStatement: (d) => d.state.printForStatement(d.node as ForStatement),
      ForInStatement: (d) => d.state.printForInStatement(d.node as ForInStatement),
      ForOfStatement: (d) => d.state.printForOfStatement(d.node as ForOfStatement),
      WhileStatement: (d) => d.state.printWhileStatement(d.node as WhileStatement),
      DoWhileStatement: (d) => d.state.printDoWhileStatement(d.node as DoWhileStatement),
      ReturnStatement: (d) => d.state.printReturnStatement(d.node as ReturnStatement),
      ThrowStatement: (d) => {
        d.state.out += 'throw '
        d.state.printNode((d.node as ThrowStatement).argument as unknown as { type: string }, PREC.Sequence)
        d.state.out += ';'
      },
      TryStatement: (d) => d.state.printTryStatement(d.node as TryStatement),
      SwitchStatement: (d) => d.state.printSwitchStatement(d.node as SwitchStatement),
      LabeledStatement: (d) => d.state.printLabeledStatement(d.node as LabeledStatement),
      BreakStatement: (d) => d.state.printNode(d.node, PREC.Sequence),
      ContinueStatement: (d) => d.state.printNode(d.node, PREC.Sequence),
      DebuggerStatement: (d) => d.state.printNode(d.node, PREC.Sequence),
      EmptyStatement: (d) => d.state.printNode(d.node, PREC.Sequence),
      WithStatement: (d) => d.state.printWithStatement(d.node as WithStatement),
      ImportDeclaration: (d) => d.state.printImportDeclaration(d.node as ImportDeclaration),
      ExportNamedDeclaration: (d) => d.state.printExportNamedDeclaration(d.node as ExportNamedDeclaration),
      ExportDefaultDeclaration: (d) => d.state.printExportDefaultDeclaration(d.node as ExportDefaultDeclaration),
      ExportAllDeclaration: (d) => d.state.printExportAllDeclaration(d.node as ExportAllDeclaration),
      TSTypeAliasDeclaration: (d) => d.state.printTSTypeAliasDeclaration(d.node as TSTypeAliasDeclaration),
      TSInterfaceDeclaration: (d) => d.state.printTSInterfaceDeclaration(d.node as TSInterfaceDeclaration),
      TSEnumDeclaration: (d) => d.state.printTSEnumDeclaration(d.node as TSEnumDeclaration),
      TSModuleDeclaration: (d) => d.state.printTSModuleDeclaration(d.node as TSModuleDeclaration),
      TSImportEqualsDeclaration: (d) => d.state.printTSImportEqualsDeclaration(d.node as TSImportEqualsDeclaration),
      TSExportAssignment: (d) => d.state.printNode(d.node, PREC.Sequence),
      TSNamespaceExportDeclaration: (d) => d.state.printNode(d.node, PREC.Sequence),
    },
    (d) => d.state.printUnhandledStatement(d.node as { type: string }),
  )

  private printUnhandledStatement(node: { type: string }): void {
    if (!isTSTypeNode(node.type)) {
      // Silent corruption is worse than a loud failure: instrumented code
      // that dropped a statement would downgrade runs, not crash them.
      throw new Error(`Printer: unhandled statement kind ${node.type}`)
    }
    this.printTSType(node as unknown as TSType)
    this.out += ';'
  }

  /**
   * Emits the comments `attachComments` folded into the tree
   * (`leadingComments` before the statement, `trailingComments` on the
   * statement's last line). The flat `opts.comments` path only serves direct
   * `printProgram` calls on freshly parsed trees; instrumented trees carry
   * their comments attached to nodes.
   */
  private printAttachedComments(node: unknown, field: 'leadingComments' | 'trailingComments'): void {
    const comments = (node as Record<string, unknown>)[field]
    if (!Array.isArray(comments)) return
    comments.forEach((comment) => this.printAttachedComment(comment as AttachedComment, field))
  }

  private printAttachedComment(comment: AttachedComment, field: 'leadingComments' | 'trailingComments'): void {
    if (field === 'leadingComments') {
      this.out += `${this.indent()}${commentText(comment)}\n`
    } else {
      this.out += `${commentText(comment)} `
    }
  }

  private printBlockStatement(node: BlockStatement): void {
    if (node.body.length === 0) {
      this.out += '{}'
    } else {
      this.out += '{\n'
      this.out += this.indentedBodyText(node.body, (statement) => this.printStatement(statement as { type: string }))
      this.out += `${this.indent()}}`
    }
  }

  private printExpressionStatement(node: ExpressionStatement): void {
    if (this.isDirective(node.directive)) {
      this.out += JSON.stringify(node.directive) + ';'
      return
    }
    this.printNode(node.expression as unknown as { type: string }, PREC.Sequence)
    this.out += ';'
  }

  private isDirective(directive: string | null | undefined): boolean {
    return directive != null && directive !== ''
  }
  private printIfStatement(node: IfStatement): void {
    this.out += 'if ('
    this.printNode(node.test as unknown as { type: string }, PREC.Sequence)
    this.out += ') '
    this.printStatementOrBlock(node.consequent as unknown as { type: string })
    if (node.alternate) {
      this.out += ' else '
      this.printStatementOrBlock(node.alternate as unknown as { type: string })
    }
  }

  private printStatementOrBlock(node: { type: string }): void {
    if (node.type === 'BlockStatement') {
      this.printBlockStatement(node as BlockStatement)
    } else {
      // Single-statement without braces — indent not needed, but ensure correct
      this.printStatement(node)
    }
  }

  private printWhileStatement(node: WhileStatement): void {
    this.out += 'while ('
    this.printNode(node.test as unknown as { type: string }, PREC.Sequence)
    this.out += ') '
    this.printStatementOrBlock(node.body as unknown as { type: string })
  }

  private printDoWhileStatement(node: DoWhileStatement): void {
    this.out += 'do '
    this.printStatementOrBlock(node.body as unknown as { type: string })
    this.out += ' while ('
    this.printNode(node.test as unknown as { type: string }, PREC.Sequence)
    this.out += ');'
  }

  private printForStatement(node: ForStatement): void {
    this.out += 'for ('
    this.printDeclarationOrExpression(node.init)
    this.out += '; '
    this.out += this.optionalSequenceText(node.test)
    this.out += '; '
    this.out += this.optionalSequenceText(node.update)
    this.out += ') '
    this.printStatementOrBlock(node.body as unknown as { type: string })
  }

  private printDeclarationOrExpression(node: { type: string } | null | undefined): void {
    Match.value(nodeKind(node)).pipe(
      Match.when('VariableDeclaration', () => {
        this.printVariableDeclaration(node as VariableDeclaration)
      }),
      Match.when(ABSENT_NODE_KIND, () => undefined),
      Match.orElse(() => {
        this.printNode(node, PREC.Sequence)
      }),
    )
  }

  private optionalSequenceText(node: { type: string } | null | undefined): string {
    if (nodeKind(node) === ABSENT_NODE_KIND) {
      return ''
    }
    return this.sequenceNodeText(node as { type: string })
  }

  private printForInStatement(node: ForInStatement): void {
    this.out += 'for ('
    if ((node.left as { type: string }).type === 'VariableDeclaration') {
      this.printVariableDeclaration(node.left as VariableDeclaration)
    } else {
      this.printNode(node.left as unknown as { type: string }, PREC.Sequence)
    }
    this.out += ' in '
    this.printNode(node.right as unknown as { type: string }, PREC.Sequence)
    this.out += ') '
    this.printStatementOrBlock(node.body as unknown as { type: string })
  }

  private printForOfStatement(node: ForOfStatement): void {
    // `for await (const x of y)`: the await keyword sits before the paren.
    if (node.await) {
      this.out += 'for await ('
    } else {
      this.out += 'for ('
    }
    this.printDeclarationOrExpression(node.left as unknown as { type: string })
    this.out += ' of '
    this.out += this.sequenceNodeText(node.right as unknown as { type: string })
    this.out += ') '
    this.printStatementOrBlock(node.body as unknown as { type: string })
  }

  private printReturnStatement(node: ReturnStatement): void {
    if (node.argument) {
      this.out += 'return '
      this.printNode(node.argument as unknown as { type: string }, PREC.Sequence)
      this.out += ';'
    } else {
      this.out += 'return;'
    }
  }

  private printWithStatement(node: WithStatement): void {
    this.out += 'with ('
    this.printNode(node.object as unknown as { type: string }, PREC.Sequence)
    this.out += ') '
    this.printStatementOrBlock(node.body as unknown as { type: string })
  }

  private printSwitchStatement(node: SwitchStatement): void {
    this.out += `switch (${this.sequenceNodeText(node.discriminant as { type: string })}) {\n`
    this.indentLevel++
    this.out += node.cases
      .map((switchCase) => `${this.indent()}${this.capture(() => this.printSwitchCase(switchCase))}`)
      .join('')
    this.indentLevel--
    this.out += `${this.indent()}}`
  }

  private printSwitchCase(node: SwitchCase): void {
    this.out += this.switchCaseHeaderText(node)
    this.out += this.indentedBodyText(
      node.consequent,
      (statement) => this.printStatement(statement as { type: string }),
    )
  }

  private switchCaseHeaderText(node: SwitchCase): string {
    if (node.test) {
      return `case ${this.sequenceNodeText(node.test as { type: string })}:\n`
    }
    return 'default:\n'
  }

  private printLabeledStatement(node: LabeledStatement): void {
    this.out += `${node.label.name}: `
    this.printStatement(node.body as unknown as { type: string })
  }

  private printTryStatement(node: TryStatement): void {
    this.out += 'try '
    this.printBlockStatement(node.block)
    this.printCatchClause(node.handler)
    this.printFinallyClause(node.finalizer)
  }

  private printCatchClause(handler: CatchClause | null | undefined): void {
    if (!handler) return
    this.out += ` catch${this.catchParamText(handler.param as { type: string } | null)} `
    this.printBlockStatement(handler.body)
  }

  private catchParamText(param: { type: string } | null): string {
    if (nodeKind(param) === ABSENT_NODE_KIND) {
      return ''
    }
    return ` (${this.catchParamBodyText(param as { type: string })})`
  }

  private catchParamBodyText(param: { type: string }): string {
    if (param.type === 'Identifier') {
      return this.identifierWithOptionalText(param as unknown as BindingIdFields)
    }
    return this.sequenceNodeText(param)
  }

  private printFinallyClause(finalizer: BlockStatement | null | undefined): void {
    if (!finalizer) return
    this.out += ' finally '
    this.printBlockStatement(finalizer)
  }

  private printVariableDeclaration(node: VariableDeclaration): void {
    this.out += `${flagText(node.declare, 'declare ')}${node.kind} `
    this.out += node.declarations.map((declaration) => this.variableDeclaratorText(declaration)).join(', ')
  }

  private variableDeclaratorText(node: VariableDeclarator): string {
    return this.capture(() => this.printVariableDeclarator(node))
  }

  private printVariableDeclarator(node: VariableDeclarator): void {
    const id = node.id as unknown as BindingIdFields
    const declarator = node as unknown as { readonly definite?: boolean }
    this.out += this.bindingTargetText(id)
    this.out += flagText(declarator.definite, '!')
    this.out += this.typeAnnotationText(id.typeAnnotation)
    this.out += this.initializerText(node.init)
  }

  private bindingTargetText(id: BindingIdFields): string {
    if (id.type === 'Identifier') {
      return `${bindingNameText(id)}${flagText(id.optional, '?')}`
    }
    return this.sequenceNodeText(id as { type: string })
  }

  private identifierWithOptionalText(node: BindingIdFields): string {
    return `${bindingNameText(node)}${flagText(node.optional, '?')}${this.typeAnnotationText(node.typeAnnotation)}`
  }

  private printParams(params: readonly unknown[]): void {
    this.out += params.map((param) => this.paramText(param as Record<string, unknown>)).join(', ')
  }

  private paramText(param: Record<string, unknown>): string {
    return Match.value(parameterForm(param)).pipe(
      Match.when('rest', () => this.restParamText(param)),
      Match.when('property', () => this.parameterPropertyText(param)),
      Match.orElse(() => this.formalParameterText(param)),
    )
  }

  private restParamText(param: Record<string, unknown>): string {
    return `...${this.assignmentNodeText(param['argument'] as { type: string })}${
      this.typeAnnotationText(param['typeAnnotation'] as TSTypeAnnotation | undefined)
    }`
  }

  private parameterPropertyText(param: Record<string, unknown>): string {
    return `${this.capture(() => this.printDecorators(param['decorators'] as Decorator[] | undefined))}${
      parameterPropertyModifiers(param)
    }${this.parameterPropertyTargetText(param['parameter'])}`
  }

  private parameterPropertyTargetText(parameter: unknown): string {
    if (nodeKind(parameter as { type: string } | null) === 'Identifier') {
      return this.identifierWithOptionalText(parameter as BindingIdFields)
    }
    return this.sequenceNodeText(parameter as { type: string })
  }

  private formalParameterText(param: Record<string, unknown>): string {
    return `${this.capture(() => this.printDecorators(param['decorators'] as Decorator[] | undefined))}${
      this.formalParameterBodyText(param)
    }`
  }

  private formalParameterBodyText(param: Record<string, unknown>): string {
    if (param['type'] === 'Identifier') {
      return this.identifierWithOptionalText(param as unknown as BindingIdFields)
    }
    return `${this.assignmentNodeText(param as unknown as { type: string })}${
      this.typeAnnotationText(param['typeAnnotation'] as TSTypeAnnotation | undefined)
    }`
  }

  private printClassBody(node: ClassBody): void {
    if (node.body.length === 0) {
      this.out += '{}'
    } else {
      this.out += '{\n'
      this.out += this.indentedBodyText(
        node.body,
        (element) => this.printNode(element as { type: string }, PREC.Sequence),
      )
      this.out += `${this.indent()}}`
    }
  }

  private indentedBodyText(items: readonly unknown[], print: (item: unknown) => void): string {
    this.indentLevel++
    const body = items.map((item) => `${this.indent()}${this.capture(() => print(item))}\n`).join('')
    this.indentLevel--
    return body
  }

  private printMethodDefinition(node: MethodDefinition): void {
    const fn = node.value as unknown as FunctionNode
    this.out += this.capture(() => this.printDecorators(node.decorators))
    this.out += methodDefinitionPrefix(node, fn)
    this.out += this.propertyKeyText(node.key as unknown as { type: string }, node.computed === true, PREC.Sequence)
    this.out += flagText(node.optional, '?')
    this.printFunctionTail(fn)
  }

  private printPropertyDefinition(node: PropertyDefinition): void {
    this.out += this.capture(() => this.printDecorators(node.decorators))
    this.out += propertyDefinitionModifiers(node)
    this.out += this.propertyKeyText(node.key as unknown as { type: string }, node.computed === true, PREC.Sequence)
    this.out += flagText(node.optional, '?')
    this.out += flagText(node.definite, '!')
    this.out += this.typeAnnotationText(node.typeAnnotation)
    this.out += this.initializerText(node.value)
    this.out += ';'
  }

  private printAccessorProperty(node: AccessorProperty): void {
    this.out += this.capture(() => this.printDecorators(node.decorators))
    this.out += flagText(node.accessibility, `${node.accessibility} `)
    this.out += flagText(node.static, 'static ')
    this.out += flagText(node.override, 'override ')
    this.out += 'accessor '
    this.out += this.propertyKeyText(node.key as unknown as { type: string }, node.computed === true, PREC.Sequence)
    this.out += flagText(node.definite, '!')
    this.out += this.typeAnnotationText(node.typeAnnotation)
    this.out += this.initializerText(node.value)
    this.out += ';'
  }

  private initializerText(value: unknown): string {
    return flagText(value, ` = ${this.assignmentNodeText(value as { type: string })}`)
  }

  private printStaticBlock(node: StaticBlock): void {
    this.out += 'static {\n'
    this.indentLevel++
    for (const stmt of node.body) {
      this.out += this.indent()
      this.printStatement(stmt as unknown as { type: string })
      this.out += '\n'
    }
    this.indentLevel--
    this.out += `${this.indent()}}`
  }

  // -----------------------------------------------------------------------
  // Imports / Exports
  // -----------------------------------------------------------------------

  private printImportDeclaration(node: ImportDeclaration): void {
    const source = this.printImportSource(node.source, node.attributes)
    this.out += `import ${importKindText(node)}${this.importClauseText(node, source)};`
  }

  private importClauseText(node: ImportDeclaration, source: string): string {
    if (node.specifiers.length === 0) {
      return source
    }
    return `${importBindingsText(node.specifiers)} from ${source}`
  }

  private printImportSource(source: { value: string; raw: string | null }, attrs: readonly ImportAttribute[]): string {
    const raw = source.raw ?? JSON.stringify(source.value)
    return `${raw}${importAttributesText(attrs)}`
  }

  private printExportNamedDeclaration(node: ExportNamedDeclaration): void {
    if (node.declaration !== null) {
      this.out += `export ${this.capture(() => this.printStatement(node.declaration as unknown as { type: string }))}`
    } else {
      this.out += `export ${flagText(node.exportKind === 'type', 'type ')}{ ${
        node.specifiers.map((specifier) => exportSpecifierText(specifier)).join(', ')
      } }${this.exportSourceClauseText(node)};`
    }
  }

  private exportSourceClauseText(node: ExportNamedDeclaration): string {
    if (!node.source) return ''
    const rendered = ` from ${JSON.stringify(node.source.value)}${importAttributesText(node.attributes)}`
    return rendered
  }

  private printExportDefaultDeclaration(node: ExportDefaultDeclaration): void {
    const declaration = node.declaration as { type: string }
    this.out += 'export default '
    if (BARE_DEFAULT_EXPORT_KINDS[declaration.type] === true) {
      this.printStatement(declaration as unknown as { type: string })
    } else {
      this.printNode(declaration, PREC.Assignment)
      this.out += ';'
    }
  }

  private printExportAllDeclaration(node: ExportAllDeclaration): void {
    this.out += `export ${flagText(node.exportKind === 'type', 'type ')}*${exportedNameClauseText(node.exported)}`
    this.out += ` from ${JSON.stringify(node.source.value)}${importAttributesText(node.attributes)};`
  }

  // -----------------------------------------------------------------------
  // TS Declarations
  // -----------------------------------------------------------------------

  private printTSTypeAliasDeclaration(node: TSTypeAliasDeclaration): void {
    this.out += `${flagText(node.declare, 'declare ')}type ${node.id.name}${
      this.typeParametersText(node.typeParameters)
    } = ${this.printTSTypeToString(node.typeAnnotation)};`
  }

  private printTSInterfaceDeclaration(node: TSInterfaceDeclaration): void {
    this.out += `${flagText(node.declare, 'declare ')}interface ${node.id.name}${
      this.typeParametersText(node.typeParameters)
    }`
    this.out += this.interfaceExtendsText(node.extends)
    this.out += ' '
    this.printTSInterfaceBody(node.body)
  }

  private interfaceExtendsText(
    extensions: readonly { expression: unknown; typeArguments?: TSTypeParameterInstantiation | null }[],
  ): string {
    const rendered = extensions.map((heritage) => this.heritageText(heritage)).join(', ')
    return flagText(rendered, ` extends ${rendered}`)
  }

  private printTSInterfaceBody(node: TSInterfaceBody): void {
    if (node.body.length === 0) {
      this.out += '{}'
    } else {
      this.out += '{\n'
      this.out += this.indentedBodyText(node.body, (member) => this.printTSSignature(member as { type: string }))
      this.out += `${this.indent()}}`
    }
  }

  private printTSSignature(sig: { type: string }): void {
    PrintState.SIGNATURE_PRINTER({ type: sig.type, node: sig, state: this })
  }

  private static readonly SIGNATURE_PRINTER = kindDispatch(
    {
      TSPropertySignature: (d) => d.state.printTSPropertySignature(d.node as unknown as TSPropertySignature),
      TSIndexSignature: (d) => d.state.printTSIndexSignature(d.node as unknown as TSIndexSignature),
      TSCallSignatureDeclaration: (d) => d.state.printTSCallSignature(d.node as unknown as TSCallSignatureDeclaration),
      TSConstructSignatureDeclaration: (d) =>
        d.state.printTSConstructSignature(d.node as unknown as TSConstructSignatureDeclaration),
      TSMethodSignature: (d) => d.state.printTSMethodSignature(d.node as unknown as TSMethodSignature),
    },
    (d) => {
      d.state.out += `/* sig:${d.type} */;`
    },
  )

  private printTSPropertySignature(node: TSPropertySignature): void {
    this.out += `${flagText(node.readonly, 'readonly ')}${
      this.propertyKeyText(node.key as unknown as { type: string }, node.computed === true, PREC.Sequence)
    }${flagText(node.optional, '?')}${this.typeAnnotationText(node.typeAnnotation)};`
  }

  private printTSIndexSignature(node: TSIndexSignature): void {
    const parameters = node.parameters.map((parameter) => this.indexParameterText(parameter)).join(', ')
    this.out += `${flagText(node.readonly, 'readonly ')}${flagText(node.static, 'static ')}[${parameters}]${
      this.typeAnnotationText(node.typeAnnotation)
    };`
  }

  private indexParameterText(parameter: { name: string; typeAnnotation: unknown }): string {
    const annotation = parameter.typeAnnotation as TSTypeAnnotation
    return `${parameter.name}: ${this.printTSTypeToString(annotation.typeAnnotation)}`
  }

  private printTSCallSignature(node: TSCallSignatureDeclaration): void {
    this.out += `${this.typeParametersText(node.typeParameters)}(${this.paramsText(node.params)})${
      this.typeAnnotationText(node.returnType)
    };`
  }

  private printTSConstructSignature(node: TSConstructSignatureDeclaration): void {
    this.out += `new ${this.typeParametersText(node.typeParameters)}(${this.paramsText(node.params)})${
      this.typeAnnotationText(node.returnType)
    };`
  }

  private printTSMethodSignature(node: TSMethodSignature): void {
    this.out += `${methodKindText(node.kind)}${
      this.propertyKeyText(node.key as unknown as { type: string }, node.computed === true, PREC.Sequence)
    }${flagText(node.optional, '?')}${this.typeParametersText(node.typeParameters)}(${this.paramsText(node.params)})${
      this.typeAnnotationText(node.returnType)
    };`
  }

  private printTSEnumDeclaration(node: TSEnumDeclaration): void {
    this.out += `${flagText(node.declare, 'declare ')}${flagText(node.const, 'const ')}enum ${node.id.name} {\n`
    this.out += this.indentedBodyText(node.body.members, (member) => this.printEnumMember(member as TSEnumMemberShape))
    this.out += `${this.indent()}}`
  }

  private printEnumMember(member: TSEnumMemberShape): void {
    this.out += `${this.identifierOrLiteralNameText(member.id)}${this.initializerText(member.initializer)},`
  }

  private identifierOrLiteralNameText(id: { type: string }): string {
    return Match.value(id.type).pipe(
      Match.when('Identifier', () => (id as IdentifierName).name),
      Match.when('Literal', () => this.capture(() => this.printLiteral(id as unknown as LiteralSource))),
      Match.orElse(() => this.sequenceNodeText(id)),
    )
  }

  private printTSModuleDeclaration(node: TSModuleDeclaration): void {
    this.out += `${flagText(node.declare, 'declare ')}${this.moduleHeaderText(node)}${this.moduleBodyText(node)}`
  }

  private moduleHeaderText(node: TSModuleDeclaration): string {
    if (isGlobalModule(node)) {
      return 'global '
    }
    return `${node.kind} ${this.identifierOrLiteralNameText(node.id as unknown as { type: string })}`
  }

  private moduleBodyText(node: TSModuleDeclaration): string {
    if (node.body) {
      return ` ${this.capture(() => this.printTSModuleBlock(node.body as TSModuleBlock))}`
    }
    return ';'
  }

  private printTSModuleBlock(node: TSModuleBlock): void {
    this.out += '{\n'
    this.out += this.indentedBodyText(node.body, (statement) => this.printStatement(statement as { type: string }))
    this.out += `${this.indent()}}`
  }

  private printTSImportEqualsDeclaration(node: TSImportEqualsDeclaration): void {
    this.out += `import ${flagText(node.importKind === 'type', 'type ')}${node.id.name} = ${
      this.moduleReferenceText(node.moduleReference as unknown as { type: string })
    };`
  }

  private moduleReferenceText(reference: { type: string }): string {
    if (reference.type === 'TSExternalModuleReference') {
      const external = reference as unknown as { readonly expression: { readonly value: string } }
      return `require(${externalModuleArgumentText(external.expression.value)})`
    }
    return this.sequenceNodeText(reference)
  }

  // -----------------------------------------------------------------------
  // TS Type printers
  // -----------------------------------------------------------------------

  printTSType(node: TSType): void {
    this.out += this.printTSTypeToString(node)
  }

  printTSTypeToString(node: TSType): string {
    const saved = this.out
    this.out = ''
    this.doPrintTSType(node)
    const result = this.out
    this.out = saved
    return result
  }

  private doPrintTSType(node: TSType): void {
    PrintState.TYPE_PRINTER({ type: node.type, node, state: this })
  }

  private static readonly TYPE_PRINTER = kindDispatch(
    {
      TSAnyKeyword: (d) => {
        d.state.out += 'any'
      },
      TSStringKeyword: (d) => {
        d.state.out += 'string'
      },
      TSBooleanKeyword: (d) => {
        d.state.out += 'boolean'
      },
      TSNumberKeyword: (d) => {
        d.state.out += 'number'
      },
      TSBigIntKeyword: (d) => {
        d.state.out += 'bigint'
      },
      TSSymbolKeyword: (d) => {
        d.state.out += 'symbol'
      },
      TSVoidKeyword: (d) => {
        d.state.out += 'void'
      },
      TSUndefinedKeyword: (d) => {
        d.state.out += 'undefined'
      },
      TSNullKeyword: (d) => {
        d.state.out += 'null'
      },
      TSNeverKeyword: (d) => {
        d.state.out += 'never'
      },
      TSUnknownKeyword: (d) => {
        d.state.out += 'unknown'
      },
      TSObjectKeyword: (d) => {
        d.state.out += 'object'
      },
      TSIntrinsicKeyword: (d) => {
        d.state.out += 'intrinsic'
      },
      TSThisType: (d) => {
        d.state.out += 'this'
      },
      TSTypeReference: (d) => {
        const n = d.node as TSTypeReference
        d.state.printTSTypeName(n.typeName)
        d.state.out += d.state.typeArgumentsText(n.typeArguments)
      },
      TSUnionType: (d) => {
        const n = d.node as TSUnionType
        d.state.out += d.state.tSTypeListText(n.types, ' | ')
      },
      TSIntersectionType: (d) => {
        const n = d.node as TSIntersectionType
        d.state.out += d.state.tSTypeListText(n.types, ' & ')
      },
      TSArrayType: (d) => {
        const n = d.node as TSArrayType
        d.state.out += `${d.state.arrayElementTypeText(n.elementType)}[]`
      },
      TSTypeLiteral: (d) => {
        const n = d.node as unknown as { members: { type: string }[] }
        d.state.printTSTypeLiteral(n.members)
      },
      TSTupleType: (d) => {
        const n = d.node as TSTupleType
        d.state.printTupleType(n.elementTypes)
      },
      TSConditionalType: (d) => {
        const n = d.node as TSConditionalType
        d.state.doPrintTSType(n.checkType)
        d.state.out += ' extends '
        d.state.doPrintTSType(n.extendsType)
        d.state.out += ' ? '
        d.state.doPrintTSType(n.trueType)
        d.state.out += ' : '
        d.state.doPrintTSType(n.falseType)
      },
      TSInferType: (d) => {
        const n = d.node as TSInferType
        d.state.out += `infer ${n.typeParameter.name.name}`
        d.state.printTypeClause(' extends ', n.typeParameter.constraint)
      },
      TSTypeQuery: (d) => {
        const n = d.node as TSTypeQuery
        d.state.out += 'typeof '
        d.state.printTypeQueryName(n)
        d.state.out += d.state.typeArgumentsText(n.typeArguments)
      },
      TSImportType: (d) => d.state.printTSImportType(d.node as TSImportType),
      TSTypeOperator: (d) => {
        const n = d.node as TSTypeOperator
        d.state.out += `${n.operator} `
        d.state.doPrintTSType(n.typeAnnotation)
      },
      TSMappedType: (d) => d.state.printMappedType(d.node as TSMappedType),
      TSTemplateLiteralType: (d) => d.state.printTSTemplateLiteral(d.node as TSTemplateLiteralType),
      TSFunctionType: (d) => d.state.printTSFunctionType(d.node as TSFunctionType),
      TSConstructorType: (d) => d.state.printTSConstructorType(d.node as TSConstructorType),
      TSTypePredicate: (d) => d.state.printTSTypePredicate(d.node as TSTypePredicate),
      TSIndexedAccessType: (d) => {
        const n = d.node as TSIndexedAccessType
        d.state.doPrintTSType(n.objectType)
        d.state.out += '['
        d.state.doPrintTSType(n.indexType)
        d.state.out += ']'
      },
      // TSTypeParameter is not a TSType — handled via declarations, not here
      TSLiteralType: (d) => d.state.printTSLiteralType((d.node as TSLiteralType).literal),
      TSParenthesizedType: (d) => {
        const n = d.node as TSParenthesizedType
        d.state.out += '('
        d.state.doPrintTSType(n.typeAnnotation)
        d.state.out += ')'
      },
      TSJSDocNullableType: (d) => d.state.printJSDocPostfixModifier(d.node as JSDocNullableType, '?'),
      TSJSDocNonNullableType: (d) => d.state.printJSDocPostfixModifier(d.node as JSDocNonNullableType, '!'),
      TSJSDocUnknownType: (d) => {
        d.state.out += '?'
      },
    },
    (d) => d.state.out += `/* type:${d.type} */`,
  )

  private tSTypeListText(types: readonly TSType[], separator: string): string {
    return types.map((type) => this.printTSTypeToString(type)).join(separator)
  }

  private arrayElementTypeText(type: TSType): string {
    const printed = this.printTSTypeToString(type)
    return parenthesizedIf(ARRAY_ELEMENT_WRAPPED_KINDS[type.type] === true, printed)
  }

  private printTSTypeLiteral(members: readonly { type: string }[]): void {
    const rendered = members.map((member) => this.signatureText(member)).join('; ')
    if (members.length === 0) {
      this.out += '{}'
    } else {
      this.out += `{ ${rendered} }`
    }
  }

  private signatureText(member: { type: string }): string {
    const printed = this.capture(() => this.printTSSignature(member))
    if (printed.endsWith(';')) {
      return printed.slice(0, -1)
    }
    return printed
  }

  private printTupleType(elements: readonly unknown[]): void {
    this.out += `[${elements.map((element) => this.capture(() => this.printTupleElement(element))).join(', ')}]`
  }

  private printTupleElement(element: unknown): void {
    const tupleElement = element as { type: string }
    Match.value(tupleElement.type).pipe(
      Match.when('TSRestType', () => {
        this.out += '...'
        this.doPrintTSType((tupleElement as unknown as TSRestType).typeAnnotation)
      }),
      Match.when('TSOptionalType', () => {
        this.doPrintTSType((tupleElement as unknown as TSOptionalType).typeAnnotation)
        this.out += '?'
      }),
      Match.when('TSNamedTupleMember', () => {
        this.printNamedTupleMember(tupleElement as unknown as TSNamedTupleMember)
      }),
      Match.orElse(() => {
        this.doPrintTSType(tupleElement as unknown as TSType)
      }),
    )
  }

  private printNamedTupleMember(member: TSNamedTupleMember): void {
    this.out += `${member.label.name}${flagText(member.optional, '?')}: `
    this.printTupleElement(member.elementType)
  }

  private printTypeClause(keyword: string, type: TSType | null | undefined): void {
    if (!type) return
    this.out += keyword
    this.doPrintTSType(type)
  }

  private printTypeQueryName(node: TSTypeQuery): void {
    if (node.exprName.type === 'TSImportType') {
      this.doPrintTSType(node.exprName as unknown as TSType)
    } else {
      this.printTSTypeName(node.exprName as unknown as IdentifierReference)
    }
  }

  private printTSImportType(node: TSImportType): void {
    this.printTSImportTypeSource(node)
    if (node.qualifier) {
      this.out += '.'
      this.printTSImportTypeQualifier(node.qualifier)
    }
    this.out += this.typeArgumentsText(node.typeArguments)
  }

  private printTSImportTypeSource(node: TSImportType): void {
    this.out += `import(${JSON.stringify(node.source.value)}`
    this.out += flagText(node.options, `, ${this.assignmentNodeText(node.options as unknown as { type: string })}`)
    this.out += ')'
  }

  private printMappedType(node: TSMappedType): void {
    this.out += '{ '
    this.printMappedTypeModifier(node.readonly, 'readonly ')
    this.out += `[${node.key.name} in `
    this.doPrintTSType(node.constraint)
    this.printTypeClause(' as ', node.nameType)
    this.out += ']'
    this.printMappedTypeModifier(node.optional, '?')
    this.printTypeClause(': ', node.typeAnnotation)
    this.out += ' }'
  }

  private printMappedTypeModifier(modifier: unknown, rendered: string): void {
    Match.value(modifier).pipe(
      Match.when(true, () => {
        this.out += rendered
      }),
      Match.when('+', () => {
        this.out += `+${rendered}`
      }),
      Match.when('-', () => {
        this.out += `-${rendered}`
      }),
      Match.orElse(() => undefined),
    )
  }

  private printTSTemplateLiteral(node: TSTemplateLiteralType): void {
    this.out += `\`${
      node.quasis
        .map((quasi, index) => this.templateTypeQuasiText(quasi, node.types[index]!))
        .join('')
    }\``
  }

  private templateTypeQuasiText(quasi: TemplateElement, type: TSType): string {
    if (quasi.tail) {
      return quasi.value.raw
    }
    return `${quasi.value.raw}\${${this.printTSTypeToString(type)}}`
  }

  private printTSFunctionType(node: TSFunctionType): void {
    this.out += `${this.typeParametersText(node.typeParameters)}(${this.paramsText(node.params)}) => ${
      this.printTSTypeToString((node.returnType as TSTypeAnnotation).typeAnnotation)
    }`
  }

  private printTSConstructorType(node: TSConstructorType): void {
    this.out += `${flagText(node.abstract, 'abstract ')}new ${this.typeParametersText(node.typeParameters)}(${
      this.paramsText(node.params)
    }) => ${this.printTSTypeToString((node.returnType as TSTypeAnnotation).typeAnnotation)}`
  }

  private printTSTypePredicate(node: TSTypePredicate): void {
    this.out += flagText(node.asserts, 'asserts ')
    this.out += typePredicateParameterText(node.parameterName as unknown as { type: string })
    this.printPredicateAnnotation(node)
  }

  private printPredicateAnnotation(node: TSTypePredicate): void {
    if (!node.typeAnnotation) return
    this.printTypeClause(' is ', node.typeAnnotation.typeAnnotation)
  }

  private printTSLiteralType(literal: unknown): void {
    Match.value(nodeKind(literal as { type: string } | null)).pipe(
      Match.when('Literal', () => {
        this.printLiteral(literal as LiteralSource)
      }),
      Match.when('TemplateLiteral', () => {
        this.printTemplateLiteral(literal as unknown as TemplateLiteral)
      }),
      Match.when('UnaryExpression', () => {
        this.printTSLiteralUnary(literal as unknown as UnaryExpression)
      }),
      Match.orElse(() => {
        this.printNode(literal as { type: string }, PREC.Sequence)
      }),
    )
  }

  private printTSLiteralUnary(unary: UnaryExpression): void {
    this.out += unary.operator
    this.printLiteral(unary.argument as unknown as LiteralSource)
  }

  private printJSDocPostfixModifier(
    node: { readonly postfix?: boolean | null; readonly typeAnnotation: TSType },
    marker: string,
  ): void {
    if (node.postfix === true) {
      this.doPrintTSType(node.typeAnnotation)
      this.out += marker
    } else {
      this.out += marker
      this.doPrintTSType(node.typeAnnotation)
    }
  }

  private printTSTypeName(name: IdentifierReference | TSQualifiedName | { type: string }): void {
    if (nodeKind(name) === 'TSQualifiedName') {
      const qualified = name as TSQualifiedName
      this.printTSTypeName(qualified.left)
      this.out += `.${qualified.right.name}`
    } else {
      this.out += this.tSTypeNameLeafText(name)
    }
  }

  private tSTypeNameLeafText(name: IdentifierReference | { type: string }): string {
    return Match.value(nodeKind(name)).pipe(
      Match.when('Identifier', () => (name as IdentifierReference).name),
      Match.when('ThisExpression', () => 'this'),
      Match.orElse(() => this.sequenceNodeText(name as { type: string })),
    )
  }

  private printTSImportTypeQualifier(qualifier: TSImportType['qualifier']): void {
    Match.value(nodeKind(qualifier as { type: string } | null)).pipe(
      Match.when(ABSENT_NODE_KIND, () => undefined),
      Match.when('Identifier', () => {
        this.out += (qualifier as IdentifierName).name
      }),
      Match.orElse(() => {
        const qualified = qualifier as unknown as {
          readonly left: TSImportType['qualifier']
          readonly right: IdentifierName
        }
        this.printTSImportTypeQualifier(qualified.left)
        this.out += `.${qualified.right.name}`
      }),
    )
  }

  private printTSTypeAnnotation(node: TSTypeAnnotation): void {
    this.out += ': '
    this.doPrintTSType(node.typeAnnotation)
  }

  private printTSTypeParameterDeclaration(node: TSTypeParameterDeclaration): void {
    this.out += `<${node.params.map((param) => this.capture(() => this.printTSTypeParameter(param))).join(', ')}>`
  }

  private printTSTypeParameterInstantiation(node: TSTypeParameterInstantiation): void {
    this.out += `<${node.params.map((param) => this.printTSTypeToString(param)).join(', ')}>`
  }

  private printTSTypeParameter(node: TSTypeParameterFields): void {
    this.out += typeParameterModifiersText(node)
    this.out += node.name.name
    this.printTypeClause(' extends ', node.constraint)
    this.printTypeClause(' = ', node.default)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS_TYPE_NODE_KINDS: Readonly<Record<string, true>> = {
  TSAnyKeyword: true,
  TSStringKeyword: true,
  TSBooleanKeyword: true,
  TSNumberKeyword: true,
  TSBigIntKeyword: true,
  TSSymbolKeyword: true,
  TSVoidKeyword: true,
  TSUndefinedKeyword: true,
  TSNullKeyword: true,
  TSNeverKeyword: true,
  TSUnknownKeyword: true,
  TSObjectKeyword: true,
  TSIntrinsicKeyword: true,
  TSThisType: true,
  TSTypeReference: true,
  TSUnionType: true,
  TSIntersectionType: true,
  TSArrayType: true,
  TSTypeLiteral: true,
  TSTupleType: true,
  TSNamedTupleMember: true,
  TSOptionalType: true,
  TSRestType: true,
  TSConditionalType: true,
  TSInferType: true,
  TSTypeQuery: true,
  TSImportType: true,
  TSTypeOperator: true,
  TSMappedType: true,
  TSTemplateLiteralType: true,
  TSFunctionType: true,
  TSConstructorType: true,
  TSTypePredicate: true,
  TSIndexedAccessType: true,
  TSLiteralType: true,
  TSParenthesizedType: true,
  TSJSDocNullableType: true,
  TSJSDocNonNullableType: true,
  TSJSDocUnknownType: true,
}

function isTSTypeNode(kind: string): boolean {
  return TS_TYPE_NODE_KINDS[kind] === true
}

const EXPRESSION_PRECEDENCE = Match.type<Expression>().pipe(
  Match.discriminators('type')({
    SequenceExpression: () => PREC.Sequence,
    AssignmentExpression: () => PREC.Assignment,
    ConditionalExpression: () => PREC.Conditional,
    LogicalExpression: (node) => logicalPrec(node.operator),
    BinaryExpression: (node) => binaryPrec(node.operator),
    UnaryExpression: () => PREC.Unary,
    AwaitExpression: () => PREC.Unary,
    YieldExpression: () => PREC.Unary,
    UpdateExpression: () => PREC.Update,
    CallExpression: () => PREC.Call,
    NewExpression: () => PREC.Call,
    TaggedTemplateExpression: () => PREC.Call,
    ImportExpression: () => PREC.Call,
    MemberExpression: () => PREC.Member,
    ChainExpression: () => PREC.Member,
  }),
  Match.orElse(() => PREC.Primary),
)

const precOf = (node: Expression): number => EXPRESSION_PRECEDENCE(node)

const EVERY_COMMENT_POSITION = Number.POSITIVE_INFINITY

const END_OF_COMMENTS: Comment = {
  type: 'Line',
  value: '',
  start: EVERY_COMMENT_POSITION,
  end: EVERY_COMMENT_POSITION,
}

function sortedCommentsWithoutHashbang(
  comments: readonly Comment[] | undefined,
  hashbang: Hashbang | null,
): readonly Comment[] {
  const list = comments ?? []
  return [...withoutHashbangComment(list, hashbang)].sort((a, b) => a.start - b.start)
}

function withoutHashbangComment(comments: readonly Comment[], hashbang: Hashbang | null): readonly Comment[] {
  if (hashbang === null) {
    return comments
  }
  const { start } = hashbang
  return comments.filter((comment) => !(comment.type === 'Line' && comment.start === start))
}

type PropertyFields = {
  readonly kind?: string
  readonly method?: boolean
  readonly shorthand?: boolean
  readonly computed?: boolean
  readonly async?: boolean
  readonly generator?: boolean
  readonly key: { readonly type: string }
  readonly value: { readonly type: string } | null
}

const isGlobalModule = (node: TSModuleDeclaration): boolean =>
  (node as unknown as { readonly global?: boolean }).global === true

const isAccessorProperty = (fields: PropertyFields): boolean => fields.kind === 'get' || fields.kind === 'set'

const isMethodProperty = (fields: PropertyFields): boolean => fields.method === true

function propertyForm(fields: PropertyFields): string {
  return Match.value(fields).pipe(
    Match.when(isAccessorProperty, () => 'accessor'),
    Match.when(isMethodProperty, () => 'method'),
    Match.when(isShorthandMatch, () => 'shorthand'),
    Match.when(isShorthandDefaultMatch, () => 'shorthandDefault'),
    Match.orElse(() => 'verbose'),
  )
}

function isShorthandMatch(fields: PropertyFields): boolean {
  return fields.shorthand === true && namesMatch(identifierName(fields.key), identifierName(fields.value))
}

function isShorthandDefaultMatch(fields: PropertyFields): boolean {
  return fields.shorthand === true && namesMatch(identifierName(fields.key), defaultTargetName(fields.value))
}

function identifierName(node: { type: string } | null): string | undefined {
  if (nodeKind(node) === 'Identifier') {
    return (node as IdentifierName).name
  }
  return undefined
}

function defaultTargetName(node: { type: string } | null): string | undefined {
  if (nodeKind(node) === 'AssignmentPattern') {
    return identifierName((node as AssignmentPattern).left as { type: string })
  }
  return undefined
}

function namesMatch(key: string | undefined, value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  return key === value
}

type AttachedComment = { readonly type: string; readonly value: string }

type MemberAccess = {
  readonly computed: boolean
  readonly optional: boolean
  readonly object: { readonly type: string }
  readonly property: { readonly type: string }
}

const MEMBER_OBJECT_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  SequenceExpression: true,
  AssignmentExpression: true,
  ConditionalExpression: true,
  LogicalExpression: true,
  BinaryExpression: true,
  UnaryExpression: true,
  UpdateExpression: true,
  AwaitExpression: true,
  YieldExpression: true,
}

const CALLEE_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  SequenceExpression: true,
  ConditionalExpression: true,
}

const UNARY_OPERAND_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  BinaryExpression: true,
  LogicalExpression: true,
  ConditionalExpression: true,
  SequenceExpression: true,
}

const UNARY_WORD_OPERATORS: Readonly<Record<string, true>> = {
  typeof: true,
  void: true,
  delete: true,
}

function parenthesizedIf(wrap: boolean, text: string): string {
  if (wrap) {
    return `(${text})`
  }
  return text
}

function jsxAttributeNameText(name: JSXIdentifier | JSXNamespacedName): string {
  if (name.type === 'JSXIdentifier') {
    return (name as JSXIdentifier).name
  }
  return `${(name as JSXNamespacedName).namespace.name}:${(name as JSXNamespacedName).name.name}`
}

const BARE_DEFAULT_EXPORT_KINDS: Readonly<Record<string, true>> = {
  FunctionDeclaration: true,
  ClassDeclaration: true,
  TSInterfaceDeclaration: true,
}

const ARRAY_ELEMENT_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  TSUnionType: true,
  TSIntersectionType: true,
}

type TSEnumMemberShape = { readonly id: { readonly type: string }; readonly initializer: unknown }

type TSTypeParameterFields = {
  readonly name: { readonly name: string }
  readonly constraint: TSType | null
  readonly default: TSType | null
  readonly in?: boolean
  readonly out?: boolean
  readonly const?: boolean
}

function typeParameterModifiersText(node: TSTypeParameterFields): string {
  return `${flagText(node.in, 'in ')}${flagText(node.out, 'out ')}${flagText(node.const, 'const ')}`
}

function typePredicateParameterText(parameterName: { type: string }): string {
  if (parameterName.type === 'TSThisType') {
    return 'this'
  }
  return (parameterName as unknown as { name: string }).name
}

function externalModuleArgumentText(value: string): string {
  if (value) {
    return JSON.stringify(value)
  }
  return '""'
}

type ExportNameNode = { readonly type: string; readonly name?: string; readonly value?: string }

const EXPORT_NAME_TEXTS: Readonly<Record<string, (name: ExportNameNode) => string>> = {
  Identifier: (name) => name.name ?? '',
  Literal: (name) => name.value ?? '',
}

function exportNameToString(name: ExportNameNode): string {
  const reader = EXPORT_NAME_TEXTS[name.type] ?? ((exported: ExportNameNode) => exported.value ?? '')
  return reader(name)
}

function importKindText(node: ImportDeclaration): string {
  return flagText(node.importKind === 'type', 'type ')
}

type ImportBinding = {
  readonly type: string
  readonly local: { readonly name: string }
  readonly imported?: { readonly type: string; readonly name?: string; readonly value?: string }
  readonly importKind?: string
}

function importBindingsText(specifiers: readonly ImportBinding[]): string {
  const parts = [
    defaultSpecifierText(specifiers),
    namespaceSpecifierText(specifiers),
    namedSpecifiersText(specifiers),
  ]
  return parts.filter((text) => text.length > 0).join(', ')
}

function defaultSpecifierText(specifiers: readonly ImportBinding[]): string {
  return importLocalName(specifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier'))
}

function namespaceSpecifierText(specifiers: readonly ImportBinding[]): string {
  const name = importLocalName(specifiers.find((specifier) => specifier.type === 'ImportNamespaceSpecifier'))
  return flagText(name, `* as ${name}`)
}

function namedSpecifiersText(specifiers: readonly ImportBinding[]): string {
  const rendered = specifiers
    .filter((specifier) => specifier.type === 'ImportSpecifier')
    .map((specifier) => namedSpecifierText(specifier))
    .join(', ')
  return flagText(rendered, `{ ${rendered} }`)
}

function namedSpecifierText(specifier: ImportBinding): string {
  const alias = exportAliasText(importedNameText(specifier.imported), specifier.local.name)
  return `${flagText(specifier.importKind === 'type', 'type ')}${alias}`
}

function importLocalName(specifier: ImportBinding | undefined): string {
  if (nodeKind(specifier as { type: string } | null) === ABSENT_NODE_KIND) {
    return ''
  }
  return (specifier as ImportBinding).local.name
}

function importedNameText(imported: ImportBinding['imported']): string {
  if (nodeKind(imported as { type: string } | null) === 'Identifier') {
    return (imported as { name: string }).name
  }
  return (imported as { value: string }).value
}

function exportAliasText(localName: string, exportedName: string): string {
  if (localName === exportedName) {
    return localName
  }
  return `${localName} as ${exportedName}`
}

function exportSpecifierText(specifier: {
  readonly local: ExportNameNode
  readonly exported: ExportNameNode
  readonly exportKind?: string
}): string {
  const alias = exportAliasText(exportNameToString(specifier.local), exportNameToString(specifier.exported))
  return `${flagText(specifier.exportKind === 'type', 'type ')}${alias}`
}

function exportedNameClauseText(exported: ExportNameNode | null | undefined): string {
  if (nodeKind(exported as { type: string } | null) === ABSENT_NODE_KIND) {
    return ''
  }
  return ` as ${exportNameToString(exported as ExportNameNode)}`
}

function importAttributesText(attrs: readonly ImportAttribute[]): string {
  const rendered = attrs.map((attribute) => importAttributeText(attribute)).join(', ')
  return flagText(rendered, ` with { ${rendered} }`)
}

function importAttributeText(attribute: ImportAttribute): string {
  return `${importAttrKeyText(attribute.key)}: ${JSON.stringify(attribute.value.value)}`
}

function importAttrKeyText(key: ImportAttribute['key']): string {
  if (key.type === 'Identifier') {
    return (key as IdentifierName).name
  }
  return JSON.stringify((key as { value: string }).value)
}

function bareArrowParamName(node: ArrowFunctionExpression): string {
  const name = singleParamName(node)
  if (name === '') {
    return ''
  }
  return flagText(node.returnType == null, name)
}

function singleParamName(node: ArrowFunctionExpression): string {
  if (node.params.length === 1) {
    return bareParameterName(node.params[0])
  }
  return ''
}

type ParameterFields = {
  readonly type?: string
  readonly typeAnnotation?: unknown
  readonly name?: string
}

const hasTypedRecord = (value: object): boolean =>
  Predicate.hasProperty(value, 'type') && typeof value['type'] === 'string'

const isParameterFields = (value: unknown): value is ParameterFields =>
  Predicate.isObject(value) && hasTypedRecord(value)

const isIdentifierParameter = (fields: ParameterFields): boolean => fields.type === 'Identifier'

const hasNoTypeAnnotation = (fields: ParameterFields): boolean => fields.typeAnnotation == null

const isBareParameter = (fields: ParameterFields): boolean =>
  isIdentifierParameter(fields) && hasNoTypeAnnotation(fields)

const isBareIdentifierParameter = (value: unknown): value is ParameterFields =>
  isParameterFields(value) && isBareParameter(value)

const parameterName = (fields: ParameterFields): string => fields.name ?? ''

function bareParameterName(param: unknown): string {
  return Match.value(param).pipe(
    Match.when(isBareIdentifierParameter, parameterName),
    Match.orElse(() => ''),
  )
}

const isBlockBody = (kind: string | undefined): boolean => kind === 'BlockStatement'

function arrowBodyIsBlock(body: unknown): boolean {
  return isBlockBody(nodeKind(body as { type: string } | null))
}

function functionHeaderText(node: FunctionNode): string {
  return `${flagText(node.declare, 'declare ')}${flagText(node.async, 'async ')}function${
    flagText(node.generator, '*')
  }${namedDeclarationText(node)}`
}

function namedDeclarationText(node: { readonly id?: { readonly name: string } | null }): string {
  if (node.id) {
    return ` ${(node.id as { name: string }).name}`
  }
  return ''
}

type BindingIdFields = {
  readonly type?: string
  readonly name?: string
  readonly optional?: boolean
  readonly typeAnnotation?: TSTypeAnnotation | null
}

function bindingNameText(node: { readonly name?: string }): string {
  if (node.name === undefined) {
    return ''
  }
  return node.name
}

const isRestParameter = (param: Record<string, unknown>): boolean => param['type'] === 'RestElement'

const isParameterProperty = (param: Record<string, unknown>): boolean => param['type'] === 'TSParameterProperty'

function parameterForm(param: Record<string, unknown>): string {
  return Match.value(param).pipe(
    Match.when(isRestParameter, () => 'rest'),
    Match.when(isParameterProperty, () => 'property'),
    Match.orElse(() => 'formal'),
  )
}

function parameterPropertyModifiers(param: Record<string, unknown>): string {
  const accessibility = param['accessibility'] as string | null | undefined
  return `${flagText(accessibility, `${accessibility} `)}${flagText(param['readonly'], 'readonly ')}${
    flagText(param['override'], 'override ')
  }${flagText(param['static'], 'static ')}`
}

function commentText(comment: AttachedComment): string {
  if (comment.type === 'Block') {
    return `/*${comment.value}*/`
  }
  return `//${comment.value}`
}

function methodDefinitionPrefix(node: MethodDefinition, fn: FunctionNode): string {
  return `${flagText(node.accessibility, `${node.accessibility} `)}${flagText(node.static, 'static ')}${
    flagText(node.override, 'override ')
  }${flagText(fn.async, 'async ')}${flagText(fn.generator, '*')}${methodKindText(node.kind)}`
}

function methodKindText(kind: string): string {
  return Match.value(kind).pipe(
    Match.when('get', () => 'get '),
    Match.when('set', () => 'set '),
    Match.orElse(() => ''),
  )
}

function propertyDefinitionModifiers(node: PropertyDefinition): string {
  return `${flagText(node.declare, 'declare ')}${flagText(node.accessibility, `${node.accessibility} `)}${
    flagText(node.static, 'static ')
  }${flagText(node.readonly, 'readonly ')}${flagText(node.override, 'override ')}`
}

type LiteralSource = {
  readonly value: unknown
  readonly raw: string | null
  readonly bigint?: string
  readonly regex?: { readonly pattern: string; readonly flags: string }
}

type RawTextSource = LiteralSource & { readonly raw: string }

type RegExpSource = LiteralSource & { readonly regex: { readonly pattern: string; readonly flags: string } }

type BigIntSource = LiteralSource & { readonly bigint: string }

const hasRawText = (node: LiteralSource): node is RawTextSource => node.raw != null

const hasRegExpSource = (node: LiteralSource): node is RegExpSource => node.regex != null

const hasBigIntSource = (node: LiteralSource): node is BigIntSource => node.bigint != null

function literalText(node: LiteralSource): string {
  return Match.value(node).pipe(
    Match.when(hasRawText, (source) => source.raw),
    Match.when(hasRegExpSource, (source) => `/${source.regex.pattern}/${source.regex.flags}`),
    Match.when(hasBigIntSource, (source) => source.bigint),
    Match.orElse((source) => valueLiteralText(source.value)),
  )
}

function valueLiteralText(value: unknown): string {
  return Match.value(typeof value).pipe(
    Match.when('string', () => JSON.stringify(value)),
    Match.when('number', () => String(value)),
    Match.when('boolean', () => String(value)),
    Match.when('bigint', () => `${String(value)}n`),
    Match.orElse(() => 'null'),
  )
}

const isFlagOn = (value: unknown): boolean => Boolean(value) === true

function flagText(present: unknown, text: string): string {
  if (isFlagOn(present)) {
    return text
  }
  return ''
}
