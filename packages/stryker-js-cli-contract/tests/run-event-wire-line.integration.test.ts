import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const LOCATION = '"location":{"start":{"line":1,"column":1},"end":{"line":1,"column":2}}'

const COST = '{"fixedOverheadMs":1,"testBodyMs":2,"testsExecuted":1,"shared":false}'

const WORKER = '{"_tag":"worker","schemaVersion":"7.0","role":"testRunner","index":0,"startupMs":12.5}'

const READS_NOWHERE = '"redundancy":null,"readmission":null'

const mutantLine = (status: string, file: string | null, cost: string): string =>
  `{"_tag":"mutant","id":"0000000000000001","status":"${status}",${
    file === null ? '' : `"file":"${file}",`
  }${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false,"cost":${cost},${READS_NOWHERE}}`

const SUBSUMED_LINE =
  `{"_tag":"mutant","id":"0000000000000001","status":"Ignored","file":"src/a.ts",${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false,"cost":${COST},"redundancy":{"_tag":"Subsumed","rule":"complement","dominators":["0000000000000002"]},"readmission":null}`

const subsumedReferenceOf = (line: string): string =>
  Result.match(S.decodeResult(RunEvent.RunEventWireLine)(line), {
    onFailure: (failure) => `refused: ${failure.message}`,
    onSuccess: (event) =>
      S.is(RunEvent.RunMutantTestedEvent)(event) && event.redundancy !== null
        ? `subsumedBy: ${event.redundancy.dominators[0]}`
        : 'noReference',
  })

const refusalOf = (line: string): string => {
  const decoded = S.decodeResult(RunEvent.RunEventWireLine)(line)
  return Result.isSuccess(decoded) ? `accepted: ${decoded.success._tag}` : `refused: ${decoded.failure.message}`
}

const refusalsOf = (probes: Record<string, string>): Record<string, string> => {
  const outcomes: Record<string, string> = {}
  for (const [name, line] of Object.entries(probes)) outcomes[name] = refusalOf(line)
  return outcomes
}

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
                `{"_tag":"mutant","id":"0000000000000001","status":"Killed","file":"src/a.ts",${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false,${READS_NOWHERE}}`,
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
      'A mutant line carries its subsumption reference while a line omitting the reference keys is refused',
      Gherkin.Do.pipe(
        Given('a mutant line naming a Subsumed reference and one omitting redundancy and readmission')(
          'probes',
          () =>
            Effect.sync(() => ({
              referenced: SUBSUMED_LINE,
              bare:
                `{"_tag":"mutant","id":"0000000000000001","status":"Ignored","file":"src/a.ts",${LOCATION},"mutator":"ArithmeticOperator","replacement":null,"completed":1,"total":3,"static":false,"cost":${COST}}`,
            })),
        ),
        When('each line is decoded through the wire codec')(
          'outcomes',
          (s) =>
            Effect.sync(() => ({
              referenced: subsumedReferenceOf(s.probes.referenced),
              bare: refusalOf(s.probes.bare),
            })),
        ),
        Then('the reference is read from the line and the line omitting the keys is refused')((s, expect) =>
          expect(s.outcomes).toEqual({
            referenced: 'subsumedBy: 0000000000000002',
            bare: expect.stringMatching(/^refused:[\s\S]*redundancy/),
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
  })
