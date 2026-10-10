import { Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'

export interface ReporterShape {
  readonly builtin: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
}

export class Reporter extends Context.Service<Reporter, ReporterShape>()(
  '@systemfsoftware/stryker-js/reporter.service/Reporter',
) {}
