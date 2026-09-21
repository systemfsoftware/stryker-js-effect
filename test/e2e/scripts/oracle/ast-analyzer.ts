import { Node, Project, SyntaxKind } from 'ts-morph'
import type { DirectiveRule, IndependentInventory, IndependentMutant } from './types.js'

export const DIRECTIVE_REGEX = /^\s*\/\/\s*Stryker\s+(disable|restore)(?:\s+(next-line))?(?:\s+([a-zA-Z0-9_, ]+))?/

function parseDirectives(sourceText: string): readonly DirectiveRule[] {
  const lines = sourceText.split('\n')
  const rules: DirectiveRule[] = []

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1
    const match = DIRECTIVE_REGEX.exec(lineText)
    if (!match) return

    const type = match[1] === 'restore' ? 'restore' : 'disable'
    const scope = match[2] === 'next-line' ? 'next-line' : undefined
    const rawTargets = match[3]?.trim()
    const targetMutators = rawTargets && rawTargets.toLowerCase() !== 'all'
      ? rawTargets.split(',').map((s) => s.trim().toLowerCase())
      : ['all']

    rules.push({
      type,
      scope,
      targetMutators,
      line: lineNum,
    })
  })

  return rules
}

function isMutantIgnored(
  mutatorName: string,
  line: number,
  directives: readonly DirectiveRule[],
  excludedMutations: readonly string[],
): boolean {
  if (excludedMutations.some((m) => m.toLowerCase() === mutatorName.toLowerCase())) {
    return true
  }

  const nameLower = mutatorName.toLowerCase()

  for (let i = directives.length - 1; i >= 0; i--) {
    const rule = directives[i]!
    const matchesTarget = rule.targetMutators.includes('all') || rule.targetMutators.includes(nameLower)
    if (!matchesTarget) continue

    if (rule.scope === 'next-line') {
      if (rule.line + 1 === line) {
        return rule.type === 'disable'
      }
    } else {
      if (line >= rule.line) {
        return rule.type === 'disable'
      }
    }
  }

  return false
}

const METHOD_NULL_MAP: Readonly<Record<string, true>> = Object.freeze({
  charAt: true,
  filter: true,
  reverse: true,
  slice: true,
  sort: true,
  substr: true,
  substring: true,
  trim: true,
})

const BOOLEAN_OPERATOR_SYNTAX_KINDS: Readonly<Record<number, string>> = Object.freeze({
  [SyntaxKind.ExclamationEqualsToken]: '!=',
  [SyntaxKind.ExclamationEqualsEqualsToken]: '!==',
  [SyntaxKind.AmpersandAmpersandToken]: '&&',
  [SyntaxKind.LessThanToken]: '<',
  [SyntaxKind.LessThanEqualsToken]: '<=',
  [SyntaxKind.EqualsEqualsToken]: '==',
  [SyntaxKind.EqualsEqualsEqualsToken]: '===',
  [SyntaxKind.GreaterThanToken]: '>',
  [SyntaxKind.GreaterThanEqualsToken]: '>=',
  [SyntaxKind.BarBarToken]: '||',
})

const METHOD_INVERTED_MAP: Readonly<Record<string, string>> = Object.freeze({
  endsWith: 'startsWith',
  startsWith: 'endsWith',
  every: 'some',
  some: 'every',
  toLocaleLowerCase: 'toLocaleUpperCase',
  toLocaleUpperCase: 'toLocaleLowerCase',
  toLowerCase: 'toUpperCase',
  toUpperCase: 'toLowerCase',
  trimEnd: 'trimStart',
  trimStart: 'trimEnd',
  min: 'max',
  max: 'min',
  setDate: 'setTime',
  setTime: 'setDate',
  setFullYear: 'setMonth',
  setMonth: 'setFullYear',
  setHours: 'setMinutes',
  setMinutes: 'setHours',
  setSeconds: 'setMilliseconds',
  setMilliseconds: 'setSeconds',
  setUTCDate: 'setTime',
  setUTCFullYear: 'setUTCMonth',
  setUTCMonth: 'setUTCFullYear',
  setUTCHours: 'setUTCMinutes',
  setUTCMinutes: 'setUTCHours',
  setUTCSeconds: 'setUTCMilliseconds',
  setUTCMilliseconds: 'setUTCSeconds',
})

/** All regexpp quantifiers are stripped, lazy forms included (`mutator-contract.md` § Regex; `Mutator.ts` collectQuantifier). */
const QUANTIFIER_REGEX = /(?:\?|\*|\+|\{\d+(?:,\d*)?\})\??/y

interface RegexMutation {
  readonly start: number
  readonly end: number
  readonly replacement: string
  readonly priority: number
}

function isRegexPatternCharEscaped(pattern: string, index: number): boolean {
  let backslashes = 0
  let cursor = index - 1
  while (cursor >= 0 && pattern[cursor] === '\\') {
    backslashes++
    cursor--
  }
  return backslashes % 2 === 1
}

function characterClassEnd(pattern: string, start: number): number {
  let cursor = start + 1
  if (pattern[cursor] === '^') cursor++
  if (pattern[cursor] === ']') cursor++
  while (cursor < pattern.length && pattern[cursor] !== ']') {
    if (pattern[cursor] === '\\' && !isRegexPatternCharEscaped(pattern, cursor)) {
      cursor += 2
      continue
    }
    cursor++
  }
  return cursor < pattern.length ? cursor + 1 : -1
}

function negateCharacterClass(pattern: string, start: number, end: number): string | undefined {
  const body = pattern.slice(start + 1, end - 1)
  if (body.startsWith('^')) {
    return pattern.slice(0, start) + `[${body.slice(1)}]` + pattern.slice(end)
  }
  return pattern.slice(0, start) + `[^${body}]` + pattern.slice(end)
}

function negatePredefinedClass(token: string): string | undefined {
  switch (token) {
    case '\\d':
      return '\\D'
    case '\\D':
      return '\\d'
    case '\\w':
      return '\\W'
    case '\\W':
      return '\\w'
    case '\\s':
      return '\\S'
    case '\\S':
      return '\\s'
    case '\\p':
      return '\\P'
    case '\\P':
      return '\\p'
    default:
      return undefined
  }
}

function negateLookaround(pattern: string, start: number): string | undefined {
  const head = pattern.slice(start, start + 3)
  switch (head) {
    case '(?=':
      return pattern.slice(0, start) + '(?!' + pattern.slice(start + 3)
    case '(?!':
      return pattern.slice(0, start) + '(?=' + pattern.slice(start + 3)
    case '(?<':
      if (pattern[start + 3] === '=') {
        return pattern.slice(0, start) + '(?<!' + pattern.slice(start + 4)
      }
      if (pattern[start + 3] === '!') {
        return pattern.slice(0, start) + '(?<=' + pattern.slice(start + 4)
      }
      return undefined
    default:
      return undefined
  }
}

/**
 * Mirrors the instrumenter's regex mutation order (`mutator-contract.md` § Regex):
 * anchors first, then remaining mutations by pattern position with quantifier removal
 * (priority 0) ahead of lookaround/class negation (priority 1) and predefined-class
 * negation (priority 2). Alternations, groupings, empty, and unparseable patterns
 * yield nothing beyond the mutations the scanner can prove.
 */
function mutateRegexPattern(pattern: string): readonly RegexMutation[] {
  if (pattern === '') return []
  const mutations: RegexMutation[] = []

  const bol = pattern.indexOf('^')
  if (bol === 0 && pattern.length > 1) {
    mutations.push({ start: 0, end: 1, replacement: pattern.slice(1), priority: 0 })
  }
  const eol = pattern.lastIndexOf('$')
  if (eol === pattern.length - 1 && eol > 0 && !isRegexPatternCharEscaped(pattern, eol)) {
    const stripped = pattern.slice(0, eol)
    if (stripped !== '') {
      mutations.push({ start: eol, end: eol + 1, replacement: stripped, priority: 0 })
    }
  }

  let cursor = 0
  while (cursor < pattern.length) {
    const char = pattern[cursor]!

    if (char === '\\') {
      const token = pattern.slice(cursor, cursor + 2)
      const negated = negatePredefinedClass(token)
      if (negated !== undefined && token !== '\\p' && token !== '\\P') {
        mutations.push({
          start: cursor,
          end: cursor + 2,
          replacement: pattern.slice(0, cursor) + negated + pattern.slice(cursor + 2),
          priority: 2,
        })
      }
      cursor += 2
      continue
    }

    if (char === '[') {
      const end = characterClassEnd(pattern, cursor)
      if (end === -1) return []
      const negated = negateCharacterClass(pattern, cursor, end)
      if (negated !== undefined) {
        mutations.push({ start: cursor, end, replacement: negated, priority: 1 })
      }
      cursor = end
      continue
    }

    if (char === '(' && pattern[cursor + 1] === '?') {
      const negated = negateLookaround(pattern, cursor)
      if (negated !== undefined) {
        mutations.push({ start: cursor, end: cursor + 3, replacement: negated, priority: 1 })
      }
      cursor += pattern[cursor + 2] === '<' ? 4 : 3
      continue
    }

    if (char === '+' || char === '*' || char === '?') {
      let end = cursor + 1
      if (pattern[end] === '?' && (char === '+' || char === '*' || (char === '?' && cursor > 0))) {
        end++
      }
      const stripped = pattern.slice(0, cursor) + pattern.slice(end)
      if (stripped !== '') {
        mutations.push({ start: cursor, end, replacement: stripped, priority: 0 })
      }
      cursor = end
      continue
    }

    if (char === '{') {
      QUANTIFIER_REGEX.lastIndex = cursor
      const match = QUANTIFIER_REGEX.exec(pattern)
      if (match) {
        const end = QUANTIFIER_REGEX.lastIndex
        const stripped = pattern.slice(0, cursor) + pattern.slice(end)
        if (stripped !== '') {
          mutations.push({ start: cursor, end, replacement: stripped, priority: 0 })
        }
        cursor = end
        continue
      }
    }

    cursor++
  }

  return mutations
}

interface RegexTarget {
  readonly fullStart: number
  readonly fullEnd: number
  readonly pattern: string
  readonly flags: string
  readonly wrap: (mutatedPattern: string) => string
}

function regexTargetsForNode(node: Node): readonly RegexTarget[] {
  if (node.isKind(SyntaxKind.RegularExpressionLiteral)) {
    const text = node.getText()
    const lastSlash = text.lastIndexOf('/')
    if (lastSlash <= 0) return []
    const pattern = text.slice(1, lastSlash)
    const flags = text.slice(lastSlash + 1)
    return [{
      fullStart: node.getStart(),
      fullEnd: node.getEnd(),
      pattern,
      flags,
      wrap: (mutated) => `/${mutated}/${flags}`,
    }]
  }
  if (
    Node.isNewExpression(node) && Node.isIdentifier(node.getExpression()) && node.getExpression().getText() === 'RegExp'
  ) {
    const args = node.getArguments()
    const first = args[0]
    if (args.length >= 1 && first !== undefined && Node.isStringLiteral(first)) {
      const pattern = first.getLiteralValue()
      return [{
        fullStart: first.getStart(),
        fullEnd: first.getEnd(),
        pattern,
        flags: '',
        wrap: (mutated) => JSON.stringify(mutated),
      }]
    }
  }
  return []
}

function isTestOfConditionOrLoop(node: Node): boolean {
  const parent = node.getParent()
  if (parent === undefined) return false
  if (Node.isIfStatement(parent)) return parent.getExpression() === node
  if (Node.isWhileStatement(parent) || Node.isDoStatement(parent)) return parent.getExpression() === node
  if (Node.isForStatement(parent)) return parent.getCondition() === node
  return false
}

function collectMemberName(
  node: Node,
): { readonly objectText: string; readonly name: string; readonly optional: boolean } | undefined {
  if (Node.isPropertyAccessExpression(node)) {
    if (!Node.isIdentifier(node.getNameNode())) return undefined
    return {
      objectText: node.getExpression().getText(),
      name: node.getName(),
      optional: node.hasQuestionDotToken(),
    }
  }
  if (Node.isElementAccessExpression(node)) {
    const argument = node.getArgumentExpression()
    if (argument === undefined || !Node.isIdentifier(argument)) return undefined
    return {
      objectText: node.getExpression().getText(),
      name: argument.getText(),
      optional: node.hasQuestionDotToken(),
    }
  }
  return undefined
}

export function analyzeFileWithTsMorph(
  sourceText: string,
  excludedMutations: readonly string[] = [],
): IndependentInventory {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile('target.ts', sourceText)
  const directives = parseDirectives(sourceText)

  const rawMutants: Array<{
    line: number
    mutatorName: string
    replacement: string
    start: number
    end: number
  }> = []

  sourceFile.forEachDescendant((node) => {
    const line = node.getStartLineNumber()

    if (Node.isBlock(node) && node.getStatements().length > 0) {
      rawMutants.push({
        line,
        mutatorName: 'BlockStatement',
        replacement: '{}',
        start: node.getStart(),
        end: node.getEnd(),
      })
    }
    if (Node.isConditionalExpression(node)) {
      rawMutants.push({
        line,
        mutatorName: 'ConditionalExpression',
        replacement: 'true',
        start: node.getStart(),
        end: node.getEnd(),
      })
      rawMutants.push({
        line,
        mutatorName: 'ConditionalExpression',
        replacement: 'false',
        start: node.getStart(),
        end: node.getEnd(),
      })
    }
    if (Node.isBinaryExpression(node)) {
      const opTokenNode = node.getOperatorToken()
      const opToken = opTokenNode.getKind()
      const tokenStart = opTokenNode.getStart()
      const tokenEnd = opTokenNode.getEnd()

      const pushBinary = (mutatorName: string, replacement: string) => {
        rawMutants.push({
          line,
          mutatorName,
          replacement,
          start: tokenStart,
          end: tokenEnd,
        })
      }

      switch (opToken) {
        case SyntaxKind.EqualsEqualsEqualsToken:
          pushBinary('EqualityOperator', '!==')
          break
        case SyntaxKind.ExclamationEqualsEqualsToken:
          pushBinary('EqualityOperator', '===')
          break
        case SyntaxKind.EqualsEqualsToken:
          pushBinary('EqualityOperator', '!=')
          break
        case SyntaxKind.ExclamationEqualsToken:
          pushBinary('EqualityOperator', '==')
          break
        case SyntaxKind.GreaterThanToken:
          pushBinary('EqualityOperator', '<=')
          pushBinary('EqualityOperator', '>=')
          break
        case SyntaxKind.LessThanToken:
          pushBinary('EqualityOperator', '>=')
          pushBinary('EqualityOperator', '<=')
          break
        case SyntaxKind.GreaterThanEqualsToken:
          pushBinary('EqualityOperator', '<')
          pushBinary('EqualityOperator', '>')
          break
        case SyntaxKind.LessThanEqualsToken:
          pushBinary('EqualityOperator', '>')
          pushBinary('EqualityOperator', '<')
          break

        case SyntaxKind.BarBarToken:
          pushBinary('LogicalOperator', '&&')
          break
        case SyntaxKind.AmpersandAmpersandToken:
          pushBinary('LogicalOperator', '||')
          break
        case SyntaxKind.QuestionQuestionToken:
          pushBinary('LogicalOperator', '&&')
          break
        case SyntaxKind.PlusToken:
        case SyntaxKind.MinusToken:
        case SyntaxKind.AsteriskToken:
        case SyntaxKind.SlashToken:
        case SyntaxKind.PercentToken: {
          const left = node.getLeft()
          const right = node.getRight()
          const isStringInvolved = Node.isStringLiteral(left) ||
            Node.isTemplateExpression(left) ||
            Node.isNoSubstitutionTemplateLiteral(left) ||
            Node.isStringLiteral(right) ||
            Node.isTemplateExpression(right) ||
            Node.isNoSubstitutionTemplateLiteral(right)

          if (!isStringInvolved) {
            const rep = opToken === SyntaxKind.PlusToken
              ? '-'
              : opToken === SyntaxKind.MinusToken
              ? '+'
              : opToken === SyntaxKind.AsteriskToken
              ? '/'
              : '*'
            rawMutants.push({
              line,
              mutatorName: 'ArithmeticOperator',
              replacement: rep,
              start: tokenStart,
              end: tokenEnd,
            })
          }
          break
        }

        case SyntaxKind.PlusEqualsToken:
        case SyntaxKind.MinusEqualsToken:
        case SyntaxKind.AsteriskEqualsToken:
        case SyntaxKind.SlashEqualsToken: {
          const right = node.getRight()
          const isStringRhs = Node.isStringLiteral(right) ||
            Node.isTemplateExpression(right) ||
            Node.isNoSubstitutionTemplateLiteral(right)
          if (!isStringRhs) {
            const rep = opToken === SyntaxKind.PlusEqualsToken
              ? '-='
              : opToken === SyntaxKind.MinusEqualsToken
              ? '+='
              : opToken === SyntaxKind.AsteriskEqualsToken
              ? '/='
              : '*='
            rawMutants.push({
              line,
              mutatorName: 'AssignmentOperator',
              replacement: rep,
              start: tokenStart,
              end: tokenEnd,
            })
          }
          break
        }
        case SyntaxKind.BarBarEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '&&=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
        case SyntaxKind.AmpersandAmpersandEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '||=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
        case SyntaxKind.QuestionQuestionEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '&&=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
        case SyntaxKind.PercentEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '*=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
        case SyntaxKind.LessThanLessThanEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '>>=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
        case SyntaxKind.GreaterThanGreaterThanEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '<<=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
        case SyntaxKind.AmpersandEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '|=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
        case SyntaxKind.BarEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '&=',
            start: tokenStart,
            end: tokenEnd,
          })
          break
      }

      const booleanOpToken = BOOLEAN_OPERATOR_SYNTAX_KINDS[opToken]
      if (booleanOpToken !== undefined && !isTestOfConditionOrLoop(node)) {
        const parent = node.getParent()
        if (Node.isBinaryExpression(parent)) {
          const parentToken = parent.getOperatorToken().getKind()
          if (parentToken === SyntaxKind.AmpersandAmpersandToken) {
            pushBinary('ConditionalExpression', 'true')
          } else if (parentToken === SyntaxKind.BarBarToken) {
            pushBinary('ConditionalExpression', 'false')
          } else {
            pushBinary('ConditionalExpression', 'true')
            pushBinary('ConditionalExpression', 'false')
          }
        } else {
          pushBinary('ConditionalExpression', 'true')
          pushBinary('ConditionalExpression', 'false')
        }
      }
    }
    const kind = node.getKind()
    if (kind === SyntaxKind.TrueKeyword) {
      rawMutants.push({
        line,
        mutatorName: 'BooleanLiteral',
        replacement: 'false',
        start: node.getStart(),
        end: node.getEnd(),
      })
    } else if (kind === SyntaxKind.FalseKeyword) {
      rawMutants.push({
        line,
        mutatorName: 'BooleanLiteral',
        replacement: 'true',
        start: node.getStart(),
        end: node.getEnd(),
      })
    }

    if (Node.isIfStatement(node)) {
      const test = node.getExpression()
      rawMutants.push({
        line: test.getStartLineNumber(),
        mutatorName: 'ConditionalExpression',
        replacement: 'true',
        start: test.getStart(),
        end: test.getEnd(),
      })
      rawMutants.push({
        line: test.getStartLineNumber(),
        mutatorName: 'ConditionalExpression',
        replacement: 'false',
        start: test.getStart(),
        end: test.getEnd(),
      })
    } else if (Node.isWhileStatement(node) || Node.isDoStatement(node)) {
      const test = node.getExpression()
      rawMutants.push({
        line: test.getStartLineNumber(),
        mutatorName: 'ConditionalExpression',
        replacement: 'false',
        start: test.getStart(),
        end: test.getEnd(),
      })
    } else if (Node.isForStatement(node)) {
      const test = node.getCondition()
      if (test !== undefined) {
        rawMutants.push({
          line: test.getStartLineNumber(),
          mutatorName: 'ConditionalExpression',
          replacement: 'false',
          start: test.getStart(),
          end: test.getEnd(),
        })
      }
    }

    if (Node.isStringLiteral(node)) {
      const isBlank = node.getLiteralValue() === ''
      rawMutants.push({
        line,
        mutatorName: 'StringLiteral',
        replacement: isBlank ? '"Stryker was here!"' : '""',
        start: node.getStart(),
        end: node.getEnd(),
      })
    }

    if (Node.isArrowFunction(node)) {
      rawMutants.push({
        line,
        mutatorName: 'ArrowFunction',
        replacement: '() => undefined',
        start: node.getStart(),
        end: node.getEnd(),
      })
    }

    if (Node.isArrayLiteralExpression(node) && node.getElements().length > 0) {
      rawMutants.push({
        line,
        mutatorName: 'ArrayDeclaration',
        replacement: '[]',
        start: node.getStart(),
        end: node.getEnd(),
      })
    }

    if (Node.isObjectLiteralExpression(node) && node.getProperties().length > 0) {
      rawMutants.push({
        line,
        mutatorName: 'ObjectLiteral',
        replacement: '{}',
        start: node.getStart(),
        end: node.getEnd(),
      })
    }

    if (Node.isPropertyAccessExpression(node) && node.hasQuestionDotToken()) {
      const qd = node.getChildren().find((c) => c.getKind() === SyntaxKind.QuestionDotToken)
      if (qd) {
        rawMutants.push({
          line,
          mutatorName: 'OptionalChaining',
          replacement: '.',
          start: qd.getStart(),
          end: qd.getEnd(),
        })
      }
    } else if (Node.isElementAccessExpression(node) && node.hasQuestionDotToken()) {
      const qd = node.getChildren().find((c) => c.getKind() === SyntaxKind.QuestionDotToken)
      if (qd) {
        rawMutants.push({
          line,
          mutatorName: 'OptionalChaining',
          replacement: '[',
          start: qd.getStart(),
          end: qd.getEnd(),
        })
      }
    } else if (Node.isCallExpression(node) && node.hasQuestionDotToken()) {
      const qd = node.getChildren().find((c) => c.getKind() === SyntaxKind.QuestionDotToken)
      if (qd) {
        rawMutants.push({
          line,
          mutatorName: 'OptionalChaining',
          replacement: '(',
          start: qd.getStart(),
          end: qd.getEnd(),
        })
      }
    }

    if (Node.isPrefixUnaryExpression(node)) {
      const opToken = node.getOperatorToken()
      const start = node.getStart()
      const end = node.getEnd()
      if (opToken === SyntaxKind.PlusPlusToken) {
        rawMutants.push({ line, mutatorName: 'UpdateOperator', replacement: '--', start, end })
      } else if (opToken === SyntaxKind.MinusMinusToken) {
        rawMutants.push({ line, mutatorName: 'UpdateOperator', replacement: '++', start, end })
      } else if (opToken === SyntaxKind.PlusToken) {
        rawMutants.push({
          line,
          mutatorName: 'UnaryOperator',
          replacement: `-${node.getOperand().getText()}`,
          start,
          end,
        })
      } else if (opToken === SyntaxKind.MinusToken) {
        rawMutants.push({
          line,
          mutatorName: 'UnaryOperator',
          replacement: `+${node.getOperand().getText()}`,
          start,
          end,
        })
      } else if (opToken === SyntaxKind.TildeToken) {
        rawMutants.push({
          line,
          mutatorName: 'UnaryOperator',
          replacement: node.getOperand().getText(),
          start,
          end,
        })
      } else if (opToken === SyntaxKind.ExclamationToken) {
        rawMutants.push({
          line,
          mutatorName: 'BooleanLiteral',
          replacement: node.getOperand().getText(),
          start,
          end,
        })
      }
    } else if (Node.isPostfixUnaryExpression(node)) {
      const opToken = node.getOperatorToken()
      const start = node.getStart()
      const end = node.getEnd()
      if (opToken === SyntaxKind.PlusPlusToken) {
        rawMutants.push({ line, mutatorName: 'UpdateOperator', replacement: '--', start, end })
      } else if (opToken === SyntaxKind.MinusMinusToken) {
        rawMutants.push({ line, mutatorName: 'UpdateOperator', replacement: '++', start, end })
      }
    }

    if (Node.isCallExpression(node) && !node.hasQuestionDotToken()) {
      const callee = node.getExpression()
      if (!Node.isSuperExpression(callee)) {
        const member = collectMemberName(callee)
        if (member !== undefined && METHOD_NULL_MAP[member.name] === true) {
          rawMutants.push({
            line,
            mutatorName: 'MethodExpression',
            replacement: `${member.objectText}()`,
            start: node.getStart(),
            end: node.getEnd(),
          })
        } else if (member !== undefined) {
          const inverted = METHOD_INVERTED_MAP[member.name]
          if (inverted !== undefined) {
            const args = node.getArguments().map((a) => a.getText()).join(', ')
            const callHead = `${member.objectText}${member.optional ? '?.' : '.'}${inverted}`
            rawMutants.push({
              line,
              mutatorName: 'MethodExpression',
              replacement: `${callHead}(${args})`,
              start: node.getStart(),
              end: node.getEnd(),
            })
          }
        }
      }
    }

    for (const target of regexTargetsForNode(node)) {
      for (const mutation of mutateRegexPattern(target.pattern)) {
        rawMutants.push({
          line,
          mutatorName: 'Regex',
          replacement: target.wrap(mutation.replacement),
          start: target.fullStart,
          end: target.fullEnd,
        })
      }
    }
  })

  const mutants: IndependentMutant[] = rawMutants.map((rm) => {
    const isIgnored = isMutantIgnored(rm.mutatorName, rm.line, directives, excludedMutations)
    return {
      line: rm.line,
      mutatorName: rm.mutatorName,
      replacement: rm.replacement,
      start: rm.start,
      end: rm.end,
      status: isIgnored ? 'Ignored' : 'Active',
    }
  })

  const tally: Record<string, number> = {}
  let activeCount = 0
  let ignoredCount = 0

  for (const m of mutants) {
    tally[m.mutatorName] = (tally[m.mutatorName] || 0) + 1
    if (m.status === 'Active') {
      activeCount++
    } else {
      ignoredCount++
    }
  }

  return {
    mutants,
    mutatorTally: tally,
    activeCount,
    ignoredCount,
  }
}
