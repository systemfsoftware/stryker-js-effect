import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'

export const vmRunnerName = 'vm'

const VM_RUNNER_SPECIFIER = '@systemfsoftware/stryker-js-vm-runner'

export const vmRunnerOptions = { pool: 'threads' } as const

export const vmRunnerPluginUrl = (): string => import.meta.resolve(VM_RUNNER_SPECIFIER)

export const isVmRunner = (name: Options.TestRunnerConfig): name is typeof vmRunnerName =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export const vmTestRunnerConfig = (): Options.TestRunnerCustomConfig => ({
  plugin: vmRunnerPluginUrl(),
  options: { ...vmRunnerOptions },
})

export const testRunnerConfigOf = (configured: Options.TestRunnerConfig): Options.TestRunnerConfig =>
  Match.value(configured).pipe(
    Match.when(isVmRunner, vmTestRunnerConfig),
    Match.orElse((unchanged) => unchanged),
  )
