import { dual } from 'effect/Function'

type ScanMode = 'code' | 'template'

interface ScannerContext {
  readonly kind: ScanMode
  readonly braceDepth: number
}

interface ScanState {
  readonly code: string
  readonly token: string
  readonly replacement: string
  readonly out: Array<string>
  readonly stack: Array<ScannerContext>
  mode: ScanMode
  depth: number
  index: number
  replaced: boolean
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9_$]/.test(char)

const ASSIGNMENT_OPERATOR = /\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/y

const isAssignmentTargetEndingAt = (code: string, end: number): boolean => {
  ASSIGNMENT_OPERATOR.lastIndex = end
  return ASSIGNMENT_OPERATOR.test(code)
}

const IDENTIFIER_BOUNDARY = /[A-Za-z0-9_$.?]/

const isIdentifierBoundary = (char: string | undefined): boolean => char !== undefined && IDENTIFIER_BOUNDARY.test(char)

const previousCharOf = (code: string, index: number): string | undefined =>
  index === 0 ? undefined : code.charAt(index - 1)

const nextEndsToken = (code: string, token: string, index: number): boolean => {
  const end = index + token.length
  return !isWordChar(code.charAt(end)) && !isAssignmentTargetEndingAt(code, end)
}

const tokenAtBoundary = (code: string, token: string, index: number): boolean =>
  code.startsWith(token, index) && !isIdentifierBoundary(previousCharOf(code, index))

const startsTokenAt = (code: string, token: string, index: number): boolean =>
  tokenAtBoundary(code, token, index) && nextEndsToken(code, token, index)

const NOT_FOUND = -1

const lineEndIndex = (code: string, from: number): number => {
  const found = code.indexOf('\n', from)
  return found === NOT_FOUND ? code.length : found
}

const copyLineComment = (code: string, from: number, out: Array<string>): number => {
  const end = lineEndIndex(code, from)
  out.push(code.slice(from, end))
  return end
}

const copyBlockComment = (code: string, from: number, out: Array<string>): number => {
  const found = code.indexOf('*/', from)
  const stop = found === NOT_FOUND ? code.length : found
  out.push(code.slice(from, stop))
  out.push('*', '/')
  return stop + 2
}

const QUOTED_SINGLE = /'(?:\\[\s\S]|[^'\\])*'/y
const QUOTED_DOUBLE = /"(?:\\[\s\S]|[^"\\])*"/y

const quotedPatternFor = (quote: string): RegExp => quote === "'" ? QUOTED_SINGLE : QUOTED_DOUBLE

const copyQuoted = (code: string, from: number, out: Array<string>): number => {
  const pattern = quotedPatternFor(code.charAt(from))
  pattern.lastIndex = from
  const match = pattern.exec(code)
  if (match === null) {
    out.push(code.slice(from))
    return code.length
  }
  const end = pattern.lastIndex
  out.push(code.slice(from, end))
  return end
}

const advanceBy = (state: ScanState, text: string): void => {
  state.out.push(text)
  state.index += text.length
}

const advanceByToken = (state: ScanState): void => {
  state.out.push(state.replacement)
  state.index += state.token.length
  state.replaced = true
}

const modeOf = (context: ScannerContext | undefined): ScanMode => context === undefined ? 'code' : context.kind

const depthOf = (context: ScannerContext | undefined): number => context === undefined ? 0 : context.braceDepth

const returnToParent = (state: ScanState): void => {
  const parent = state.stack.pop()
  state.mode = modeOf(parent)
  state.depth = depthOf(parent)
}

type CodeCharKind = 'line-comment' | 'block-comment' | 'quote' | 'template' | 'open-brace' | 'close-brace' | 'other'

const stepLineComment = (state: ScanState): void => {
  state.index = copyLineComment(state.code, state.index, state.out)
}

const stepBlockComment = (state: ScanState): void => {
  state.index = copyBlockComment(state.code, state.index, state.out)
}

const stepQuote = (state: ScanState): void => {
  state.index = copyQuoted(state.code, state.index, state.out)
}

const stepTemplateOpen = (state: ScanState): void => {
  state.stack.push({ kind: 'code', braceDepth: state.depth })
  state.mode = 'template'
  advanceBy(state, '`')
}

const stepOpenBrace = (state: ScanState): void => {
  state.depth += 1
  advanceBy(state, '{')
}

const shouldReturnToParent = (state: ScanState): boolean => state.depth === 0 && state.stack.length > 0

const stepCloseBrace = (state: ScanState): void => {
  if (shouldReturnToParent(state)) {
    returnToParent(state)
  } else {
    state.depth -= 1
  }
  advanceBy(state, '}')
}

const stepOther = (state: ScanState): void => {
  if (startsTokenAt(state.code, state.token, state.index)) {
    advanceByToken(state)
  } else {
    advanceBy(state, state.code.charAt(state.index))
  }
}

const CODE_CHAR_KINDS: Record<string, CodeCharKind> = {
  "'": 'quote',
  '"': 'quote',
  '`': 'template',
  '{': 'open-brace',
  '}': 'close-brace',
}

const SLASH_KINDS: Record<string, CodeCharKind> = {
  '/': 'line-comment',
  '*': 'block-comment',
}

const commentKindOf = (next: string): CodeCharKind => SLASH_KINDS[next] ?? 'other'

const slashKindOf = (char: string, next: string): CodeCharKind => char === '/' ? commentKindOf(next) : 'other'

const codeCharKindOf = (char: string, next: string): CodeCharKind => CODE_CHAR_KINDS[char] ?? slashKindOf(char, next)

const CODE_STEP_HANDLERS: Record<CodeCharKind, (state: ScanState) => void> = {
  'line-comment': stepLineComment,
  'block-comment': stepBlockComment,
  quote: stepQuote,
  template: stepTemplateOpen,
  'open-brace': stepOpenBrace,
  'close-brace': stepCloseBrace,
  other: stepOther,
}

const stepCode = (state: ScanState): void => {
  CODE_STEP_HANDLERS[codeCharKindOf(state.code.charAt(state.index), state.code.charAt(state.index + 1))](state)
}

type TemplateCharKind = 'close-template' | 'escape' | 'dollar' | 'other'

const TEMPLATE_CHAR_KINDS: Record<string, TemplateCharKind> = {
  '`': 'close-template',
  '\\': 'escape',
  '$': 'dollar',
}

const templateCharKindOf = (char: string): TemplateCharKind => TEMPLATE_CHAR_KINDS[char] ?? 'other'

const stepTemplateClose = (state: ScanState): void => {
  returnToParent(state)
  advanceBy(state, '`')
}

const stepTemplateEscape = (state: ScanState): void => {
  const escaped = state.code.charAt(state.index + 1)
  advanceBy(state, '\\')
  if (escaped !== '') advanceBy(state, escaped)
}

const stepInterpolation = (state: ScanState): void => {
  state.stack.push({ kind: 'template', braceDepth: 0 })
  state.mode = 'code'
  state.depth = 0
  advanceBy(state, '${')
}

const stepDollar = (state: ScanState): void => {
  if (state.code.charAt(state.index + 1) === '{') {
    stepInterpolation(state)
  } else {
    advanceBy(state, '$')
  }
}

const stepTemplateOther = (state: ScanState): void => {
  advanceBy(state, state.code.charAt(state.index))
}

const TEMPLATE_STEP_HANDLERS: Record<TemplateCharKind, (state: ScanState) => void> = {
  'close-template': stepTemplateClose,
  escape: stepTemplateEscape,
  dollar: stepDollar,
  other: stepTemplateOther,
}

const stepTemplate = (state: ScanState): void => {
  TEMPLATE_STEP_HANDLERS[templateCharKindOf(state.code.charAt(state.index))](state)
}

const SCAN_STEPS: Record<ScanMode, (state: ScanState) => void> = { code: stepCode, template: stepTemplate }

export const replaceCodeToken: {
  (code: string, token: string, replacement: string): { readonly code: string; readonly replaced: boolean }
  (token: string, replacement: string): (code: string) => { readonly code: string; readonly replaced: boolean }
} = dual(
  3,
  (code: string, token: string, replacement: string): { readonly code: string; readonly replaced: boolean } => {
    const state: ScanState = {
      code,
      token,
      replacement,
      out: [],
      stack: [],
      mode: 'code',
      depth: 0,
      index: 0,
      replaced: false,
    }
    while (state.index < code.length) SCAN_STEPS[state.mode](state)
    return { code: state.out.join(''), replaced: state.replaced }
  },
)
