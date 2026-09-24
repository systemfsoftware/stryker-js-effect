import { writeFileSync } from 'node:fs'
import { it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

import { WorkerOptionsWire } from './worker-options.schema.js'

const encode = S.encodeResult(WorkerOptionsWire)
const decode = S.decodeResult(WorkerOptionsWire)

const firstDiff = (left: string, right: string): string => {
  const index = [...left].findIndex((char, position) => char !== right[position])
  const at = index === -1 ? Math.min(left.length, right.length) : index
  return left === right ? '' : `@${at} FIRST ${left.slice(Math.max(0, at - 150), at + 150)} SECOND ${right.slice(Math.max(0, at - 150), at + 150)}`
}

it.prop('probe', [WorkerOptionsWire], ([value]) => {
  const first = Option.getOrElse(Result.getSuccess(encode(value)), () => '<none>')
  const second = Option.getOrElse(Result.getSuccess(Result.flatMap(Result.flatMap(encode(value), decode), encode)), () => '<none>')
  if (first !== second) writeFileSync('/tmp/refactor/probe-pair.json', JSON.stringify({ first, second, value }))
  expect(firstDiff(first, second), firstDiff(first, second)).toBe('')
}, { arbitrary: { runs: 3000 } })
