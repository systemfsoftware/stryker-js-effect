import { describe, it } from 'vitest'
import { appendFileSync } from 'node:fs'

import {
  admitSurvivorsRun,
  AdmitSurvivorsRunCommand,
  Admitted,
  MutantShape,
  PriorReportFacts,
} from '../admit-survivors-run.workflow.js'
import * as S from 'effect/Schema'
import * as Result from 'effect/Result'

const out = (line: string) => appendFileSync('/tmp/a9e-probe.log', `${line}\n`)

const survivor = {
  id: 'a',
  fileName: '/work/!',
  relativeFileName: '!',
  mutatorName: 'm',
  replacement: 'r',
  location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
}

describe('probes', () => {
  it('command make keeps relativeFileName', () => {
    const command = AdmitSurvivorsRunCommand.make({
      priorReport: undefined,
      currentConfig: {},
      frameworkVersion: 'v',
      sourceContentHashes: {},
      priorSourceHashes: {},
      priorSurvivors: [survivor],
    })
    console.log('command.priorSurvivors[0]:', JSON.stringify(command.priorSurvivors[0]))
  })

  it('tagged struct make strips unknown keys', () => {
    const Probe = S.TaggedStruct('P', { survivors: S.Array(MutantShape) })
    const made = Probe.make({ survivors: [survivor] })
    console.log('probe survivors[0]:', JSON.stringify((made as any).survivors[0]))
  })

  it('admitted make strips', () => {
    const made = Admitted.make({ survivors: [survivor], mutateSpans: ['x'] })
    console.log('admitted survivors[0]:', JSON.stringify(made.survivors[0]))
  })

  it('end to end', () => {
    const command = AdmitSurvivorsRunCommand.make({
      priorReport: PriorReportFacts.make({ config: {}, frameworkVersion: 'v' }),
      currentConfig: {},
      frameworkVersion: 'v',
      sourceContentHashes: { '!': 'h' },
      priorSourceHashes: { '!': 'h' },
      priorSurvivors: [survivor],
    })
    const admission = admitSurvivorsRun(command)
    if (Result.isSuccess(admission)) {
      console.log('e2e mutateSpans:', JSON.stringify(admission.success.mutateSpans))
    } else {
      console.log('e2e rejected:', admission.failure.reason)
    }
  })
})
