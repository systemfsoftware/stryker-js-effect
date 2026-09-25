import { dual } from 'effect/Function'
import * as Match from 'effect/Match'

type ScanMode = 'code' | 'template'

type LastTokenKind = 'none' | 'word' | 'char'

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
  word: string
  lastWord: string
  lastKind: LastTokenKind
  lastChar: string
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9_$]/.test(char)

const WORD_CHAR = /[A-Za-z0-9_$]/
const WHITESPACE_CHAR = /\s/
const REGEX_FLAG_CHAR = /[A-Za-z]/

const REGEX_KEYWORDS: Record<string, true> = {
  await: true,
  case: true,
  delete: true,
  do: true,
  else: true,
  in: true,
  instanceof: true,
  new: true,
  of: true,
  return: true,
  throw: true,
  typeof: true,
  void: true,
  yield: true,
}

const REGEX_PRECEDERS: Record<string, true> = {
  '(': true,
  '[': true,
  '{': true,
  ',': true,
  ';': true,
  ':': true,
  '=': true,
  '!': true,
  '?': true,
  '&': true,
  '|': true,
  '^': true,
  '~': true,
  '+': true,
  '-': true,
  '*': true,
  '%': true,
  '<': true,
  '>': true,
}

const finalizeWordOf = (state: ScanState): void => {
  if (state.word === '') return
  state.lastWord = state.word
  state.word = ''
  state.lastKind = 'word'
}

const noteCharOf = (state: ScanState, char: string): void => {
  state.word = ''
  state.lastKind = 'char'
  state.lastChar = char
}

const REGEX_ALLOWED_KINDS: Record<LastTokenKind, (state: ScanState) => boolean> = {
  none: () => true,
  word: (state) => REGEX_KEYWORDS[state.lastWord] === true,
  char: (state) => REGEX_PRECEDERS[state.lastChar] === true,
}

const regexAllowedFor = (state: ScanState): boolean => {
  finalizeWordOf(state)
  return REGEX_ALLOWED_KINDS[state.lastKind](state)
}

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
  noteCharOf(state, state.replacement.slice(-1))
}

const modeOf = (context: ScannerContext | undefined): ScanMode => context === undefined ? 'code' : context.kind

const depthOf = (context: ScannerContext | undefined): number => context === undefined ? 0 : context.braceDepth

const returnToParent = (state: ScanState): void => {
  const parent = state.stack.pop()
  state.mode = modeOf(parent)
  state.depth = depthOf(parent)
}

type CodeCharKind =
  | 'line-comment'
  | 'block-comment'
  | 'regex'
  | 'quote'
  | 'template'
  | 'open-brace'
  | 'close-brace'
  | 'other'

const stepLineComment = (state: ScanState): void => {
  finalizeWordOf(state)
  state.index = copyLineComment(state.code, state.index, state.out)
}

const stepBlockComment = (state: ScanState): void => {
  finalizeWordOf(state)
  state.index = copyBlockComment(state.code, state.index, state.out)
}

const stepQuote = (state: ScanState): void => {
  const quote = state.code.charAt(state.index)
  state.index = copyQuoted(state.code, state.index, state.out)
  noteCharOf(state, quote)
}

const stepTemplateOpen = (state: ScanState): void => {
  state.stack.push({ kind: 'code', braceDepth: state.depth })
  state.mode = 'template'
  noteCharOf(state, '`')
  advanceBy(state, '`')
}

const stepOpenBrace = (state: ScanState): void => {
  state.depth += 1
  noteCharOf(state, '{')
  advanceBy(state, '{')
}

const shouldReturnToParent = (state: ScanState): boolean => state.depth === 0 && state.stack.length > 0

const stepCloseBrace = (state: ScanState): void => {
  if (shouldReturnToParent(state)) {
    returnToParent(state)
  } else {
    state.depth -= 1
  }
  noteCharOf(state, '}')
  advanceBy(state, '}')
}

interface RegexScan {
  readonly index: number
  readonly inClass: boolean
}

const REGEX_CLASS_TOGGLES: Record<string, boolean> = {
  '[': true,
  ']': false,
}

const regexEscapeDelta = (char: string): number => char === '\\' ? 2 : 1

const regexClassToggleOf = (char: string, inClass: boolean): boolean => REGEX_CLASS_TOGGLES[char] ?? inClass

const regexScanStep = (code: string, scan: RegexScan): RegexScan => ({
  index: scan.index + regexEscapeDelta(code.charAt(scan.index)),
  inClass: regexClassToggleOf(code.charAt(scan.index), scan.inClass),
})

const regexScannedTo = (code: string, from: number): RegexScan => {
  let scan: RegexScan = { index: from, inClass: false }
  while (!regexStopsAt(code, scan)) scan = regexScanStep(code, scan)
  return scan
}

const REGEX_STOPPERS: Record<string, true> = {
  '\n': true,
}

const regexClosedAt = (code: string, scan: RegexScan): boolean => !scan.inClass && code.charAt(scan.index) === '/'

const regexStopsAt = (code: string, scan: RegexScan): boolean => regexClosedAt(code, scan) || regexHaltedAt(code, scan)

const regexHaltedAt = (code: string, scan: RegexScan): boolean =>
  scan.index >= code.length || REGEX_STOPPERS[code.charAt(scan.index)] === true

const regexFlagEndOf = (code: string, from: number): number => {
  let scan = from
  while (REGEX_FLAG_CHAR.test(code.charAt(scan))) scan += 1
  return scan
}

const regexEndOf = (code: string, start: number, scan: RegexScan): number =>
  regexClosedAt(code, scan) ? regexFlagEndOf(code, scan.index + 1) : start + 1

const stepRegex = (state: ScanState): void => {
  const scan = regexScannedTo(state.code, state.index + 1)
  noteCharOf(state, '/')
  advanceBy(state, state.code.slice(state.index, regexEndOf(state.code, state.index, scan)))
}

type OtherKind = 'word' | 'space' | 'other'

const otherKindOf = (char: string): OtherKind =>
  Match.value(char).pipe(
    Match.when((value: string) => WORD_CHAR.test(value), (): OtherKind => 'word'),
    Match.when((value: string) => WHITESPACE_CHAR.test(value), (): OtherKind => 'space'),
    Match.orElse((): OtherKind => 'other'),
  )

const OTHER_STEP_HANDLERS: Record<OtherKind, (state: ScanState, char: string) => void> = {
  word: (state, char) => {
    state.word += char
  },
  space: (state) => finalizeWordOf(state),
  other: (state, char) => noteCharOf(state, char),
}

const stepOtherChar = (state: ScanState): void => {
  const char = state.code.charAt(state.index)
  OTHER_STEP_HANDLERS[otherKindOf(char)](state, char)
  advanceBy(state, char)
}

const stepOther = (state: ScanState): void => {
  if (startsTokenAt(state.code, state.token, state.index)) {
    advanceByToken(state)
    return
  }
  stepOtherChar(state)
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

const SLASH_NOT_COMMENT: Record<string, true> = {
  '/': true,
  '*': true,
}

const slashNotCommentAt = (state: ScanState): boolean => SLASH_NOT_COMMENT[state.code.charAt(state.index + 1)] !== true

const regexSlashCandidateAt = (state: ScanState): boolean =>
  state.code.charAt(state.index) === '/' && slashNotCommentAt(state)

const isRegexStartAt = (state: ScanState): boolean => regexSlashCandidateAt(state) && regexAllowedFor(state)

const fallbackKindAt = (state: ScanState): CodeCharKind => {
  const char = state.code.charAt(state.index)
  return CODE_CHAR_KINDS[char] ?? slashKindOf(char, state.code.charAt(state.index + 1))
}

const codeCharKindOf = (state: ScanState): CodeCharKind => isRegexStartAt(state) ? 'regex' : fallbackKindAt(state)

const CODE_STEP_HANDLERS: Record<CodeCharKind, (state: ScanState) => void> = {
  'line-comment': stepLineComment,
  'block-comment': stepBlockComment,
  regex: stepRegex,
  quote: stepQuote,
  template: stepTemplateOpen,
  'open-brace': stepOpenBrace,
  'close-brace': stepCloseBrace,
  other: stepOther,
}

const stepCode = (state: ScanState): void => {
  CODE_STEP_HANDLERS[codeCharKindOf(state)](state)
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
  noteCharOf(state, '`')
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
  noteCharOf(state, '(')
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
      word: '',
      lastWord: '',
      lastKind: 'none',
      lastChar: '',
    }
    while (state.index < code.length) SCAN_STEPS[state.mode](state)
    return { code: state.out.join(''), replaced: state.replaced }
  },
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Schema } = await import('effect')

  const TOKEN = 'import.meta.env'
  const VIEW = 'Object.assign(globalThis.__vitest_worker__?.metaEnv ?? import.meta.env)'
  const MARKER = ['import', 'meta', 'vitest'].join('.')
  const MARKER_VIEW = 'IMPORT_META_TEST()'

  const ASSIGN_OPERATORS = Schema.Literals([
    '=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '**=',
    '<<=',
    '>>=',
    '>>>=',
    '&=',
    '|=',
    '^=',
    '&&=',
    '||=',
    '??=',
  ])
  const BINARY_OPERATORS = Schema.Literals(['==', '===', '!=', '!==', '+', '&&', '||'])
  const ATOMS = Schema.Array(Schema.Literals(['a', 'b', 'c', '1', ' ', '+', '-']))
  const NAMES = Schema.NonEmptyArray(Schema.Literals(['a', 'b', 'c']))
  const QUOTES = Schema.Literals(["'", '"'])
  const COMMENT_KINDS = Schema.Literals(['line', 'block'])
  const REGEX_SITES = Schema.Literals(['declaration', 'argument', 'keyword'])
  const TEMPLATE_SITES = Schema.Literals(['head', 'mid', 'tail'])
  const SUBSTITUTION_NESTINGS = Schema.Literals(['direct', 'nested'])
  const DIVISION_SIDES = Schema.Literals(['before', 'after'])

  const textOf = (atoms: ReadonlyArray<string>): string => atoms.join('')

  type TemplateSite = 'head' | 'mid' | 'tail'
  type SubstitutionNesting = 'direct' | 'nested'
  type CommentKind = 'line' | 'block'
  type RegexSite = 'declaration' | 'argument' | 'keyword'
  type DivisionSide = 'before' | 'after'

  const TEMPLATE_BODIES: Record<TemplateSite, (marker: string) => string> = {
    head: (marker) => `${marker} leads`,
    mid: (marker) => `text ${marker} text`,
    tail: (marker) => `${marker} trails`,
  }

  const SUBSTITUTION_VIEWS: Record<SubstitutionNesting, readonly [string, string]> = {
    direct: [MARKER, MARKER_VIEW],
    nested: [`\`\${${MARKER}}\``, `\`\${${MARKER_VIEW}}\``],
  }

  const COMMENT_BODIES: Record<CommentKind, string> = {
    line: `// keeps ${MARKER} intact\nconst y = 2`,
    block: `/* keeps ${MARKER} intact */\nconst y = 2`,
  }

  const regexBodiesOf = (body: string): Record<RegexSite, string> => ({
    declaration: `const re = ${body}`,
    argument: `const parts = code.split(${body})`,
    keyword: `function f() {\n  return ${body}\n}`,
  })

  const REGEX_BODIES: Record<RegexSite, string> = regexBodiesOf(`/${MARKER}/g`)

  const DIVISION_BODIES: Record<DivisionSide, string> = {
    before: `${MARKER} + total / count`,
    after: `total / count + ${MARKER}`,
  }

  it.prop(
    '∀rhs_AssignmentTarget_=src',
    { of: [ASSIGN_OPERATORS, ATOMS], subject: replaceCodeToken },
    (replace, [operator, atoms]) => {
      const source = `${TOKEN} ${operator} ${textOf(atoms)}`
      const result = replace(source, TOKEN, VIEW)
      return result.code === source && result.replaced === false
    },
  )

  it.prop(
    '∀rhs_TokenReference_=Model',
    { of: [BINARY_OPERATORS, ATOMS], subject: replaceCodeToken },
    (replace, [operator, atoms]) => {
      const source = `${TOKEN} ${operator} ${textOf(atoms)}`
      const result = replace(source, TOKEN, VIEW)
      return result.code === `${VIEW} ${operator} ${textOf(atoms)}` && result.replaced === true
    },
  )

  it.prop(
    '∀rhs_MemberAssignment_=Model',
    { of: [ASSIGN_OPERATORS, ATOMS], subject: replaceCodeToken },
    (replace, [operator, atoms]) => {
      const source = `${TOKEN}.X ${operator} ${textOf(atoms)}`
      const result = replace(source, TOKEN, VIEW)
      return result.code === `${VIEW}.X ${operator} ${textOf(atoms)}` && result.replaced === true
    },
  )

  it.prop(
    '∀name_MemberRead_=Model',
    { of: [NAMES], subject: replaceCodeToken },
    (replace, [name]) => {
      const source = `const x = ${TOKEN}.${textOf(name)}`
      const result = replace(source, TOKEN, VIEW)
      return result.code === `const x = ${VIEW}.${textOf(name)}` && result.replaced === true
    },
  )

  it.prop(
    '∀quote_MarkerInsideStringLiteral_=src',
    { of: [QUOTES], subject: replaceCodeToken },
    (replace, [quote]) => {
      const source = `const s = ${quote}keeps ${MARKER} intact${quote}`
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === source && result.replaced === false
    },
  )

  it.prop(
    '∀quote_MarkerInsideEscapedStringLiteral_=src',
    { of: [QUOTES], subject: replaceCodeToken },
    (replace, [quote]) => {
      const escapedQuote = `\\${quote}`
      const source = `const s = ${quote}say ${escapedQuote}keeps${escapedQuote} ${MARKER} intact${quote}`
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === source && result.replaced === false
    },
  )

  it.prop(
    '∀site_MarkerInsideTemplateText_=src',
    { of: [TEMPLATE_SITES], subject: replaceCodeToken },
    (replace, [site]) => {
      const source = `const t = \`${TEMPLATE_BODIES[site](MARKER)}\``
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === source && result.replaced === false
    },
  )

  it.prop(
    '∀nesting_MarkerInsideTemplateSubstitution_=Model',
    { of: [SUBSTITUTION_NESTINGS], subject: replaceCodeToken },
    (replace, [nesting]) => {
      const [expression, rewritten] = SUBSTITUTION_VIEWS[nesting]
      const source = `const t = \`\${${expression}}\``
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === `const t = \`\${${rewritten}}\`` && result.replaced === true
    },
  )

  it.prop(
    '∀kind_MarkerInsideComment_=src',
    { of: [COMMENT_KINDS], subject: replaceCodeToken },
    (replace, [kind]) => {
      const source = `const x = 1\n${COMMENT_BODIES[kind]}`
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === source && result.replaced === false
    },
  )

  it.prop(
    '∀site_MarkerInsideRegexLiteral_=src',
    { of: [REGEX_SITES], subject: replaceCodeToken },
    (replace, [site]) => {
      const source = REGEX_BODIES[site]
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === source && result.replaced === false
    },
  )

  it.prop(
    '∀side_MarkerNearDivision_=Model',
    { of: [DIVISION_SIDES], subject: replaceCodeToken },
    (replace, [side]) => {
      const source = DIVISION_BODIES[side]
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === source.split(MARKER).join(MARKER_VIEW) && result.replaced === true
    },
  )

  it.prop(
    '∀name_MarkerAsPlainPropertyChain_=src',
    { of: [NAMES], subject: replaceCodeToken },
    (replace, [name]) => {
      const source = `const v = ${textOf(name)}.${MARKER}`
      const result = replace(source, MARKER, MARKER_VIEW)
      return result.code === source && result.replaced === false
    },
  )
}
