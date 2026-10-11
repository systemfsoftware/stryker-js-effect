import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchSide } from '../bench-run.schema.js'
import {
  EnterpriseInstallBounded,
  EnterpriseInstallExact,
  LockfilePinsPartial,
  LockfilePinsResolved,
} from '../lockfile-pins.schema.js'
import { planEnterpriseInstall, PlanEnterpriseInstallCommand } from '../plan-enterprise-install.workflow.js'

describe('planEnterpriseInstall', () => {
  it.prop(
    '∀scp_ResolvedPins_≡ExactInstallWithNoBefore',
    { of: [BenchSide, S.NonEmptyString, LockfilePinsResolved], subject: planEnterpriseInstall },
    (subject, [side, cutoff, pins]) => {
      const plan = Result.getOrThrow(subject(PlanEnterpriseInstallCommand.make({ side, pins, cutoff })))
      return S.is(EnterpriseInstallExact)(plan) && !plan.argv.join(' ').includes('--before')
    },
  )

  it.prop(
    '∀scp_PartialPins_≡TheExactInstallBoundedByThatCutoffNamingTheWithheld',
    { of: [BenchSide, S.NonEmptyString, LockfilePinsPartial], subject: planEnterpriseInstall },
    (subject, [side, cutoff, pins]) => {
      const plan = Result.getOrThrow(subject(PlanEnterpriseInstallCommand.make({ side, pins, cutoff })))
      const exact = Result.getOrThrow(
        subject(
          PlanEnterpriseInstallCommand.make({ side, cutoff, pins: LockfilePinsResolved.make({ pins: pins.pins }) }),
        ),
      )
      return S.is(EnterpriseInstallBounded)(plan) &&
        Equal.equals(plan.argv, [...exact.argv, `--before=${cutoff}`]) &&
        Equal.equals(plan.withheld, { side, cutoff, names: pins.withheld })
    },
  )
})
