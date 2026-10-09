import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'

export class WorkerOptions extends Context.Service<WorkerOptions, Options.StrykerOptions>()(
  '@systemfsoftware/stryker-js-plugin-runtime/worker-options.service/WorkerOptions',
) {}
