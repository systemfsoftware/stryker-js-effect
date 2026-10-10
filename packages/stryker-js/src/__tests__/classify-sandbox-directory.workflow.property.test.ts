import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifySandboxDirectory,
  SandboxDirectoryCommand,
  type SandboxDirectoryRole,
} from '../classify-sandbox-directory.workflow.js'

type Role = 'skipped' | 'nodeModules' | 'searchable'

const roleOf = (decision: SandboxDirectoryRole): Role =>
  Match.value(decision).pipe(
    Match.tag('DirectorySkipped', (): Role => 'skipped'),
    Match.tag('NodeModulesDirectory', (): Role => 'nodeModules'),
    Match.tag('SearchableDirectory', (): Role => 'searchable'),
    Match.exhaustive,
  )

const expectedRoleOf = (command: SandboxDirectoryCommand): Role =>
  command.name === command.tempDirName ? 'skipped' : command.name === 'node_modules' ? 'nodeModules' : 'searchable'

const classified = (subject: typeof classifySandboxDirectory, command: SandboxDirectoryCommand) =>
  Option.map(Result.getSuccess(subject(command)), roleOf)

describe('classifySandboxDirectory', () => {
  it.prop(
    '∀c_ClassifySandboxDirectory_⊨TempDirBeforeNodeModulesBeforeSearchable',
    { of: [SandboxDirectoryCommand], subject: classifySandboxDirectory },
    (subject, [command]) => Option.contains(classified(subject, command), expectedRoleOf(command)),
  )

  it.prop(
    '∀c_ClassifySandboxDirectory_⊨DirectoryNamedLikeTheTempDirIsSkippedEvenWhenNamedNodeModules',
    { of: [SandboxDirectoryCommand, S.Boolean], subject: classifySandboxDirectory },
    (subject, [command, namedNodeModules]) => {
      const name = namedNodeModules ? 'node_modules' : command.name
      return Option.contains(classified(subject, SandboxDirectoryCommand.make({ name, tempDirName: name })), 'skipped')
    },
  )
})
