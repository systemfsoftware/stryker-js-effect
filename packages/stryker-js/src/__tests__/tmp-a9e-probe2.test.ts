import { describe, it } from 'vitest'
import { appendFileSync } from 'node:fs'

import { Admitted, SurvivorsAdmission } from '../admit-survivors-run.workflow.js'
import * as S from 'effect/Schema'

const out = (...line: readonly unknown[]) => appendFileSync('/tmp/a9e-probe.log', `${line.join(' ')}\n`)

const base = {
  id: 'a',
  fileName: '/work/!',
  mutatorName: 'm',
  replacement: 'r',
  location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
}

describe('decode probes', () => {
  it('without extra key', () => {
    const exit = S.decodeExit(SurvivorsAdmission)({ _tag: 'Admitted', survivors: [base] })
    out('no-extra:', exit._tag, JSON.stringify(exit, (_k, v) => typeof v === 'bigint' ? String(v) : v))
  })

  it('with extra key', () => {
    const exit = S.decodeExit(SurvivorsAdmission)({
      _tag: 'Admitted',
      survivors: [{ ...base, relativeFileName: '!' }],
    })
    out('extra:', exit._tag, JSON.stringify(exit, (_k, v) => typeof v === 'bigint' ? String(v) : v))
  })

  it('with extra key via decodeUnknownExit', () => {
    const exit = S.decodeUnknownExit(SurvivorsAdmission)({
      _tag: 'Admitted',
      survivors: [{ ...base, relativeFileName: '!' }],
    })
    out('unknown-extra:', exit._tag, JSON.stringify(exit, (_k, v) => typeof v === 'bigint' ? String(v) : v))
  })

  it('admitted type id', () => {
    out('admitted keys:', String(Object.keys(Admitted.make({ survivors: [], mutateSpans: [] }))))
  })
})
