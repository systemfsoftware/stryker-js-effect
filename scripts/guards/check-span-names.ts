#!/usr/bin/env -S deno run --allow-read --allow-run --allow-write=/tmp --allow-env
const SPAN_NAME_CALLEES = [
  'Effect.fn',
  'Effect.withSpan',
  'Effect.useSpan',
  'withSpan',
  'useSpan',
  'withPhaseSpan',
  'withLinkedSpan',
  'Sandwich.named',
] as const

const CALLEE_ALTERNATION = SPAN_NAME_CALLEES
  .map((callee) => callee.replace(/\./g, '\\.'))
  .join('|')

const CALL = new RegExp(`(?:${CALLEE_ALTERNATION})\\s*\\(\\s*(['"\`])`, 'g')

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/

export interface SpanNameFinding {
  readonly line: number
  readonly callee: string
  readonly argument: string
}

const argumentOf = (text: string, endQuoteAt: number): string => {
  const quote = text[endQuoteAt]
  if (quote === '`') return 'a template literal'
  const end = text.indexOf(quote, endQuoteAt + 1)
  return end === -1 ? 'a string literal' : `the string literal ${text.slice(endQuoteAt, end + 1)}`
}

export const findSpanNameLiterals = (text: string): readonly SpanNameFinding[] => {
  const findings: SpanNameFinding[] = []
  CALL.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CALL.exec(text)) !== null) {
    const line = text.slice(0, match.index).split('\n').length
    const lineText = text.split('\n')[line - 1] ?? ''
    if (COMMENT_LINE.test(lineText)) continue
    findings.push({
      line,
      callee: match[0].slice(0, match[0].indexOf('(')).trim(),
      argument: argumentOf(text, match.index + match[0].length - 1),
    })
  }
  return findings
}

export const formatFinding = (file: string, finding: SpanNameFinding): string =>
  `  --> ${file}:${finding.line}: ${finding.callee} is named by ${finding.argument}`

export const formatDiagnostic = (file: string, findings: readonly SpanNameFinding[]): string =>
  [
    `error[SPAN-NAME]: a production span is named by a literal in ${file}`,
    ...findings.map((finding) => formatFinding(file, finding)),
    '',
    'help: every span the CLI emits is declared in the CLI contract span taxonomy, and a trace',
    '      consumer reads those names as a published surface. A literal here names a span the',
    '      contract does not declare, and the version law cannot see the change.',
    '',
    'remediation:',
    '  1. declare the span in packages/stryker-js-cli-contract/src/SpanTaxonomy.ts',
    `  2. pass the member instead: ${SPAN_NAME_CALLEES[0]}(SpanTaxonomy.Spans.<member>.name)`,
    '  3. regenerate the document: pnpm --filter @systemfsoftware/stryker-js-cli-contract generate:contract',
    '',
  ].join('\n')

const listSources = async (root: string): Promise<readonly string[]> => {
  const paths: string[] = []
  const packages = root
  try {
    for await (const entry of Deno.readDir(packages)) {
      if (!entry.isDirectory) continue
      const src = `${packages}/${entry.name}/src`
      try {
        for await (const file of walk(src)) paths.push(file)
      } catch {
        continue
      }
    }
  } catch {
    return paths
  }
  return paths.sort()
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'temp') continue
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory) yield* walk(path)
    else if (entry.isFile && entry.name.endsWith('.ts')) yield path
  }
}

const selftest = (): number => {
  const cases: readonly { readonly name: string; readonly run: () => void }[] = [
    {
      name: "refuses Effect.fn('x') and names the file and line",
      run: () => {
        const findings = findSpanNameLiterals(`const a = Effect.fn('x')(function*() {})`)
        if (findings.length !== 1) throw new Error(`expected one finding, got ${findings.length}`)
        if (findings[0]?.callee !== 'Effect.fn') throw new Error(`callee: ${findings[0]?.callee}`)
        if (findings[0]?.line !== 1) throw new Error(`line: ${findings[0]?.line}`)
        const diagnostic = formatDiagnostic('packages/x/src/a.ts', findings)
        if (!diagnostic.includes('packages/x/src/a.ts:1')) throw new Error(diagnostic)
        if (!diagnostic.includes("the string literal 'x'")) throw new Error(diagnostic)
      },
    },
    {
      name: 'refuses a template literal span name',
      run: () => {
        const findings = findSpanNameLiterals('Effect.withSpan(`a.${b}`, { attributes: {} })(effect)')
        if (findings.length !== 1) throw new Error(`expected one finding, got ${findings.length}`)
        if (findings[0]?.argument !== 'a template literal') throw new Error(`${findings[0]?.argument}`)
      },
    },
    {
      name: "refuses withSpan('y') and withPhaseSpan('prepare', {}, effect)",
      run: () => {
        const bare = findSpanNameLiterals(`pipe(effect, withSpan('y'))`)
        if (bare.length !== 1 || bare[0]?.callee !== 'withSpan') throw new Error(JSON.stringify(bare))
        const phase = findSpanNameLiterals(`withPhaseSpan('prepare', {}, effect)`)
        if (phase.length !== 1 || phase[0]?.callee !== 'withPhaseSpan') throw new Error(JSON.stringify(phase))
        const cell = findSpanNameLiterals(`Sandwich.named('stryker.checker.check_plans')(read)`)
        if (cell.length !== 1 || cell[0]?.callee !== 'Sandwich.named') throw new Error(JSON.stringify(cell))
      },
    },
    {
      name: 'refuses a literal on the line after the callee',
      run: () => {
        const findings = findSpanNameLiterals(`const a = Effect.fn(\n  'stryker.x',\n)(function*() {})`)
        if (findings.length !== 1) throw new Error(`expected one finding, got ${findings.length}`)
        if (findings[0]?.line !== 1) throw new Error(`line: ${findings[0]?.line}`)
      },
    },
    {
      name: 'accepts a taxonomy member and an identifier',
      run: () => {
        const member = findSpanNameLiterals(`const a = Effect.fn(SpanTaxonomy.Spans.prepare.name)(function*() {})`)
        if (member.length !== 0) throw new Error(JSON.stringify(member))
        const identifier = findSpanNameLiterals(`withPhaseSpan(span, {}, effect)`)
        if (identifier.length !== 0) throw new Error(JSON.stringify(identifier))
        const checker = findSpanNameLiterals(`Effect.withSpan(spanName, { attributes: {} })`)
        if (checker.length !== 0) throw new Error(JSON.stringify(checker))
      },
    },
    {
      name: 'ignores a commented example',
      run: () => {
        const comment = findSpanNameLiterals(`// declare it as Effect.fn('x') today\nconst a = 1`)
        if (comment.length !== 0) throw new Error(JSON.stringify(comment))
        const block = findSpanNameLiterals(`/**\n * withSpan('y')\n */\nconst a = 1`)
        if (block.length !== 0) throw new Error(JSON.stringify(block))
      },
    },
    {
      name: 'reports findings in a second and third line',
      run: () => {
        const findings = findSpanNameLiterals(
          `line one\nconst a = Effect.fn('x')(f)\nconst b = Effect.useSpan('y', {})`,
        )
        if (findings.length !== 2) throw new Error(`expected two findings, got ${findings.length}`)
        if (findings[0]?.line !== 2 || findings[1]?.line !== 3) throw new Error(JSON.stringify(findings))
      },
    },
  ]

  let failures = 0
  for (const test of cases) {
    try {
      test.run()
      console.log(`  ✓ ${test.name}`)
    } catch (error) {
      console.error(`  ✗ ${test.name}: ${error instanceof Error ? error.message : String(error)}`)
      failures++
    }
  }

  if (failures > 0) {
    console.error(`check-span-names: selftest FAILED (${failures}/${cases.length})`)
    return 1
  }
  console.log(`check-span-names: selftest ok (${cases.length} tests)`)
  return 0
}

const main = async (): Promise<number> => {
  if (Deno.args.includes('--selftest')) return selftest()

  const root = Deno.args.find((arg) => !arg.startsWith('--')) ?? '.'
  const files = await listSources(`${root}/packages`)
  let failures = 0
  for (const file of files) {
    const findings = findSpanNameLiterals(await Deno.readTextFile(file))
    if (findings.length === 0) continue
    console.error(formatDiagnostic(file, findings))
    failures += findings.length
  }

  if (failures > 0) {
    console.error(`check-span-names: ${failures} undeclared span name(s)`)
    return 1
  }
  console.log(`check-span-names: ${files.length} source file(s) name every span through the taxonomy`)
  return 0
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (error) {
    console.error(`check-span-names: error: ${error instanceof Error ? error.message : String(error)}`)
    Deno.exit(1)
  }
}
