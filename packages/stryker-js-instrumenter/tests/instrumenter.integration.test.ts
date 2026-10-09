import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'

import { stockOptions } from './__fixtures__/instrument.js'

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
const IGNORED_OUTSIDE_KEEP = `ignorer: ${OUTSIDE_KEEP}`
const IGNORED_INSIDE_FLAG = `ignorer: ${INSIDE_FLAG}`

const ARID_LOG_SOURCE = `export const ready = () => Effect.logInfo("ready")
`

const ARID_RULE_SOURCE = `export const logged = () => Effect.logInfo('logged')
export const named = () => Logger.info('named')
export const consoled = () => console.log('consoled')
export const spanned = () => Effect.withSpan('spanned')
export const counted = () => Metric.counter('counted')
export const slept = () => Effect.sleep(Duration.seconds('slept'))
export const scheduled = () => Schedule.recurs('scheduled')
export const defaulted = () => Config.withDefault('defaulted')
export const cached = () => Effect.cached('cached')
export const local = () => logInfo('local')
export const foreign = () => logger.logInfo('foreign')
export const countedElsewhere = () => Metrics.counter('countedElsewhere')
export const scheduledElsewhere = () => Scheduler.recurs('scheduledElsewhere')
export const configuredElsewhere = () => Config.string('configuredElsewhere')
export const cachedElsewhere = () => Effect.cache('cachedElsewhere')
`

const ARID_GATED_SOURCE = `export const announce = (level) => {
  if (level > 3) {
    Effect.logInfo('ready')
  }
}
`

const ARID_NEAR_MISS_SOURCE = `export const announce = (level) => {
  if (level > 3) {
    logInfo('ready')
  }
}
`

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

const COMPARISON_MUTATORS: readonly string[] = ['BooleanLiteral', 'ConditionalExpression', 'EqualityOperator']

const activeReplacements = (result: Instrument.InstrumentResult): readonly string[] =>
  result.mutants
    .filter((mutant) => isActive(mutant) && COMPARISON_MUTATORS.includes(mutant.mutatorName))
    .map((mutant) => mutant.replacement)
    .toSorted()

const ignoredComparisonReasons = (result: Instrument.InstrumentResult): readonly string[] =>
  result.mutants
    .filter((mutant) => !isActive(mutant) && COMPARISON_MUTATORS.includes(mutant.mutatorName))
    .map((mutant) => `${mutant.replacement} <= ${mutant.statusReason ?? ''}`)
    .toSorted()

const underFull = (fileName: string, source: string) =>
  Instrument.instrument(
    [{ name: fileName, content: source, mutate: true }],
    stockOptions({ ignorers: [], excludedMutations: [], mutantSetPolicy: 'full' }),
  )

const instrumentSource = (fileName: string, source: string) =>
  Instrument.instrument(
    [{ name: fileName, content: source, mutate: true }],
    stockOptions({ ignorers: [], excludedMutations: [] }),
  )

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
          ({ source }: { source: string }) => underFull('/tmp/probe.ts', source),
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
            Instrument.instrument(
              [{ name: '/tmp/guard.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
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
            Instrument.instrument(
              [{ name: '/tmp/guard-optional.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
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
            Instrument.instrument(
              [{ name: '/tmp/const-table.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
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
            Instrument.instrument(
              [{ name: '/tmp/fall-through.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
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
            Instrument.instrument(
              [{ name: '/tmp/next-line.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
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
          }).toEqual({ arithmeticCount: 2, ignored: [['directive: consecutive run', '2 - 2']] })
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
          ({ source }: { source: string }) => underFull('/tmp/probe.ts', source),
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
            Instrument.instrument(
              [{ name: '/tmp/probe.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
        ),
        When('it is instrumented excluding ArithmeticOperator')(
          'excluded',
          ({ source }: { source: string }) =>
            Instrument.instrument(
              [{ name: '/tmp/probe.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: ['ArithmeticOperator'],
              }),
            ),
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
            excludedArithmetic: [[
              'Ignored',
              'excluded-mutator: Ignored because of excluded mutation "ArithmeticOperator"',
            ]],
            activeShrink: 1,
            hasArithmeticActive: false,
            counts: baselineCounts,
            equalityOperator: 4,
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
            Instrument.instrument(
              [{ name: '/tmp/keep.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [invertedKeepIgnorer],
                excludedMutations: [],
              }),
            ),
        ),
        When('it is instrumented with no ignorer selected')(
          'unselected',
          ({ source }: { source: string }) =>
            Instrument.instrument(
              [{ name: '/tmp/keep.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
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
              selectedSibling.every((mutant) =>
                mutant.status === 'Ignored' && mutant.statusReason === IGNORED_OUTSIDE_KEEP
              ),
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
            Instrument.instrument(
              [{ name: '/tmp/commented.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [],
                excludedMutations: [],
              }),
            ),
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
            Instrument.instrument(
              [{ name: '/tmp/region.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [regionFlagIgnorer],
                excludedMutations: [],
              }),
            ),
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
              inner.every((mutant) => mutant.status === 'Ignored' && mutant.statusReason === IGNORED_INSIDE_FLAG),
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
            Instrument.instrument(
              [{ name: '/tmp/probe.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [invertedKeepIgnorer],
                excludedMutations: [],
                mutantSetPolicy: 'full',
              }),
            ),
        ),
        Then('every mutant is ignored with the ignorer reason')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            mutantCount: result.mutants.length,
            everyIgnored: result.mutants.every((mutant) =>
              mutant.status === 'Ignored' && mutant.statusReason === IGNORED_OUTSIDE_KEEP
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
            Instrument.instrument(
              [{ name: '/tmp/region.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [invertedKeepIgnorer, regionFlagIgnorer],
                excludedMutations: [],
              }),
            ),
        ),
        Then('the first ignorer reason wins even where both match')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            atLeastOne: result.mutants.length > 0,
            everyIgnoredOutsideKeep: result.mutants.every((mutant) =>
              mutant.status === 'Ignored' && mutant.statusReason === IGNORED_OUTSIDE_KEEP
            ),
            noneInsideFlag: result.mutants.every((mutant) => mutant.statusReason !== IGNORED_INSIDE_FLAG),
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
            Instrument.instrument(
              [{ name: '/tmp/failing-rule.ts', content: source, mutate: true }],
              stockOptions({
                ignorers: [failingRuleIgnorer],
                excludedMutations: [],
              }),
            ).pipe(Effect.flip),
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

    scenario(
      'Instrumenting the same source twice mints the same content-derived ids',
      Gherkin.Do.pipe(
        Given('the baseline source')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('it is instrumented twice')('results', ({ source }: { source: string }) =>
          Effect.all([
            underFull('/tmp/probe.ts', source),
            underFull('/tmp/probe.ts', source),
          ])),
        Then('both runs mint sixteen lowercase hex digits per mutant, in the same order')((
          { results }: { results: readonly [Instrument.InstrumentResult, Instrument.InstrumentResult] },
          expect,
        ) => {
          const ids = results[0].mutants.map((mutant) => mutant.id)
          return expect({
            count: ids.length,
            everyIdIsSixteenLowercaseHexDigits: ids.every((id) => /^[0-9a-f]{16}$/.test(id)),
            secondRunIds: results[1].mutants.map((mutant) => mutant.id),
          }).toEqual({ count: 13, everyIdIsSixteenLowercaseHexDigits: true, secondRunIds: ids })
        }),
      ),
    )

    scenario(
      'A line inserted above a mutant leaves its id alone',
      Gherkin.Do.pipe(
        Given('the baseline source')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('it is instrumented with and without a blank first line')(
          'results',
          ({ source }: { source: string }) =>
            Effect.all([
              instrumentSource('/tmp/probe.ts', source),
              instrumentSource('/tmp/probe.ts', `\n${source}`),
            ]),
        ),
        Then('both runs carry the same ids')((
          { results }: { results: readonly [Instrument.InstrumentResult, Instrument.InstrumentResult] },
          expect,
        ) => {
          const idsOf = (result: Instrument.InstrumentResult) => result.mutants.map((mutant) => mutant.id).toSorted()
          return expect(idsOf(results[1])).toEqual(idsOf(results[0]))
        }),
      ),
    )

    scenario(
      'Two identical replacements of identical text get distinct ids',
      Gherkin.Do.pipe(
        Given('a file with the same addition twice')(
          'source',
          () => Effect.succeed('export const a = 1 + 1\nexport const b = 1 + 1\n'),
        ),
        When('it is instrumented')(
          'result',
          ({ source }: { source: string }) => instrumentSource('/tmp/twin-additions.ts', source),
        ),
        Then('both arithmetic mutants carry one replacement, two ids, and one switch arm each')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) => {
          const content = result.files[0]?.content ?? ''
          const helper = content.match(/stryMutAct_([0-9a-f]+)/)?.[1]
          const arithmetic = result.mutants.filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')
          return expect({
            count: arithmetic.length,
            replacements: [...new Set(arithmetic.map((mutant) => mutant.replacement))],
            distinctIds: new Set(arithmetic.map((mutant) => mutant.id)).size,
            everyIdTestedInTheEmittedSwitch: arithmetic.every((mutant) =>
              helper !== undefined && content.includes(`stryMutAct_${helper}("${mutant.id}")`)
            ),
          }).toEqual({ count: 2, replacements: ['1 - 1'], distinctIds: 2, everyIdTestedInTheEmittedSwitch: true })
        }),
      ),
    )

    scenario(
      'A directive that ignores an earlier mutant leaves the later ids alone',
      Gherkin.Do.pipe(
        Given('a file with two additions')(
          'source',
          () => Effect.succeed('export const a = 1 + 1\nexport const b = 2 + 2\n'),
        ),
        When('it is instrumented as written')(
          'plain',
          ({ source }: { source: string }) => instrumentSource('/tmp/two-additions.ts', source),
        ),
        When('it is instrumented with a directive ignoring the first addition')(
          'directed',
          ({ source }: { source: string }) =>
            instrumentSource('/tmp/two-additions.ts', `// Stryker disable next-line ArithmeticOperator\n${source}`),
        ),
        Then('the ignored addition is Ignored and both ids stay put')((
          { plain, directed }: { plain: Instrument.InstrumentResult; directed: Instrument.InstrumentResult },
          expect,
        ) => {
          const arithmeticOf = (result: Instrument.InstrumentResult) =>
            result.mutants.filter((mutant) => mutant.mutatorName === 'ArithmeticOperator')
          const directedArithmetic = arithmeticOf(directed)
          return expect({
            plainIds: arithmeticOf(plain).map((mutant) => mutant.id).toSorted(),
            ignoredEarlier: directedArithmetic.filter((mutant) => mutant.replacement === '1 - 1').map(
              (mutant) => mutant.status,
            ),
            laterIds: directedArithmetic.filter((mutant) => mutant.replacement === '2 - 2').map((mutant) => mutant.id),
          }).toEqual({
            plainIds: directedArithmetic.map((mutant) => mutant.id).toSorted(),
            ignoredEarlier: ['Ignored'],
            laterIds: arithmeticOf(plain).filter((mutant) => mutant.replacement === '2 - 2').map((mutant) => mutant.id),
          })
        }),
      ),
    )

    scenario(
      'The same source under a different file name carries different ids',
      Gherkin.Do.pipe(
        Given('the baseline source')('source', () => Effect.succeed(PROBE_SOURCE)),
        When('it is instrumented as two files with identical content')(
          'results',
          ({ source }: { source: string }) =>
            Effect.all([
              underFull('/tmp/one.ts', source),
              underFull('/tmp/two.ts', source),
            ]),
        ),
        Then('each id is scoped to its own file')((
          { results }: { results: readonly [Instrument.InstrumentResult, Instrument.InstrumentResult] },
          expect,
        ) => {
          const [one, two] = results
          const twoIds = new Set(two.mutants.map((mutant) => mutant.id))
          return expect({
            counts: [one.mutants.length, two.mutants.length],
            everyIdDiffers: one.mutants.every((mutant) => !twoIds.has(mutant.id)),
          }).toEqual({ counts: [13, 13], everyIdDiffers: true })
        }),
      ),
    )

    scenario(
      'An arid log argument is ignored by default and mutated under the full policy',
      Gherkin.Do.pipe(
        Given('a module logging a constant')('source', () => Effect.succeed(ARID_LOG_SOURCE)),
        When('it is instrumented under the default policy')(
          'defaulted',
          ({ source }: { source: string }) => instrumentSource('/tmp/arid-log.ts', source),
        ),
        When('it is instrumented under the full policy')(
          'full',
          ({ source }: { source: string }) =>
            Instrument.instrument(
              [{ name: '/tmp/arid-log.ts', content: source, mutate: true }],
              stockOptions({ ignorers: [], excludedMutations: [], mutantSetPolicy: 'full' }),
            ),
        ),
        Then('the logged string is Ignored with the arid rule, and live under the full policy')((
          { defaulted, full }: {
            defaulted: Instrument.InstrumentResult
            full: Instrument.InstrumentResult
          },
          expect,
        ) => {
          const strings = (result: Instrument.InstrumentResult) =>
            result.mutants.filter((mutant) => mutant.mutatorName === 'StringLiteral')
          return expect({
            defaulted: strings(defaulted).map((mutant) => [mutant.status, mutant.statusReason]),
            fullIsActive: strings(full).length > 0 && strings(full).every(isActive),
          }).toEqual({
            defaulted: [['Ignored', 'arid-logging: Effect.logInfo']],
            fullIsActive: true,
          })
        }),
      ),
    )

    scenario(
      'A condition deciding whether to log is still mutated',
      Gherkin.Do.pipe(
        Given('a module logging inside a guarded branch')('source', () => Effect.succeed(ARID_GATED_SOURCE)),
        When('it is instrumented under the default policy')(
          'gated',
          ({ source }: { source: string }) => instrumentSource('/tmp/arid-gated.ts', source),
        ),
        When('it is instrumented with the same guard around a local function named logInfo')(
          'nearMiss',
          () => instrumentSource('/tmp/arid-near-miss.ts', ARID_NEAR_MISS_SOURCE),
        ),
        Then('the guard keeps its mutants while the logged string is ignored')((
          { gated, nearMiss }: {
            gated: Instrument.InstrumentResult
            nearMiss: Instrument.InstrumentResult
          },
          expect,
        ) => {
          const conditionMutants = (result: Instrument.InstrumentResult) =>
            result.mutants.filter((mutant) => isActive(mutant) && mutant.mutatorName !== 'StringLiteral')
          return expect({
            gatedIgnored: gated.mutants
              .filter((mutant) => mutant.status === 'Ignored' && mutant.mutatorName === 'StringLiteral')
              .map((mutant) => [mutant.mutatorName, mutant.statusReason]),
            gatedActiveStrings: gated.mutants.filter((mutant) =>
              isActive(mutant) && mutant.mutatorName === 'StringLiteral'
            ).length,
            nearMissIgnored: nearMiss.mutants.filter((mutant) =>
              mutant.status === 'Ignored' && mutant.mutatorName === 'StringLiteral'
            ).length,
            nearMissActiveStrings: nearMiss.mutants.filter((mutant) => mutant.mutatorName === 'StringLiteral').length,
            sameConditionMutants: conditionMutants(gated).length === conditionMutants(nearMiss).length &&
              conditionMutants(gated).length > 0,
          }).toEqual({
            gatedIgnored: [['StringLiteral', 'arid-logging: Effect.logInfo']],
            gatedActiveStrings: 0,
            nearMissIgnored: 0,
            nearMissActiveStrings: 1,
            sameConditionMutants: true,
          })
        }),
      ),
    )

    scenario(
      'Every arid rule ignores its argument and keeps its near miss',
      Gherkin.Do.pipe(
        Given('a module calling each arid form beside a look-alike local call')(
          'source',
          () => Effect.succeed(ARID_RULE_SOURCE),
        ),
        When('it is instrumented under the default policy')(
          'result',
          ({ source }: { source: string }) => instrumentSource('/tmp/arid-rules.ts', source),
        ),
        Then('each arid argument names its rule and the look-alikes stay mutable')((
          { result }: { result: Instrument.InstrumentResult },
          expect,
        ) => {
          const strings = result.mutants.filter((mutant) => mutant.mutatorName === 'StringLiteral')
          const ignoredByReason: Record<string, number> = {}
          for (const mutant of strings) {
            if (mutant.status === 'Ignored') {
              const reason = mutant.statusReason ?? ''
              ignoredByReason[reason] = (ignoredByReason[reason] ?? 0) + 1
            }
          }
          return expect({
            ignoredByReason,
            activeStrings: strings.filter(isActive).length,
          }).toEqual({
            ignoredByReason: {
              'arid-config-default: Config.withDefault': 1,
              'arid-logging: Effect.logInfo': 1,
              'arid-logging: Logger.info': 1,
              'arid-logging: console.log': 1,
              'arid-memoization: Effect.cached': 1,
              'arid-telemetry: Effect.withSpan': 1,
              'arid-telemetry: Metric.counter': 1,
              'arid-time: Duration.seconds': 1,
              'arid-time: Schedule.recurs': 1,
            },
            activeStrings: 6,
          })
        }),
      ),
    )

    scenario(
      'A relational comparison in a condition keeps every literal and operator under default',
      Gherkin.Do.pipe(
        Given('a guard comparing two numbers')(
          'source',
          () => Effect.succeed(`export function f(a, b) { if (a < b) { return 1 } return 0 }`),
        ),
        When('it is instrumented under the default policy')(
          'defaulted',
          ({ source }: { source: string }) => instrumentSource('/tmp/u17-if.ts', source),
        ),
        When('it is instrumented under the full policy')(
          'full',
          ({ source }: { source: string }) => underFull('/tmp/u17-if.ts', source),
        ),
        Then('default drops nothing at the guard and adds the condition-position operator')((
          { defaulted, full }: {
            defaulted: Instrument.InstrumentResult
            full: Instrument.InstrumentResult
          },
          expect,
        ) =>
          expect({
            defaultedActive: activeReplacements(defaulted),
            defaultedIgnored: ignoredComparisonReasons(defaulted),
            fullActive: activeReplacements(full),
            fullIgnored: ignoredComparisonReasons(full),
          }).toEqual({
            defaultedActive: ['a != b', 'a <= b', 'a >= b', 'false', 'true'],
            defaultedIgnored: [],
            fullActive: ['a <= b', 'a >= b', 'false', 'true'],
            fullIgnored: [],
          })
        ),
      ),
    )

    scenario(
      'A loop and a ternary condition keep every mutant main used to drop under default',
      Gherkin.Do.pipe(
        Given('a while loop and a ternary comparing numbers')(
          'source',
          () =>
            Effect.succeed(
              `export const g = (a, b) => { while (a <= b) { a++ } return a }\nexport const h = (a, b) => a > b ? 1 : 0\n`,
            ),
        ),
        When('it is instrumented under the default policy')(
          'defaulted',
          ({ source }: { source: string }) => instrumentSource('/tmp/u17-loops.ts', source),
        ),
        When('it is instrumented under the full policy')(
          'full',
          ({ source }: { source: string }) => underFull('/tmp/u17-loops.ts', source),
        ),
        Then('each condition position keeps its literals and both ordering operators')((
          { defaulted, full }: {
            defaulted: Instrument.InstrumentResult
            full: Instrument.InstrumentResult
          },
          expect,
        ) =>
          expect({
            defaultedActive: activeReplacements(defaulted),
            defaultedIgnored: ignoredComparisonReasons(defaulted),
            fullActive: activeReplacements(full),
          }).toEqual({
            defaultedActive: [
              'a != b',
              'a < b',
              'a <= b',
              'a == b',
              'a > b',
              'a >= b',
              'false',
              'false',
              'true',
              'true',
            ],
            defaultedIgnored: [],
            fullActive: ['a < b', 'a <= b', 'a > b', 'a >= b', 'false', 'false', 'true'],
          })
        ),
      ),
    )

    scenario(
      'A bare comparison keeps today’s variants under both policies',
      Gherkin.Do.pipe(
        Given('a comparison assigned to a local')(
          'source',
          () => Effect.succeed(`export const ok = (a, b) => { const x = a < b; return x }`),
        ),
        When('it is instrumented under the default policy')(
          'defaulted',
          ({ source }: { source: string }) => instrumentSource('/tmp/u17-bare.ts', source),
        ),
        When('it is instrumented under the full policy')(
          'full',
          ({ source }: { source: string }) => underFull('/tmp/u17-bare.ts', source),
        ),
        Then('both policies keep the same replacements')((
          { defaulted, full }: {
            defaulted: Instrument.InstrumentResult
            full: Instrument.InstrumentResult
          },
          expect,
        ) =>
          expect({
            defaultedActive: activeReplacements(defaulted),
            defaultedIgnored: ignoredComparisonReasons(defaulted),
            fullActive: activeReplacements(full),
          }).toEqual({
            defaultedActive: ['a <= b', 'a >= b', 'false', 'true'],
            defaultedIgnored: [],
            fullActive: ['a <= b', 'a >= b', 'false', 'true'],
          })
        ),
      ),
    )

    scenario(
      'An equality comparison and a logical conjunction are untouched by both policies',
      Gherkin.Do.pipe(
        Given('an equality and a conjunction')(
          'source',
          () =>
            Effect.succeed(
              `export const eq = (a, b) => { const x = a === b; return x }\nexport const conj = (a, b) => { const y = a && b; return y }\n`,
            ),
        ),
        When('it is instrumented under the default policy')(
          'defaulted',
          ({ source }: { source: string }) => instrumentSource('/tmp/u17-eq.ts', source),
        ),
        When('it is instrumented under the full policy')(
          'full',
          ({ source }: { source: string }) => underFull('/tmp/u17-eq.ts', source),
        ),
        Then('both policies keep every replacement')((
          { defaulted, full }: {
            defaulted: Instrument.InstrumentResult
            full: Instrument.InstrumentResult
          },
          expect,
        ) =>
          expect({
            defaultedActive: activeReplacements(defaulted),
            defaultedIgnored: ignoredComparisonReasons(defaulted),
            fullActive: activeReplacements(full),
          }).toEqual({
            defaultedActive: ['a !== b', 'false', 'false', 'true', 'true'],
            defaultedIgnored: [],
            fullActive: ['a !== b', 'false', 'false', 'true', 'true'],
          })
        ),
      ),
    )

    scenario(
      'A replacement equal to its original and a duplicate sibling are suppressed',
      Gherkin.Do.pipe(
        Given('a guard whose condition is the literal true')(
          'source',
          () => Effect.succeed(`export const ok = () => { if (true) { return 1 } return 0 }`),
        ),
        When('it is instrumented under the default policy')(
          'defaulted',
          ({ source }: { source: string }) => instrumentSource('/tmp/u17-true.ts', source),
        ),
        When('it is instrumented under the full policy')(
          'full',
          ({ source }: { source: string }) => underFull('/tmp/u17-true.ts', source),
        ),
        Then('the no-op is named equivalent and the second false is a duplicate')((
          { defaulted, full }: {
            defaulted: Instrument.InstrumentResult
            full: Instrument.InstrumentResult
          },
          expect,
        ) =>
          expect({
            defaultedActive: activeReplacements(defaulted),
            defaultedIgnored: ignoredComparisonReasons(defaulted),
            fullActive: activeReplacements(full),
            fullIgnored: ignoredComparisonReasons(full),
          }).toEqual({
            defaultedActive: ['false'],
            defaultedIgnored: [
              'false <= duplicate-at-site: false is already planted at this site',
              'true <= equivalent-to-original: true is the original code',
            ],
            fullActive: ['false', 'false', 'true'],
            fullIgnored: [],
          })
        ),
      ),
    )
  })
