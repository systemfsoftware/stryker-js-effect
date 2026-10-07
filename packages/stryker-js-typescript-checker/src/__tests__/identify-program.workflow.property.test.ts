import { describe } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { identifyProgram, IdentifyProgramCommand, ProgramIdentified } from '../identify-program.workflow.js'
import { type ProgramFile } from '../program-digest.schema.js'

const keyOf = (command: IdentifyProgramCommand): string | undefined =>
  Result.match(identifyProgram(command), {
    onFailure: () => undefined,
    onSuccess: (identity) => S.is(ProgramIdentified)(identity) ? identity.key : undefined,
  })

const sourceFile = (fileName: string, digest: string): ProgramFile => ({ fileName, digest })

const seedFile = sourceFile('/project/src/seed.ts', 'seed-digest')

interface Overrides {
  readonly typescriptVersion?: string
  readonly checkerVersion?: string
  readonly checkerOptionsJson?: string
  readonly sourceFiles?: ReadonlyArray<ProgramFile>
  readonly tsconfigs?: ReadonlyArray<ProgramFile>
}

const rebuild = (command: IdentifyProgramCommand, overrides: Overrides): IdentifyProgramCommand =>
  IdentifyProgramCommand.make({
    typescriptVersion: overrides.typescriptVersion ?? command.typescriptVersion,
    checkerVersion: overrides.checkerVersion ?? command.checkerVersion,
    checkerOptionsJson: overrides.checkerOptionsJson ?? command.checkerOptionsJson,
    sourceFiles: [...(overrides.sourceFiles ?? command.sourceFiles)],
    tsconfigs: [...(overrides.tsconfigs ?? command.tsconfigs)],
  })

const seeded = (command: IdentifyProgramCommand): IdentifyProgramCommand =>
  rebuild(command, { sourceFiles: [seedFile, ...command.sourceFiles] })

describe('identifyProgram', (it) => {
  it.prop(
    '∀command_PermutedFiles_≡SameProgramKey',
    { of: [IdentifyProgramCommand], subject: keyOf },
    (subject, [command]) =>
      Equal.equals(
        subject(command),
        subject(
          rebuild(command, {
            sourceFiles: Arr.reverse([...command.sourceFiles]),
            tsconfigs: Arr.reverse([...command.tsconfigs]),
          }),
        ),
      ),
  )

  it.prop(
    '∀command_TypeScriptVersion_≡MovesTheProgramKey',
    { of: [IdentifyProgramCommand], subject: keyOf },
    (subject, [command]) =>
      !Equal.equals(
        subject(seeded(command)),
        subject(rebuild(seeded(command), { typescriptVersion: `${command.typescriptVersion}~` })),
      ),
  )

  it.prop(
    '∀command_CheckerVersion_≡MovesTheProgramKey',
    { of: [IdentifyProgramCommand], subject: keyOf },
    (subject, [command]) =>
      !Equal.equals(
        subject(seeded(command)),
        subject(rebuild(seeded(command), { checkerVersion: `${command.checkerVersion}~` })),
      ),
  )

  it.prop(
    '∀command_CheckerOptions_≡MovesTheProgramKey',
    { of: [IdentifyProgramCommand], subject: keyOf },
    (subject, [command]) =>
      !Equal.equals(
        subject(seeded(command)),
        subject(
          rebuild(seeded(command), {
            checkerOptionsJson: `{"typescriptChecker":${JSON.stringify(command.checkerOptionsJson)}}`,
          }),
        ),
      ),
  )

  it.prop(
    '∀command_AddedSourceFile_≡MovesTheProgramKey',
    { of: [IdentifyProgramCommand], subject: keyOf },
    (subject, [command]) =>
      !Equal.equals(
        subject(seeded(command)),
        subject(rebuild(seeded(command), { sourceFiles: [...command.sourceFiles, seedFile, seedFile] })),
      ),
  )

  it.prop(
    '∀command_ChangedTsconfig_≡MovesTheProgramKey',
    { of: [IdentifyProgramCommand], subject: keyOf },
    (subject, [command]) =>
      !Equal.equals(
        subject(seeded(command)),
        subject(rebuild(seeded(command), { tsconfigs: [...command.tsconfigs, seedFile] })),
      ),
  )

  it.prop(
    '∀command_NoSourceFiles_≡Unidentified',
    { of: [IdentifyProgramCommand], subject: keyOf },
    (subject, [command]) => subject(rebuild(command, { sourceFiles: [] })) === undefined,
  )
})
