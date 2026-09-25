import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'

const PROBE_SOURCE = `export function price(n) {
  if (n > 10) {
    return n + 1
  }
  const label = "expensive"
  return label.length === 0 ? true : false
}`

const KEEP_SOURCE = `export const add = (a: number, b: number) => a + b

export const kept = keep((x: number) => x + 1)
`

const REGION_SOURCE = `export const add = (a: number, b: number) => a + b
if (flag) {
  const inner = 1 + 1
}
`

const OUTSIDE_KEEP = 'outside keep()'
const INSIDE_FLAG = 'inside if (flag)'

type Mutant = {
  id: string
  mutatorName: string
  status?: string | undefined
  statusReason?: string | undefined
  replacement?: string | undefined
}

const keepArgs = (node: Node): readonly Node[] => {
  if (node.type !== 'CallExpression') {
    return []
  }
  const callee = node.callee
  const isKeepCall = callee.type === 'Identifier' && callee.name === 'keep'
  if (!isKeepCall) {
    return []
  }
  return node.arguments
}

const invertedKeepIgnorer: Ignorer = {
  name: 'inverted-keep',
  shouldIgnore: (node, ancestors) => {
    let child: Node = node
    for (const ancestor of ancestors) {
      if (keepArgs(ancestor).includes(child)) {
        return undefined
      }
      child = ancestor
    }
    return OUTSIDE_KEEP
  },
}

const isFlagIf = (node: Node): boolean => {
  if (node.type !== 'IfStatement') {
    return false
  }
  const test = node.test
  return test.type === 'Identifier' && test.name === 'flag'
}

const regionFlagIgnorer: Ignorer = {
  name: 'region-flag',
  shouldIgnore: (_node, ancestors) => {
    if (ancestors.some(isFlagIf)) {
      return INSIDE_FLAG
    }
    return undefined
  },
}
const failingRuleIgnorer: Ignorer = {
  name: 'failing-rule',
  shouldIgnore: () => {
    throw new Error('the rule refuses to decide')
  },
}
const countByMutator = (mutants: readonly Mutant[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const mutant of mutants) {
    const key = mutant.mutatorName
    const current = counts[key] ?? 0
    counts[key] = current + 1
  }
  return counts
}

const isActive = (mutant: Mutant): boolean => mutant.status !== 'Ignored'

const Feature = makeFeature({ it })

Feature('Instrumenter characterization')
  .live('parses real source with the oxc parser loaded at run time')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'The baseline snippet yields thirteen mutants across six families',
      Gherkin.Do.pipe(
        Given('the baseline source')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('it is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the total and per-mutator counts match the baseline')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) => {
          const active = result.mutants.filter(isActive)
          return expect({ activeLength: active.length, counts: countByMutator(active) }).toEqual({
            activeLength: 13,
            counts: {
              ArithmeticOperator: 1,
              BlockStatement: 2,
              BooleanLiteral: 2,
              ConditionalExpression: 4,
              EqualityOperator: 3,
              StringLiteral: 1,
            },
          })
        }),
      ),
    )

    scenario(
      'A guarded feature check keeps every mutant placeable',
      Gherkin.Do.pipe(
        Given('the guarded module source')('source', () =>
          Effect.succeed(`export function gate(feature) {
  if (!feature.enabled) {
    return 'off'
  }
  return 'on'
}`)),
        When('the module is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/guard.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the guard yields its mutants across all four families')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect(countByMutator(result.mutants.filter(isActive))).toEqual({
            BlockStatement: 2,
            BooleanLiteral: 1,
            ConditionalExpression: 2,
            StringLiteral: 2,
          })
        ),
      ),
    )

    scenario(
      'An optional-chained guard keeps its chain mutants placeable',
      Gherkin.Do.pipe(
        Given('the optional-chained module source')('source', () =>
          Effect.succeed(`export function gate(feature) {
  if (!feature?.enabled) {
    return 'off'
  }
  return 'on'
}`)),
        When('the module is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/guard-optional.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the guard yields its mutants across all five families')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect(countByMutator(result.mutants.filter(isActive))).toEqual({
            BlockStatement: 2,
            BooleanLiteral: 1,
            ConditionalExpression: 2,
            OptionalChaining: 1,
            StringLiteral: 2,
          })
        ),
      ),
    )

    scenario(
      'A const-typed literal table still yields its mutants',
      Gherkin.Do.pipe(
        Given('the const-typed table source')('source', () =>
          Effect.succeed(`export const severities = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
} as const`)),
        When('the module is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/const-table.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the table yields mutants on itself and on every literal')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect(countByMutator(result.mutants.filter(isActive))).toEqual({
            ObjectLiteral: 1,
            StringLiteral: 3,
          })
        ),
      ),
    )

    scenario(
      'A switch whose first case falls through to the next is still instrumented',
      Gherkin.Do.pipe(
        Given('a formatter whose "js" case shares the "ts" case body')(
          'source',
          () =>
            Effect.succeed(`export function extensionOf(format) {
  switch (format) {
    case 'js':
    case 'ts':
      return '.ts'
    default:
      return '.txt'
  }
}`),
        ),
        When('the module is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/fall-through.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the file is instrumented with a mutant that removes the empty "js" case')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            fileCount: result.files.length,
            hasEmptyCaseMutant: result.mutants.filter(isActive).some((mutant) =>
              mutant.mutatorName === 'ConditionalExpression' && mutant.replacement === ''
            ),
          }).toEqual({ fileCount: 1, hasEmptyCaseMutant: true })
        ),
      ),
    )

    scenario(
      'A next-line disable directive suppresses the mutant on the following line',
      Gherkin.Do.pipe(
        Given('a file with a disable next-line directive above a plus')(
          'source',
          () =>
            Effect.succeed(`export const a = 1 + 1
// Stryker disable next-line ArithmeticOperator: consecutive run
export const b = 2 + 2
`),
        ),
        When('it is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/next-line.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the plus under the directive is ignored with the reason, and the sibling stays live')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) => {
          const arithmetic = result.mutants.filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')
          const ignored = arithmetic.filter((mutant) => mutant.status === 'Ignored')
          return expect({
            arithmeticCount: arithmetic.length,
            ignored: ignored.map((mutant) => [mutant.statusReason, mutant.replacement]),
          }).toEqual({ arithmeticCount: 2, ignored: [['consecutive run', '2 - 2']] })
        }),
      ),
    )

    scenario(
      'Instrumented output carries a switch for every active mutant',
      Gherkin.Do.pipe(
        // A mutant that is counted but never wrapped prints pristine code:
        // the sandbox runs it unmutated, every test passes, and the mutant
        // silently "survives" — the score reads zero with no error anywhere.
        // The contract lane caught exactly that (all mutants surviving, no
        // switch in the file), so this asserts the wrap itself: for each
        // active mutant id, the emitted content must test that id.
        Given('the baseline source')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('it is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('every active mutant id is tested in the emitted content')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) => {
          const content = result.files[0]?.content ?? ''
          const hash = content.match(/stryMutAct_([0-9a-f]+)/)?.[1]
          const activeIds = result.mutants.filter(isActive).map((mutant) => mutant.id)
          return expect({
            hashIsDefined: hash !== undefined,
            activeIdCount: activeIds.length,
            everyIdTested: activeIds.every((id) => content.includes(`stryMutAct_${hash}("${id}")`)),
          }).toEqual({ hashIsDefined: true, activeIdCount: 13, everyIdTested: true })
        }),
      ),
    )

    scenario(
      'An excluded mutator marks its mutants ignored with a reason',
      Gherkin.Do.pipe(
        Given('the baseline source')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('it is instrumented without exclusions')(
          'baseline',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        When('it is instrumented excluding ArithmeticOperator')(
          'excluded',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: ['ArithmeticOperator'],
            }),
        ),
        Then(
          'the excluded mutator yields Ignored mutants carrying the reason, and no other mutator moves',
        )((
          { baseline, excluded }: {
            baseline: Instrument.InstrumentResult
            excluded: Instrument.InstrumentResult
          },
          expect,
        ) => {
          const excludedArithmetic = excluded.mutants.filter(
            (mutant) => mutant.mutatorName === 'ArithmeticOperator',
          )
          const baselineActive = baseline.mutants.filter(isActive)
          const excludedActive = excluded.mutants.filter(isActive)
          const baselineCounts = countByMutator(baselineActive)
          delete baselineCounts['ArithmeticOperator']
          const excludedCounts = countByMutator(excludedActive)
          return expect({
            excludedArithmetic: excludedArithmetic.map((mutant) => [mutant.status, mutant.statusReason]),
            activeShrink: baselineActive.length - excludedActive.length,
            hasArithmeticActive: excludedActive.some((mutant) => mutant.mutatorName === 'ArithmeticOperator'),
            counts: excludedCounts,
            equalityOperator: excludedCounts['EqualityOperator'],
          }).toEqual({
            excludedArithmetic: [['Ignored', 'Ignored because of excluded mutation "ArithmeticOperator"']],
            activeShrink: 1,
            hasArithmeticActive: false,
            counts: baselineCounts,
            equalityOperator: 3,
          })
        }),
      ),
    )

    scenario(
      'Selecting the inverted keep ignorer keeps the marked argument live and ignores its sibling',
      Gherkin.Do.pipe(
        Given('a file with a keep() argument body and a sibling function')('source', () => Effect.succeed(KEEP_SOURCE)),
        When('it is instrumented with the inverted ignorer selected')(
          'selected',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/keep.ts', content: source, mutate: true }], {
              ignorers: [invertedKeepIgnorer],
              excludedMutations: [],
            }),
        ),
        When('it is instrumented with no ignorer selected')(
          'unselected',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/keep.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the keep-argument plus is live and the sibling plus is ignored only when selected')((
          { selected, unselected }: {
            selected: Instrument.InstrumentResult
            unselected: Instrument.InstrumentResult
          },
          expect,
        ) => {
          const arith = (mutants: readonly Mutant[], replacement: string) =>
            mutants.filter((mutant) =>
              mutant.mutatorName === 'ArithmeticOperator' && mutant.replacement === replacement
            )
          const selectedKeep = arith(selected.mutants, 'x - 1')
          const selectedSibling = arith(selected.mutants, 'a - b')
          return expect({
            selectedKeepActive: selectedKeep.some(isActive),
            selectedSiblingIgnored: selectedSibling.length > 0 &&
              selectedSibling.every((mutant) => mutant.status === 'Ignored' && mutant.statusReason === OUTSIDE_KEEP),
            unselectedKeepActive: arith(unselected.mutants, 'x - 1').some(isActive),
            unselectedSiblingActive: arith(unselected.mutants, 'a - b').some(isActive),
          }).toEqual({
            selectedKeepActive: true,
            selectedSiblingIgnored: true,
            unselectedKeepActive: true,
            unselectedSiblingActive: true,
          })
        }),
      ),
    )

    scenario(
      'Instrumented output keeps comments and the hashbang',
      Gherkin.Do.pipe(
        Given('a source with a hashbang, leading comments, and inline comments')('source', () =>
          Effect.succeed(
            `#!/usr/bin/env node
// leading file comment
/* block lead */
export function price(n) {
  return n + 1 // trailing on return
}
`,
          )),
        When('it is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/commented.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the printed file still carries every comment and the hashbang')((
          { result }: { result: { files: readonly { content: string }[] } },
          expect,
        ) => {
          const content = result.files[0]?.content ?? ''
          return expect({
            startsWithHashbang: content.startsWith('#!/usr/bin/env node'),
            hasLeadingComment: content.includes('// leading file comment'),
            hasBlockLead: content.includes('/* block lead */'),
            hasTrailingReturn: content.includes('// trailing on return'),
          }).toEqual({
            startsWithHashbang: true,
            hasLeadingComment: true,
            hasBlockLead: true,
            hasTrailingReturn: true,
          })
        }),
      ),
    )
    scenario(
      'Selecting the region ignorer ignores mutants inside the flag block while leaving siblings live',
      Gherkin.Do.pipe(
        Given('a file with a sibling function and an if (flag) block')('source', () => Effect.succeed(REGION_SOURCE)),
        When('it is instrumented with the region ignorer selected')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/region.ts', content: source, mutate: true }], {
              ignorers: [regionFlagIgnorer],
              excludedMutations: [],
            }),
        ),
        Then('the plus inside the flag block is ignored and the sibling plus is live')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) => {
          const arith = (replacement: string) =>
            result.mutants.filter((mutant) =>
              mutant.mutatorName === 'ArithmeticOperator' && mutant.replacement === replacement
            )
          const sibling = arith('a - b')
          const inner = arith('1 - 1')
          return expect({
            siblingActive: sibling.some(isActive),
            innerIgnored: inner.length > 0 &&
              inner.every((mutant) => mutant.status === 'Ignored' && mutant.statusReason === INSIDE_FLAG),
          }).toEqual({ siblingActive: true, innerIgnored: true })
        }),
      ),
    )
    scenario(
      'Every node consults the ignorer, including top-level nodes with empty ancestors',
      Gherkin.Do.pipe(
        Given('the baseline source')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('it is instrumented with the inverted ignorer selected')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/probe.ts', content: source, mutate: true }], {
              ignorers: [invertedKeepIgnorer],
              excludedMutations: [],
            }),
        ),
        Then('every mutant is ignored with the ignorer reason')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            mutantCount: result.mutants.length,
            everyIgnored: result.mutants.every((mutant) =>
              mutant.status === 'Ignored' && mutant.statusReason === OUTSIDE_KEEP
            ),
          }).toEqual({ mutantCount: 13, everyIgnored: true })
        ),
      ),
    )

    scenario(
      'With two ignorers both matching, the first registered ignorer wins',
      Gherkin.Do.pipe(
        Given('a file with a sibling function and an if (flag) block')('source', () => Effect.succeed(REGION_SOURCE)),
        When('it is instrumented with the inverted ignorer before the region ignorer')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/region.ts', content: source, mutate: true }], {
              ignorers: [invertedKeepIgnorer, regionFlagIgnorer],
              excludedMutations: [],
            }),
        ),
        Then('the first ignorer reason wins even where both match')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            atLeastOne: result.mutants.length > 0,
            everyIgnoredOutsideKeep: result.mutants.every((mutant) =>
              mutant.status === 'Ignored' && mutant.statusReason === OUTSIDE_KEEP
            ),
            noneInsideFlag: result.mutants.every((mutant) => mutant.statusReason !== INSIDE_FLAG),
          }).toEqual({ atLeastOne: true, everyIgnoredOutsideKeep: true, noneInsideFlag: true })
        ),
      ),
    )
    scenario(
      'A rule that cannot decide stops the run with the rule failure as the reason',
      Gherkin.Do.pipe(
        Given('a source with a mutable addition')('source', () => Effect.succeed('export const a = 1 + 1\n')),
        When('it is instrumented with a rule that refuses to decide')(
          'error',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/failing-rule.ts', content: source, mutate: true }], {
              ignorers: [failingRuleIgnorer],
              excludedMutations: [],
            }).pipe(Effect.flip),
        ),
        Then('the run stops naming the file and carrying the rule failure')((
          { error }: { error: Instrument.InstrumentError },
          expect,
        ) =>
          expect({
            namesFile: error.message.includes('/tmp/failing-rule.ts'),
            namesReason: (error.cause instanceof Error ? error.cause.message : '').includes(
              'the rule refuses to decide',
            ),
          }).toEqual({ namesFile: true, namesReason: true })
        ),
      ),
    )
  })
