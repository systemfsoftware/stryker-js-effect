import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const WorkerOptionsWire = S.fromJsonString(StrykerOptionsSchema)
