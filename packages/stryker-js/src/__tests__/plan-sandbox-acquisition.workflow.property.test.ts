import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  planSandboxAcquisition,
  SandboxAcquisitionCommand,
  type SandboxAcquisitionPlan,
} from '../plan-sandbox-acquisition.workflow.js'

const restores = (plan: SandboxAcquisitionPlan): boolean =>
  Match.value(plan).pipe(
    Match.tag('SandboxInPlaceRestored', () => true),
    Match.tag('SandboxInPlaceUnrestored', 'SandboxCopiedLinked', 'SandboxCopiedUnlinked', () => false),
    Match.exhaustive,
  )

const links = (plan: SandboxAcquisitionPlan): boolean =>
  Match.value(plan).pipe(
    Match.tag('SandboxCopiedLinked', () => true),
    Match.tag('SandboxInPlaceRestored', 'SandboxInPlaceUnrestored', 'SandboxCopiedUnlinked', () => false),
    Match.exhaustive,
  )

const overwrites = (plan: SandboxAcquisitionPlan): boolean =>
  Match.value(plan).pipe(
    Match.tag('SandboxInPlaceRestored', 'SandboxInPlaceUnrestored', () => true),
    Match.tag('SandboxCopiedLinked', 'SandboxCopiedUnlinked', () => false),
    Match.exhaustive,
  )

const holds = (
  subject: typeof planSandboxAcquisition,
  command: SandboxAcquisitionCommand,
  law: (plan: SandboxAcquisitionPlan) => boolean,
): boolean => Option.exists(Result.getSuccess(subject(command)), law)

describe('planSandboxAcquisition', () => {
  it.prop(
    '∀c_PlanSandboxAcquisition_⊨OverwritesIffInPlace',
    { of: [SandboxAcquisitionCommand], subject: planSandboxAcquisition },
    (subject, [command]) => holds(subject, command, (plan) => overwrites(plan) === command.inPlace),
  )

  it.prop(
    '∀c_PlanSandboxAcquisition_⊨RestoresIffInPlaceWithBackup',
    { of: [SandboxAcquisitionCommand], subject: planSandboxAcquisition },
    (subject, [command]) =>
      holds(subject, command, (plan) => restores(plan) === (command.inPlace && command.backupDirectory !== '')),
  )

  it.prop(
    '∀c_PlanSandboxAcquisition_⊨LinksIffCopiedWithSymlinkedNodeModules',
    { of: [SandboxAcquisitionCommand], subject: planSandboxAcquisition },
    (subject, [command]) =>
      holds(subject, command, (plan) => links(plan) === (!command.inPlace && command.symlinkNodeModules)),
  )

  it.prop(
    '∀c_PlanSandboxAcquisition_⊨BuildsExactlyANonEmptyCommand',
    { of: [SandboxAcquisitionCommand], subject: planSandboxAcquisition },
    (subject, [command]) =>
      holds(
        subject,
        command,
        (plan) =>
          Option.getOrUndefined(plan.buildCommand) === (command.buildCommand === '' ? undefined : command.buildCommand),
      ),
  )
})
