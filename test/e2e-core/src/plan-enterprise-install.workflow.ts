import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchSide } from './bench-run.schema.js'
import {
  EnterpriseInstall,
  EnterpriseInstallBounded,
  EnterpriseInstallExact,
  LockfilePins,
} from './lockfile-pins.schema.js'

export class PlanEnterpriseInstallCommand
  extends S.TaggedClass<PlanEnterpriseInstallCommand>()('PlanEnterpriseInstallCommand', {
    side: BenchSide,
    pins: LockfilePins,
    cutoff: S.NonEmptyString,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const NPM_INSTALL_ARGV = ['npm', 'install', '--no-audit', '--no-fund', '--loglevel=warn'] as const

const planOf = (command: PlanEnterpriseInstallCommand): EnterpriseInstall =>
  Match.valueTags(command.pins, {
    LockfilePinsResolved: (): EnterpriseInstall => EnterpriseInstallExact.make({ argv: [...NPM_INSTALL_ARGV] }),
    LockfilePinsPartial: (partial): EnterpriseInstall =>
      EnterpriseInstallBounded.make({
        argv: [...NPM_INSTALL_ARGV, `--before=${command.cutoff}`],
        withheld: { side: command.side, cutoff: command.cutoff, names: partial.withheld },
      }),
  })

const decide = (command: PlanEnterpriseInstallCommand): Result.Result<EnterpriseInstall, never> =>
  Result.succeed(planOf(command))

export const planEnterpriseInstall = Workflow.make({
  command: PlanEnterpriseInstallCommand,
  decision: EnterpriseInstall,
  error: S.Never,
  decide,
})
