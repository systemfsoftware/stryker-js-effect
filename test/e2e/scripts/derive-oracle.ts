import * as fs from 'node:fs'
import * as path from 'node:path'
import { Node, Project, SyntaxKind } from 'ts-morph'

export interface IndependentMutant {
  readonly line: number
  readonly mutatorName: string
  readonly replacement: string
  readonly start: number
  readonly end: number
  readonly status: 'Active' | 'Ignored'
  readonly compileError?: { readonly code: number; readonly message: string }
}

export interface IndependentInventory {
  readonly mutants: readonly IndependentMutant[]
  readonly mutatorTally: Readonly<Record<string, number>>
  readonly activeCount: number
  readonly ignoredCount: number
}

const DIRECTIVE_REGEX = /^\s*\/\/\s*Stryker\s+(disable|restore)(?:\s+(next-line))?(?:\s+([a-zA-Z0-9_, ]+))?/

interface DirectiveRule {
  readonly type: 'disable' | 'restore'
  readonly scope?: 'next-line'
  readonly targetMutators: readonly string[]
  readonly line: number
}

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
              start: node.getOperatorToken().getStart(),
              end: node.getOperatorToken().getEnd(),
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
              start: node.getOperatorToken().getStart(),
              end: node.getOperatorToken().getEnd(),
            })
          }
          break
        }
        case SyntaxKind.BarBarEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '&&=',
            start: node.getOperatorToken().getStart(),
            end: node.getOperatorToken().getEnd(),
          })
          break
        case SyntaxKind.AmpersandAmpersandEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '||=',
            start: node.getOperatorToken().getStart(),
            end: node.getOperatorToken().getEnd(),
          })
          break
        case SyntaxKind.QuestionQuestionEqualsToken:
          rawMutants.push({
            line,
            mutatorName: 'AssignmentOperator',
            replacement: '&&=',
            start: node.getOperatorToken().getStart(),
            end: node.getOperatorToken().getEnd(),
          })
          break
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

export function determineCompileErrorsWithDiagnostics(
  sourceText: string,
  mutants: readonly IndependentMutant[],
): readonly IndependentMutant[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, noImplicitAny: true, target: 99 },
  })

  return mutants.map((m) => {
    if (m.status === 'Ignored') {
      return m
    }
    const mutated = sourceText.slice(0, m.start) + m.replacement + sourceText.slice(m.end)
    const sf = project.createSourceFile('temp.ts', mutated, { overwrite: true })
    const diags = sf.getPreEmitDiagnostics()
    const errorDiag = diags.find((d) => d.getCategory() === 1)
    if (errorDiag) {
      return {
        ...m,
        compileError: {
          code: errorDiag.getCode(),
          message: errorDiag.getMessageText().toString(),
        },
      }
    }
    return m
  })
}

export function deriveIndependentOracle(options: {
  readonly fixtureDir: string
  readonly mutateFiles: readonly string[]
  readonly excludedMutations?: readonly string[]
}): IndependentInventory {
  const { fixtureDir, mutateFiles, excludedMutations = [] } = options
  const allMutants: IndependentMutant[] = []
  const combinedTally: Record<string, number> = {}
  let totalActive = 0
  let totalIgnored = 0

  for (const rel of mutateFiles) {
    const fullPath = path.resolve(fixtureDir, rel)
    const content = fs.readFileSync(fullPath, 'utf8')
    const res = analyzeFileWithTsMorph(content, excludedMutations)

    for (const m of res.mutants) {
      allMutants.push(m)
    }
    for (const [k, v] of Object.entries(res.mutatorTally)) {
      combinedTally[k] = (combinedTally[k] || 0) + v
    }
    totalActive += res.activeCount
    totalIgnored += res.ignoredCount
  }

  return {
    mutants: allMutants,
    mutatorTally: combinedTally,
    activeCount: totalActive,
    ignoredCount: totalIgnored,
  }
}
