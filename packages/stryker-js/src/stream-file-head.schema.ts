import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as S from 'effect/Schema'

export const StreamFileFirstLine = S.Union([RunEvent.RunEventWireLine, S.fromJsonString(S.TaggedStruct('stream', {}))])
