import type { TestRunnerCapabilities } from '@systemfsoftware/stryker-js-plugin-interface'

export const vmRunnerName = 'vm'

export const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunnerCapabilities