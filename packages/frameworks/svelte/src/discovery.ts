import type { FrameworkParseResult, ScriptFormat } from '@systemfsoftware/stryker-framework-interface'
import type { AST } from 'svelte/compiler'

import type { CompilerModule } from './compiler.js'

const PARSE_FILENAME = 'component.svelte'
const NON_ERROR_FAILURE = 'the svelte compiler reported a failure that is not an Error'

export interface LocatedRegion {
  readonly start: number
  readonly end: number
  readonly isExpression: boolean
  readonly scriptFormat: ScriptFormat
  readonly isModuleScript: boolean
}

export interface Discovery {
  readonly root: AST.Root
  readonly regions: readonly LocatedRegion[]
}

type TemplateExpression = AST.ExpressionTag['expression']
type AttributeValue = true | AST.ExpressionTag | ReadonlyArray<AST.Text | AST.ExpressionTag>
type AttributeNode = AST.Attribute | AST.SpreadAttribute | AST.Directive | AST.AttachTag
type TemplateNode = AST.Text | AST.Tag | AST.ElementLike | AST.Block | AST.Comment

export const discoveredOf = (compiler: CompilerModule, rawContent: string): Discovery => {
  const root = compiler.parse(rawContent, { filename: PARSE_FILENAME, modern: true })
  return { root, regions: regionsOf(root) }
}

export const attemptedDiscovery = (compiler: CompilerModule, rawContent: string): FrameworkParseResult<Discovery> =>
  failedDiscovery(safeDiscovery(compiler, rawContent))

const safeDiscovery = (
  compiler: CompilerModule,
  rawContent: string,
): { readonly discovery?: Discovery; readonly cause?: unknown } => {
  try {
    return { discovery: discoveredOf(compiler, rawContent) }
  } catch (cause) {
    return { cause }
  }
}

const failedDiscovery = ({
  discovery,
  cause,
}: {
  readonly discovery?: Discovery
  readonly cause?: unknown
}): FrameworkParseResult<Discovery> => discovery === undefined ? failedResult(cause) : parsedDiscovery(discovery)

const failedResult = (cause: unknown): FrameworkParseResult<Discovery> => ({
  kind: 'ParseFailed',
  message: failureMessageOf(cause),
})

const parsedDiscovery = (discovery: Discovery): FrameworkParseResult<Discovery> => ({
  kind: 'Parsed',
  value: discovery,
})

const failureMessageOf = (cause: unknown): string => messageText(cause instanceof Error ? cause.message : undefined)

const messageText = (message: string | undefined): string => message ?? NON_ERROR_FAILURE

const byStart = (left: { readonly start: number }, right: { readonly start: number }): number =>
  left.start - right.start
const regionsOf = (root: AST.Root): readonly LocatedRegion[] =>
  [scriptRegion(root.module, true), scriptRegion(root.instance, false), ...regionsFromFragment(root.fragment)]
    .filter((region): region is LocatedRegion => region !== undefined)
    .toSorted(byStart)

const scriptRegion = (script: AST.Script | null | undefined, isModuleScript: boolean): LocatedRegion | undefined =>
  definedValue(script) ? locatedScript(script, isModuleScript) : undefined

const locatedScript = (script: AST.Script, isModuleScript: boolean): LocatedRegion => ({
  start: script.content.start,
  end: script.content.end,
  isExpression: false,
  scriptFormat: scriptFormatOf(script),
  isModuleScript,
})

const scriptFormatOf = (script: AST.Script): ScriptFormat =>
  script.attributes.some((attribute) => attribute.name === 'lang' && declaresTs(attribute.value)) ? 'ts' : 'js'

const declaresTs = (value: AttributeValue): boolean =>
  Array.isArray(value) && value.some((part) => part.type === 'Text' && part.data === 'ts')
const regionsFromFragment = (fragment: AST.Fragment): readonly LocatedRegion[] =>
  fragment.nodes.flatMap((node) => nodeRegions(node))
const foundRegion = (expression: TemplateExpression): LocatedRegion => ({
  start: expression.start,
  end: expression.end,
  isExpression: true,
  scriptFormat: 'js',
  isModuleScript: false,
})
const foundRegions = (
  value: ReadonlyArray<AST.Text | AST.ExpressionTag>,
): readonly LocatedRegion[] => value.flatMap(partRegion)

const partRegion = (part: AST.Text | AST.ExpressionTag): readonly LocatedRegion[] =>
  part.type === 'ExpressionTag' ? [tagExpression(part)] : []

const tagExpression = (tag: AST.ExpressionTag): LocatedRegion => foundRegion(tag.expression)

const valueExpressions = (value: AttributeValue): readonly LocatedRegion[] => {
  if (Array.isArray(value)) {
    return foundRegions(value)
  }
  return singleTag(value)
}

const singleTag = (
  value: true | AST.ExpressionTag | ReadonlyArray<AST.Text | AST.ExpressionTag>,
): readonly LocatedRegion[] => (isSingleTag(value) ? [tagExpression(value)] : [])

const isSingleTag = (
  value: true | AST.ExpressionTag | ReadonlyArray<AST.Text | AST.ExpressionTag>,
): value is AST.ExpressionTag => !Array.isArray(value) && value !== true
const nodeRegions = (node: TemplateNode): readonly LocatedRegion[] => {
  switch (node.type) {
    case 'Text':
    case 'Comment':
    case 'DebugTag':
    case 'AttachTag':
      return []
    case 'ExpressionTag':
    case 'HtmlTag':
    case 'RenderTag':
      return [foundRegion(node.expression)]
    case 'ConstTag':
    case 'DeclarationTag':
      return declarationRegions(node)
    case 'IfBlock':
      return ifRegions(node)
    case 'EachBlock':
      return eachRegions(node)
    case 'AwaitBlock':
      return awaitRegions(node)
    case 'KeyBlock':
      return [foundRegion(node.expression), ...regionsFromFragment(node.fragment)]
    case 'SnippetBlock':
      return regionsFromFragment(node.body)
  }
  return elementRegions(node)
}
const declarationRegions = (node: AST.ConstTag | AST.DeclarationTag): readonly LocatedRegion[] =>
  initRegion(node.declaration.declarations.at(0)?.init)

const initRegion = (init: TemplateExpression | null | undefined): readonly LocatedRegion[] =>
  definedValue(init) ? [foundRegion(init)] : []

const definedValue = <Value>(value: Value | null | undefined): value is Value => value !== undefined && value !== null

const ifRegions = (node: AST.IfBlock): readonly LocatedRegion[] => [
  foundRegion(node.test),
  ...regionsFromFragment(node.consequent),
  ...optionalFragment(node.alternate),
]

const optionalFragment = (fragment: AST.Fragment | null | undefined): readonly LocatedRegion[] =>
  definedValue(fragment) ? regionsFromFragment(fragment) : []

const eachRegions = (node: AST.EachBlock): readonly LocatedRegion[] => [
  foundRegion(node.expression),
  ...optionalRegion(node.key),
  ...regionsFromFragment(node.body),
  ...optionalFragment(node.fallback),
]

const optionalRegion = (expression: TemplateExpression | null | undefined): readonly LocatedRegion[] =>
  definedValue(expression) ? [foundRegion(expression)] : []

const awaitRegions = (node: AST.AwaitBlock): readonly LocatedRegion[] => [
  foundRegion(node.expression),
  ...optionalFragment(node.pending),
  ...optionalFragment(node.then),
  ...optionalFragment(node.catch),
]

const elementRegions = (element: AST.ElementLike): readonly LocatedRegion[] => [
  ...element.attributes.flatMap((attribute) => attributeRegions(attribute)),
  ...regionsFromFragment(element.fragment),
  ...componentExpression(element),
]

const componentExpression = (element: AST.ElementLike): readonly LocatedRegion[] => {
  if (element.type === 'SvelteComponent') {
    return [foundRegion(element.expression)]
  }
  return elementTag(element)
}

const elementTag = (element: AST.ElementLike): readonly LocatedRegion[] =>
  element.type === 'SvelteElement' ? [foundRegion(element.tag)] : []

const attributeRegions = (attribute: AttributeNode): readonly LocatedRegion[] => {
  switch (attribute.type) {
    case 'SpreadAttribute':
    case 'AttachTag':
    case 'BindDirective':
    case 'ClassDirective':
      return [foundRegion(attribute.expression)]
    case 'AnimateDirective':
    case 'OnDirective':
    case 'TransitionDirective':
    case 'UseDirective':
      return nullableExpression(attribute.expression)
    case 'Attribute':
    case 'StyleDirective':
      return valueExpressions(attribute.value)
    case 'LetDirective':
      return []
  }
}

const nullableExpression = (expression: TemplateExpression | null | undefined): readonly LocatedRegion[] =>
  definedValue(expression) ? [foundRegion(expression)] : []
