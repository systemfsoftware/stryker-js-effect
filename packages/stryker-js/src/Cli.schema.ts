/**
 * What the CLI parser hands the dispatcher.
 *
 * A request never crosses a boundary: `makeStrykerCommand` builds one as an
 * object literal from flags Effect's CLI has already parsed and typed, and the
 * dispatcher reads it out of a `Ref` in the same process. Nothing decodes it, so
 * the base below exists only to derive the `_tag` member rather than to
 * hand-write it, and it is not exported.
 *
 * That non-export is load-bearing. The law generator walks every refinement
 * reachable from an *exported* schema, so the previous
 * `export const CliRequest = S.Union([...])` — whose `run` arm declared
 * `options: StrykerOptionsSchema` — pulled the entire option tree into the
 * generated suite, to prove things about a codec nobody runs.
 *
 * `options` is also PARTIAL, which is the substantive point the old schema got
 * wrong. These are only the options this invocation named on the command line;
 * `readConfig` later merges them onto the config file's values and the defaults.
 * Declaring the resolved `StrykerOptions` described a value this type never
 * holds, which is why its `Type` had to be discarded and patched by hand.
 */
import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'
export const CliCommandSchema = S.Literals(['run', 'merge-reports', 'serve', 'feedback', 'mcp'])
export type CliCommand = typeof CliCommandSchema.Type

export const ServeChannelSchema = S.Literals(['stdio', 'socket'])
export type ServeChannel = typeof ServeChannelSchema.Type

export const FeedbackJudgmentSchema = S.Literals(['useful', 'not-useful'])
export type FeedbackJudgment = typeof FeedbackJudgmentSchema.Type

const FeedbackRouteRequestSchema = S.TaggedStruct('feedback', {
  id: S.String,
  judgment: FeedbackJudgmentSchema,
  reason: S.optional(S.String),
})

export type FeedbackRouteRequest = S.Schema.Type<typeof FeedbackRouteRequestSchema>

const McpRouteRequestSchema = S.TaggedStruct('mcp', {})

export type McpRouteRequest = S.Schema.Type<typeof McpRouteRequestSchema>

const ServeRouteRequestSchema = S.TaggedStruct('serve', {
  channel: ServeChannelSchema,
  port: S.optional(S.Int),
  address: S.optional(S.String),
})

export type ServeRouteRequest = S.Schema.Type<typeof ServeRouteRequestSchema>

const RunRequestSchema = S.TaggedStruct('run', { survivors: S.Boolean, mutants: S.Array(S.String).pipe(S.optional) })

export type RunRequest = S.Schema.Type<typeof RunRequestSchema> & {
  readonly options: Options.PartialStrykerOptions
}

const MergeReportsRequestSchema = S.TaggedStruct('merge-reports', {
  parts: S.String,
  out: S.String,
  packages: S.optional(S.String),
})

export type MergeReportsRequest = S.Schema.Type<typeof MergeReportsRequestSchema>

const CompareRequestSchema = S.TaggedStruct('compare', {
  baseline: S.String,
  fresh: S.String,
  noise: S.optional(S.String),
})

export type CompareRequest = S.Schema.Type<typeof CompareRequestSchema>

const GateRequestSchema = S.TaggedStruct('gate', {
  baseline: S.String,
  updateBaseline: S.Boolean,
})

export type GateRequest = S.Schema.Type<typeof GateRequestSchema>

const AnnotateRequestSchema = S.TaggedStruct('annotate', {
  baseline: S.optional(S.String),
})

export type AnnotateRequest = S.Schema.Type<typeof AnnotateRequestSchema>

const PlanRequestSchema = S.TaggedStruct('plan', {
  targetSeconds: S.Finite,
  maxShards: S.optional(S.Int),
  projects: S.Array(S.String).pipe(S.optional),
  out: S.optional(S.String),
  full: S.Boolean,
})

export type PlanRequest = S.Schema.Type<typeof PlanRequestSchema>

export type CliRequest =
  | RunRequest
  | MergeReportsRequest
  | CompareRequest
  | GateRequest
  | AnnotateRequest
  | PlanRequest
  | ServeRouteRequest
  | FeedbackRouteRequest
  | McpRouteRequest

export class CliRouteCommand extends S.TaggedClass<CliRouteCommand>()('CliRouteCommand', {
  route: S.Union([
    S.TaggedStruct('help', {}),
    MergeReportsRequestSchema,
    RunRequestSchema,
    CompareRequestSchema,
    GateRequestSchema,
    AnnotateRequestSchema,
    PlanRequestSchema,
    ServeRouteRequestSchema,
    FeedbackRouteRequestSchema,
    McpRouteRequestSchema,
  ]),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
