import type { Node, Program } from '@systemfsoftware/stryker-ignorer-interface'
import type { Position } from './Location.schema.js'
import type { AstFormat } from './Syntax.schema.js'

export interface SpannedComment {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}

export interface Range {
  start: number
  end: number
}

export interface SourceLocationInFile {
  end: Position
  start: Position
}

export type ScriptFormat = Extract<AstFormat, 'js' | 'ts' | 'tsx'>

export interface BaseAst {
  originFileName: string
  rawContent: string
  root: Ast['root']
  offset?: Position
}

export interface HtmlAst extends BaseAst {
  format: 'html'
  root: HtmlRootNode
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

export interface SvelteAst extends BaseAst {
  format: 'svelte'
  root: SvelteRootNode
}

export interface HtmlRootNode {
  scripts: ScriptAst[]
}

export interface SvelteRootNode {
  moduleScript?: TemplateScript
  additionalScripts: TemplateScript[]
}

export interface TemplateScript {
  ast: ScriptAst
  range: Range
  isExpression: boolean
}

export type ScriptAst = JSAst | TSAst | TsxAst

export type Ast = HtmlAst | JSAst | SvelteAst | TSAst | TsxAst

export interface AstByFormat {
  html: HtmlAst
  js: JSAst
  ts: TSAst
  tsx: TsxAst
  svelte: SvelteAst
}

export type AstNode = Node
