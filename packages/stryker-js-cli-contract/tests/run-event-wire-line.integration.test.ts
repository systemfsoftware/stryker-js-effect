import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const RUN_ID = '01J0Z0Z0Z0Z0Z0Z0Z0Z0Z0Z0Z0'

const LOCATION = '"location":{"start":{"line":1,"column":1},"end":{"line":1,"column":2}}'

const COST = '{"fixedOverheadMs":1,"testBodyMs":2,"testsExecuted":1,"shared":false}'

const mutantLine = (status: string, file: string | null, cost: string): string =>
  `{"_tag":"mutant","id":"0000000000000001","status":"${status}",${
    file === null ? '' : `"file":"${file}",`
  }${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false,"cost":${cost}}`

const wireLines = (): Record<string, string> => ({
  stream: `{"_tag":"stream","schemaVersion":"2.0","runId":"${RUN_ID}","mode":"machine","signal":"flag"}`,
  phase: '{"_tag":"phase","phase":"prepare","elapsedMs":1}',
  plan: '{"_tag":"plan","total":3}',
  mutant: mutantLine('Killed', 'src/a.ts', COST),
  tick: '{"_tag":"tick","elapsedMs":1,"completed":1,"total":null}',
  plugins: '{"_tag":"plugins","modules":[],"shadowings":[]}',
  formats: '{"_tag":"formats","rows":[]}',
  skipped: '{"_tag":"skipped","files":[]}',
  reuse:
    '{"_tag":"reuse","reused":1,"ran":2,"refused":{"semanticsChanged":0,"policyChanged":0,"runInputsChanged":0,"closureChanged":1,"timeoutUnreproduced":0,"flakyDependency":0,"noPriorRecord":1}}',
  mutantDetail:
    '{"_tag":"mutant-detail","id":"0000000000000001","status":"Survived","coveringTests":["suite.test.ts::kills"],"killedBy":null,"reproducer":"stryker run --mutant 0000000000000001"}',
  feedback: '{"_tag":"feedback","id":"0000000000000001","judgment":"useful","reason":null}',
  verdict:
    `{"_tag":"verdict","schemaVersion":"2.0","runId":"${RUN_ID}","mode":"machine","signal":"flag","score":null,"thresholds":{"high":80,"low":60,"break":null},"reportFile":null,"counts":{"pending":0,"killed":1,"timeout":0,"survived":0,"noCoverage":1,"runtimeErrors":0,"compileErrors":0,"ignored":0},"mutants":[],"scope":"full","mutantSetPolicy":"full","phaseDurations":null,"static":null}`,
  error: '{"_tag":"error","schemaVersion":"2.0","code":2,"error":"boom","remediation":"fix it","reason":null}',
  help: '{"_tag":"help","schemaVersion":"2.0","code":0,"help":"usage"}',
})

const refusalOf = (line: string): string => {
  const decoded = S.decodeResult(RunEvent.RunEventWireLine)(line)
  return Result.isSuccess(decoded) ? `accepted: ${decoded.success._tag}` : `refused: ${decoded.failure.message}`
}

const encodedOf = (line: string) =>
  Effect.gen(function*() {
    const decoded = yield* S.decodeEffect(RunEvent.RunEventWireLine)(line)
    return yield* S.encodeEffect(RunEvent.RunEventWireLine)(decoded)
  })

const encodeAll = (lines: Record<string, string>) =>
  Effect.forEach(
    Object.entries(lines),
    ([kind, line]) => Effect.map(encodedOf(line), (encoded) => [kind, encoded] as const),
  ).pipe(
    Effect.map((entries) => Object.fromEntries(entries)),
  )

const refusalsOf = (probes: Record<string, string>): Record<string, string> => {
  const outcomes: Record<string, string> = {}
  for (const [name, line] of Object.entries(probes)) outcomes[name] = refusalOf(line)
  return outcomes
}

Feature('The machine-stream wire codec carries every declared event kind')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'Every event kind decodes from its wire line and re-encodes to the same document, newline terminated',
      Gherkin.Do.pipe(
        Given('one wire line for each declared event kind')(
          'lines',
          () => Effect.sync(wireLines),
        ),
        When('each line is decoded and re-encoded through the wire codec')(
          'encoded',
          (s) => encodeAll(s.lines),
        ),
        Then('every kind comes back as the same line, terminated by a newline')((s, expect) => {
          const expected: Record<string, string> = {}
          for (const [kind, line] of Object.entries(wireLines())) expected[kind] = `${line}\n`
          return expect(s.encoded).toEqual(expected)
        }),
      ),
    )

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
                `{"_tag":"mutant","id":"0000000000000001","status":"Killed","file":"src/a.ts",${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false}`,
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
  })
