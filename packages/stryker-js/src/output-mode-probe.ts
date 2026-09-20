import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as CliError from 'effect/unstable/cli/CliError'

import {
  type ModeConflictError,
  ResolveModeCommand,
  type ResolveModeDecision,
  resolveOutputMode,
} from './resolve-output-mode.workflow.js'

export interface ResolvedMode {
  readonly mode: 'machine' | 'human'
  readonly signal: 'flag' | 'env' | 'tty' | 'agent' | 'tool'
  readonly stdoutIsTTY: boolean
}

export const TOOL_VARIABLES = ['CLAUDECODE', 'CODEX_SANDBOX'] as const

export type ToolVariable = (typeof TOOL_VARIABLES)[number]

export interface FormatFlags {
  readonly text?: boolean
  readonly json?: boolean
}

export interface ModeInput extends FormatFlags {
  readonly envMode?: string
  readonly stdoutIsTTY: boolean
  readonly agent?: string
  readonly toolVars?: Readonly<Partial<Record<ToolVariable, string | undefined>>>
}

const decisionToResolvedMode = (decision: ResolveModeDecision): ResolvedMode =>
  Match.value(decision).pipe(
    Match.tag(
      'HumanOutput',
      (human): ResolvedMode => ({
        mode: 'human',
        signal: human.signal,
        stdoutIsTTY: human.stdoutIsTTY,
      }),
    ),
    Match.tag(
      'MachineOutput',
      (machine): ResolvedMode => ({
        mode: 'machine',
        signal: machine.signal,
        stdoutIsTTY: machine.stdoutIsTTY,
      }),
    ),
    Match.exhaustive,
  )

interface ProbeInput {
  readonly stdoutIsTTY: boolean
  readonly text?: boolean | undefined
  readonly json?: boolean | undefined
  readonly envMode?: string | undefined
  readonly agent?: string | undefined
  readonly toolVars?: Readonly<Record<string, string | undefined>> | undefined
}

const definedToolVars = (
  vars: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(vars ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

const commandFor = (input: ProbeInput): ResolveModeCommand =>
  ResolveModeCommand.make({
    stdoutIsTTY: input.stdoutIsTTY,
    text: input.text,
    json: input.json,
    envMode: input.envMode,
    agent: input.agent,
    toolVars: definedToolVars(input.toolVars),
  })

export function resolveMode(
  input: ModeInput,
): Result.Result<ResolvedMode, CliError.CliError> {
  return Result.match(resolveOutputMode(commandFor(input)), {
    onFailure: (conflict) =>
      Result.fail(
        CliError.InvalidValue.make({
          option: conflict.option,
          value: conflict.value,
          expected: conflict.expected,
          kind: 'flag',
        }),
      ),
    onSuccess: (decision) => Result.succeed(decisionToResolvedMode(decision)),
  })
}

export function isProgressEnabled(resolved: ResolvedMode): boolean {
  return resolved.mode === 'human' && resolved.stdoutIsTTY
}

export function isColorEnabled(
  resolved: ResolvedMode,
  noColor: string | undefined,
): boolean {
  const requested = Option.exists(
    Option.fromUndefinedOr(noColor),
    S.is(S.NonEmptyString),
  )
  return resolved.mode === 'human' && !requested
}

export interface OutputModeProbe {
  readonly detectMode: Effect.Effect<ResolvedMode, CliError.CliError>
}

class OutputModeProbeTag extends Context.Service<
  OutputModeProbeTag,
  OutputModeProbe
>()('@systemfsoftware/stryker-js/output-mode-probe/OutputModeProbeTag') {}

const OutputModeProbe = OutputModeProbeTag

export { OutputModeProbe }

const envToolVars = (): Effect.Effect<Record<string, string>> =>
  Effect.forEach(TOOL_VARIABLES, (variable) =>
    Config.string(variable).pipe(
      Effect.option,
      Effect.map((value) => [variable, Option.getOrUndefined(value)] as const),
    )).pipe(Effect.map((entries) => definedToolVars(Object.fromEntries(entries))))

const probeInput = (
  command: FormatFlags,
): Effect.Effect<ProbeInput, never, Stdio.Stdio> =>
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    const envMode = yield* Config.string('STRYKER_MODE').pipe(Effect.option)
    const agent = yield* Config.string('AGENT').pipe(Effect.option)
    return {
      stdoutIsTTY: yield* stdio.stdoutIsTerminal,
      text: command.text,
      json: command.json,
      envMode: Option.getOrUndefined(envMode),
      agent: Option.getOrUndefined(agent),
      toolVars: yield* envToolVars(),
    }
  })

export const outputModeProbeCell = Cell.layer({
  read: (command: FormatFlags) => probeInput(command),
  decode: (raw: ProbeInput) => Result.succeed(commandFor(raw)),
  decide: resolveOutputMode,
  encode: (outcome: Result.Result<ResolveModeDecision, ModeConflictError>) =>
    Result.map(outcome, decisionToResolvedMode),
  write: (outcome) =>
    Result.match(outcome, {
      onFailure: (error) => Effect.fail(error),
      onSuccess: (mode) => Effect.succeed(mode),
    }),
})

export const detectModeWithProbe = (
  flags: FormatFlags = {},
): Effect.Effect<ResolvedMode, CliError.CliError, Stdio.Stdio> =>
  outputModeProbeCell.run(flags).pipe(
    Effect.mapError((error) =>
      CliError.InvalidValue.make({
        option: error.option,
        value: error.value,
        expected: error.expected,
        kind: 'flag',
      })
    ),
  )

export const OutputModeProbeLive: Layer.Layer<
  OutputModeProbeTag,
  never,
  Stdio.Stdio
> = Layer.effect(
  OutputModeProbe,
  Effect.map(Stdio.Stdio, (stdio) =>
    OutputModeProbe.of({
      detectMode: Effect.provideService(
        detectModeWithProbe({}),
        Stdio.Stdio,
        stdio,
      ),
    })),
)
