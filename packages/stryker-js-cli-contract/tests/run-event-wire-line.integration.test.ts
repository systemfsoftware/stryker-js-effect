import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const LOCATION = '"location":{"start":{"line":1,"column":1},"end":{"line":1,"column":2}}'

const COST = '{"fixedOverheadMs":1,"testBodyMs":2,"testsExecuted":1,"shared":false}'

const WORKER = '{"_tag":"worker","schemaVersion":"7.0","role":"testRunner","index":0,"startupMs":12.5}'

const NO_REASON = 'null'

const mutantLine = (status: string, file: string | null, cost: string, reason: string = NO_REASON): string =>
  `{"_tag":"mutant","id":"0000000000000001","status":"${status}",${
    file === null ? '' : `"file":"${file}",`
  }${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false,"cost":${cost},"statusReason":${reason}}`

const reasonOf = (line: string): string | null => {
  const decoded = S.decodeResult(RunEvent.RunEventWireLine)(line)
  return Result.isSuccess(decoded) && S.is(RunEvent.RunMutantTested)(decoded.success)
    ? decoded.success.statusReason
    : null
}

const refusalOf = (line: string): string => {
  const decoded = S.decodeResult(RunEvent.RunEventWireLine)(line)
  return Result.isSuccess(decoded) ? `accepted: ${decoded.success._tag}` : `refused: ${decoded.failure.message}`
}

const refusalsOf = (probes: Record<string, string>): Record<string, string> => {
  const outcomes: Record<string, string> = {}
  for (const [name, line] of Object.entries(probes)) outcomes[name] = refusalOf(line)
  return outcomes
}

const COUNTS =
  '{"pending":0,"killed":1,"timeout":0,"survived":0,"noCoverage":0,"runtimeErrors":0,"compileErrors":0,"ignored":0}'

const PHASES = '"prepare":1,"instrument":2,"dry-run":3,"mutation-test":4'

const verdictLine = (phaseDurations: string): string =>
  `{"_tag":"verdict","schemaVersion":"7.0","runId":"01ARZ3NDEKTSV4RRFFQ69G5FAV","mode":"machine","signal":"flag","score":100,"thresholds":{"high":80,"low":60,"break":null},"reportFile":null,"counts":${COUNTS},"mutants":[],"scope":"full","mutantSetPolicy":"default","phaseDurations":${phaseDurations},"static":null,"budget":{"predictedSeconds":0,"actualSeconds":1}}`

const durationOf = (line: string, phase: 'check' | 'reporting'): string =>
  Result.match(S.decodeResult(RunEvent.RunEventWireLine)(line), {
    onFailure: (error) => `refused: ${error.message}`,
    onSuccess: (event) =>
      Match.value(event).pipe(
        Match.tag('verdict', (verdict) =>
          verdict.phaseDurations === null
            ? 'accepted without phase durations: verdict'
            : JSON.stringify(verdict.phaseDurations[phase])),
        Match.orElse(() => 'accepted as a non-verdict event'),
      ),
  })

const reencodedOf = (line: string): string =>
  Result.match(
    Result.flatMap(S.decodeResult(RunEvent.RunEventWireLine)(line), S.encodeResult(RunEvent.RunEventWireLine)),
    { onFailure: (error) => `refused: ${error.message}`, onSuccess: (encoded) => encoded },
  )

Feature('The machine-stream wire codec refuses lines the contract does not declare')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A mutant line naming a status outside the shared vocabulary is refused while a declared status is accepted',
      Gherkin.Do.pipe(
        Given('a mutant line carrying the declared status Killed and one carrying NotAStatus')(
          'probes',
          () =>
            Effect.sync(() => ({
              declared: mutantLine('Killed', 'src/a.ts', COST),
              undeclared: mutantLine('NotAStatus', 'src/a.ts', COST),
            })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) => Effect.sync(() => refusalsOf(s.probes)),
        ),
        Then('the declared status is accepted and the undeclared one is refused')((s, expect) =>
          expect(s.outcomes).toEqual({
            declared: 'accepted: mutantTested',
            undeclared: expect.stringMatching(/^refused:/),
          })
        ),
      ),
    )

    scenario(
      'A mutant line that omits its file is refused',
      Gherkin.Do.pipe(
        Given('a mutant line carrying its file and one omitting the file key')(
          'probes',
          () =>
            Effect.sync(() => ({
              present: mutantLine('Killed', 'src/a.ts', COST),
              absent: mutantLine('Killed', null, COST),
            })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) => Effect.sync(() => refusalsOf(s.probes)),
        ),
        Then('the line carrying its file is accepted and the line omitting it is refused')((s, expect) =>
          expect(s.outcomes).toEqual({
            present: 'accepted: mutantTested',
            absent: expect.stringMatching(/^refused:[\s\S]*file/),
          })
        ),
      ),
    )

    scenario(
      'A mutant line that omits its cost breakdown is refused',
      Gherkin.Do.pipe(
        Given('a mutant line carrying its cost and one omitting the cost key')(
          'probes',
          () =>
            Effect.sync(() => ({
              present: mutantLine('Killed', 'src/a.ts', COST),
              absent:
                `{"_tag":"mutant","id":"0000000000000001","status":"Killed","file":"src/a.ts",${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false,"statusReason":null}`,
            })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) => Effect.sync(() => refusalsOf(s.probes)),
        ),
        Then('the line carrying its cost is accepted and the line omitting it is refused')((s, expect) =>
          expect(s.outcomes).toEqual({
            present: 'accepted: mutantTested',
            absent: expect.stringMatching(/^refused:[\s\S]*cost/),
          })
        ),
      ),
    )

    scenario(
      'An Ignored mutant line must name the ignore rule that removed it',
      Gherkin.Do.pipe(
        Given('Ignored lines with a rule reason, with none, and with a rule outside the vocabulary')(
          'probes',
          () =>
            Effect.sync(() => ({
              named: mutantLine('Ignored', 'src/a.ts', 'null', '"arid-logging: Effect.logInfo"'),
              unnamed: mutantLine('Ignored', 'src/a.ts', 'null'),
              outsideVocabulary: mutantLine('Ignored', 'src/a.ts', 'null', '"made-up-rule: x"'),
              bareRule: mutantLine('Ignored', 'src/a.ts', 'null', '"arid-logging"'),
            })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) => Effect.sync(() => refusalsOf(s.probes)),
        ),
        Then('only the line naming a vocabulary rule is accepted')((s, expect) =>
          expect(s.outcomes).toEqual({
            named: 'accepted: mutantTested',
            unnamed: expect.stringMatching(/^refused:/),
            outsideVocabulary: expect.stringMatching(/^refused:/),
            bareRule: expect.stringMatching(/^refused:/),
          })
        ),
      ),
    )

    scenario(
      'Any other status carries a free-form reason or none, and the reason survives the codec',
      Gherkin.Do.pipe(
        Given('a Killed line with no reason and a Timeout line naming its timeout kind')(
          'probes',
          () =>
            Effect.sync(() => ({
              killed: mutantLine('Killed', 'src/a.ts', COST),
              timeout: mutantLine('Timeout', 'src/a.ts', COST, '"wall-clock-timeout"'),
              ignored: mutantLine('Ignored', 'src/a.ts', 'null', '"duplicate-at-site: tce"'),
            })),
        ),
        When('each line is decoded through the wire codec')(
          'reasons',
          (s) =>
            Effect.sync(() => ({
              killed: reasonOf(s.probes.killed),
              timeout: reasonOf(s.probes.timeout),
              ignored: reasonOf(s.probes.ignored),
            })),
        ),
        Then('each decoded line keeps the reason it was written with')((s, expect) =>
          expect(s.reasons).toEqual({
            killed: null,
            timeout: 'wall-clock-timeout',
            ignored: 'duplicate-at-site: tce',
          })
        ),
      ),
    )

    scenario(
      'A line carrying an unknown event tag is refused',
      Gherkin.Do.pipe(
        Given('a line tagged notAnEvent')(
          'probes',
          () => Effect.sync(() => ({ unknownTag: '{"_tag":"notAnEvent","total":1}' })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) => Effect.sync(() => refusalsOf(s.probes)),
        ),
        Then('the line is refused')((s, expect) =>
          expect(s.outcomes).toEqual({ unknownTag: expect.stringMatching(/^refused:/) })
        ),
      ),
    )

    scenario(
      'A worker line carries its role and start-up cost, and one missing the cost is refused',
      Gherkin.Do.pipe(
        Given('a worker line carrying its start-up cost and one omitting startupMs')(
          'probes',
          () =>
            Effect.sync(() => ({
              declared: WORKER,
              undeclared: '{"_tag":"worker","schemaVersion":"7.0","role":"testRunner","index":0}',
            })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) => Effect.sync(() => refusalsOf(s.probes)),
        ),
        Then('the declared line is accepted and the incomplete one is refused')((s, expect) =>
          expect(s.outcomes).toEqual({
            declared: 'accepted: worker',
            undeclared: expect.stringMatching(/^refused:/),
          })
        ),
      ),
    )

    scenario(
      'A verdict line written before the check and reporting durations existed decodes both as not recorded, never as zero',
      Gherkin.Do.pipe(
        Given('a verdict line whose phase durations carry no check and no reporting key')(
          'line',
          () => Effect.sync(() => verdictLine(`{${PHASES}}`)),
        ),
        When('the line is decoded through the wire codec')(
          'durations',
          (s) =>
            Effect.sync(() => ({ check: durationOf(s.line, 'check'), reporting: durationOf(s.line, 'reporting') })),
        ),
        Then('the check and reporting durations are not-recorded')((s, expect) =>
          expect(s.durations).toEqual({ check: '{"_tag":"not-recorded"}', reporting: '{"_tag":"not-recorded"}' })
        ),
      ),
    )

    scenario(
      'A measured reporting duration with a measured or not-run check survives a decode and re-encode byte for byte',
      Gherkin.Do.pipe(
        Given('a verdict line with a measured check and one with a check that did not run, both with reporting')(
          'probes',
          () =>
            Effect.sync(() => ({
              measured: verdictLine(
                `{${PHASES},"check":{"_tag":"measured","ms":2.5},"reporting":{"_tag":"measured","ms":0.5}}`,
              ),
              notRun: verdictLine(`{${PHASES},"check":{"_tag":"not-run"},"reporting":{"_tag":"measured","ms":0.5}}`),
            })),
        ),
        When('each line is decoded and encoded again')(
          'reencoded',
          (s) =>
            Effect.sync(() => ({ measured: reencodedOf(s.probes.measured), notRun: reencodedOf(s.probes.notRun) })),
        ),
        Then('each re-encoded line equals its original, newline-terminated')((s, expect) =>
          expect(s.reencoded).toEqual({ measured: `${s.probes.measured}\n`, notRun: `${s.probes.notRun}\n` })
        ),
      ),
    )

    scenario(
      'A check duration that is negative, non-finite or of an undeclared kind is refused',
      Gherkin.Do.pipe(
        Given('verdict lines whose check is negative, infinite as a string, or tagged zero')(
          'probes',
          () =>
            Effect.sync(() => ({
              negative: verdictLine(`{${PHASES},"check":{"_tag":"measured","ms":-1}}`),
              nonFinite: verdictLine(`{${PHASES},"check":{"_tag":"measured","ms":"Infinity"}}`),
              undeclared: verdictLine(`{${PHASES},"check":{"_tag":"zero"}}`),
              declared: verdictLine(`{${PHASES},"check":{"_tag":"measured","ms":0}}`),
            })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) => Effect.sync(() => refusalsOf(s.probes)),
        ),
        Then('only the measured zero is accepted')((s, expect) =>
          expect(s.outcomes).toEqual({
            negative: expect.stringMatching(/^refused:/),
            nonFinite: expect.stringMatching(/^refused:/),
            undeclared: expect.stringMatching(/^refused:/),
            declared: 'accepted: verdict',
          })
        ),
      ),
    )

    scenario(
      'A real Ignored and a real Killed mutant line each decode to the one mutantTested event kind',
      Gherkin.Do.pipe(
        Given('an Ignored mutant line naming its rule and a Killed mutant line')(
          'probes',
          () =>
            Effect.sync(() => ({
              ignored: mutantLine('Ignored', 'src/a.ts', COST, '"arid-logging: console.log"'),
              killed: mutantLine('Killed', 'src/a.ts', COST),
            })),
        ),
        When('each line is decoded through the wire codec and dispatched by its event kind')(
          'kinds',
          (s) =>
            Effect.forEach(
              Object.entries(s.probes),
              ([name, line]) =>
                S.decodeEffect(RunEvent.RunEventWireLine)(line).pipe(
                  Effect.map((event) =>
                    [
                      name,
                      RunEvent.RunEvent.guards.mutantTested(event) ? `mutantTested:${event.status}` : 'other',
                    ] as const
                  ),
                ),
            ).pipe(Effect.map((pairs): Record<string, string> => Object.fromEntries(pairs))),
        ),
        Then('both lines reach the mutantTested handler with their own status')((s, expect) =>
          expect(s.kinds).toEqual({ ignored: 'mutantTested:Ignored', killed: 'mutantTested:Killed' })
        ),
      ),
    )
  })
