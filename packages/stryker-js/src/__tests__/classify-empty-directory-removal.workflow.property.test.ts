import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  classifyEmptyDirectoryRemoval,
  ClassifyEmptyDirectoryRemovalCommand,
  type EmptyDirectoryRemoval,
} from '../classify-empty-directory-removal.workflow.js'

const POSIX_NOT_EMPTY: Readonly<Record<string, true>> = { ENOTEMPTY: true, EEXIST: true }

type Removal = 'kept' | 'absent' | `failed:${string}`

const removalOf = (decision: EmptyDirectoryRemoval): Removal =>
  Match.value(decision).pipe(
    Match.tag('DirectoryKept', (): Removal => 'kept'),
    Match.tag('DirectoryAbsent', (): Removal => 'absent'),
    Match.tag('RemovalFailed', ({ code }): Removal => `failed:${code ?? '<none>'}`),
    Match.exhaustive,
  )

const expectedRemovalOf = (code: string | undefined): Removal =>
  code !== undefined && POSIX_NOT_EMPTY[code] === true
    ? 'kept'
    : code === 'ENOENT'
    ? 'absent'
    : `failed:${code ?? '<none>'}`

describe('classifyEmptyDirectoryRemoval', () => {
  it.prop(
    '∀c_ClassifyEmptyDirectoryRemoval_⊨NotEmptyKeepsMissingIsAbsentAnyOtherErrnoFailsCarryingIt',
    { of: [ClassifyEmptyDirectoryRemovalCommand], subject: classifyEmptyDirectoryRemoval },
    (subject, [command]) =>
      Option.contains(Option.map(Result.getSuccess(subject(command)), removalOf), expectedRemovalOf(command.code)),
  )
})
