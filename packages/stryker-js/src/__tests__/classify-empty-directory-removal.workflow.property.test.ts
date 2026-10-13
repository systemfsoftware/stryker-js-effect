import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifyEmptyDirectoryRemoval,
  ClassifyEmptyDirectoryRemovalCommand,
  type EmptyDirectoryRemoval,
  RemovalFailed,
} from '../classify-empty-directory-removal.workflow.js'

type RemovalArm = 'kept' | 'absent' | 'failed'

const ERRNO_ARM_ORACLE: Readonly<Record<string, RemovalArm>> = {
  ENOTEMPTY: 'kept',
  EEXIST: 'kept',
  ENOTDIR: 'kept',
  ENOENT: 'absent',
}

const ERRNO_CODES = ['ENOTEMPTY', 'EEXIST', 'ENOTDIR', 'ENOENT', 'EISDIR', 'EACCES', 'EPERM', 'EBUSY', 'ELOOP'] as const

const errnoArb = Arbitrary.schema(S.Union([S.Literals(ERRNO_CODES), S.UndefinedOr(S.String)]))

const armOf = (decision: EmptyDirectoryRemoval): RemovalArm =>
  Match.value(decision).pipe(
    Match.tag('DirectoryKept', (): RemovalArm => 'kept'),
    Match.tag('DirectoryAbsent', (): RemovalArm => 'absent'),
    Match.tag('RemovalFailed', (): RemovalArm => 'failed'),
    Match.exhaustive,
  )

const oracleArmOf = (code: string | undefined): RemovalArm =>
  code === undefined ? 'failed' : ERRNO_ARM_ORACLE[code] ?? 'failed'

const matchesOracle = (subject: typeof classifyEmptyDirectoryRemoval, code: string | undefined): boolean => {
  const decision = subject(ClassifyEmptyDirectoryRemovalCommand.make({ code })).pipe(
    Result.getOrElse((neverError) => neverError),
  )
  return armOf(decision) === oracleArmOf(code) && (!S.is(RemovalFailed)(decision) || decision.code === code)
}

describe('classifyEmptyDirectoryRemoval', () => {
  it.prop(
    '∀c_ClassifyEmptyDirectoryRemoval_⊨EveryErrnoLandsOnlyInItsKeptAbsentOrFailedArm',
    { of: [errnoArb], subject: classifyEmptyDirectoryRemoval },
    (subject, [code]) => matchesOracle(subject, code),
  )
})
