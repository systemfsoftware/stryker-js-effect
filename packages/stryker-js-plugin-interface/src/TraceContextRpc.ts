import type { Schema } from 'effect'
import * as Context from 'effect/Context'
import * as Option from 'effect/Option'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcMiddleware from 'effect/unstable/rpc/RpcMiddleware'

import type { TraceContextParts } from './TraceContext.js'

export class PropagatedTrace extends Context.Service<PropagatedTrace, Option.Option<TraceContextParts>>()(
  '@systemfsoftware/stryker-js-plugin-interface/PropagatedTrace',
) {}

export class TraceContextMiddleware extends RpcMiddleware.Service<
  TraceContextMiddleware,
  { provides: typeof PropagatedTrace }
>()('@systemfsoftware/stryker-js-plugin-interface/TraceContextMiddleware', { requiredForClient: true }) {}

export type TracedRpc<
  Tag extends string,
  Payload extends Schema.Top = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never,
> = Rpc.Rpc<
  Tag,
  Payload,
  Success,
  Error,
  typeof TraceContextMiddleware,
  RpcMiddleware.ApplyServices<typeof TraceContextMiddleware['Identifier'], never>
>
