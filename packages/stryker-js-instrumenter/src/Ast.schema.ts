import type { EmbeddedDocument, FormatId, FrameworkContext } from '@systemfsoftware/stryker-framework-interface'
import type { Node, Program } from '@systemfsoftware/stryker-ignorer-interface'
import type { Position } from './Location.schema.js'
import type { AstFormat } from './Syntax.schema.js'

export interface SpannedComment {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}

export interface SourceLocationInFile {
  end: Position
  start: Position
}

export type ScriptFormat = Extract<AstFormat, 'js' | 'ts' | 'tsx'>

export type AstRoot = Program

export interface BaseAst {
  originFileName: string
  rawContent: string
  root: Program
  offset?: Position
}

export interface EmbeddedAst {
  format: 'embedded'
  formatId: FormatId
  originFileName: string
  rawContent: string
  document: EmbeddedDocument
  readonly context: FrameworkContext
  scripts: readonly EmbeddedScript[]
}

export interface EmbeddedScript {
  readonly region: number
  readonly ast: ScriptAst
}

export interface JSAst extends BaseAst {
  format: 'js'
  root: Program
  comments: readonly SpannedComment[]
}

export interface TSAst extends BaseAst {
  format: 'ts'
  root: Program
  comments: readonly SpannedComment[]
}

export interface TsxAst extends BaseAst {
  format: 'tsx'
  root: Program
  comments: readonly SpannedComment[]
}

export type ScriptAst = JSAst | TSAst | TsxAst

export type Ast = JSAst | TSAst | TsxAst | EmbeddedAst

export interface AstByFormat {
  js: JSAst
  ts: TSAst
  tsx: TsxAst
}

export type AstNode = Node
