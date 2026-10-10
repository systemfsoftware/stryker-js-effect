import type { JsonValue } from '@std/jsonc'
import { parse } from '@std/jsonc'
import { type Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as S from 'effect/Schema'

import { ProjectFiles } from './project-files.service.js'
import type { Project, ProjectFile } from './Project.schema.js'
import { rewriteSandboxTsconfig, RewriteSandboxTsconfigCommand } from './rewrite-sandbox-tsconfig.workflow.js'
import { referencedEntriesOf, type TSConfig, TsConfigSchema } from './Sandbox.schema.js'
import { StrykerError } from './stryker-error.schema.js'

export interface SandboxTsconfigInput {
  readonly project: Project
  readonly fileName: string
  readonly basePath: string
}

const parseJsonText = (jsonText: string): Effect.Effect<JsonValue, string> =>
  Effect.try({
    try: () => parse(jsonText.replace(/^\uFEFF/, '')),
    catch: (cause) => Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

const parseTsConfig = (jsonText: string): Effect.Effect<TSConfig, string> =>
  Effect.flatMap(parseJsonText(jsonText), (parsed) =>
    Effect.fromOption(
      Option.filter(Option.some(parsed), S.is(TsConfigSchema)),
      () => `parsed to ${JSON.stringify(parsed)}, which does not match the tsconfig shape this package consumes`,
    ))

const relativeToBasePathOf = (config: TSConfig, input: SandboxTsconfigInput, pathService: Path.Path) =>
  HashMap.fromIterable(
    Arr.map(referencedEntriesOf(config), (entry) =>
      [
        entry,
        pathService.relative(input.basePath, pathService.resolve(pathService.dirname(input.fileName), entry)),
      ] as const),
  )

const tsconfigOf = (content: string, input: SandboxTsconfigInput, pathService: Path.Path) =>
  Effect.match(parseTsConfig(content), {
    onFailure: (reason): typeof RewriteSandboxTsconfigCommand.Encoded['tsconfig'] => ({
      _tag: 'TsconfigUnparsable',
      reason,
    }),
    onSuccess: (config): typeof RewriteSandboxTsconfigCommand.Encoded['tsconfig'] => ({
      _tag: 'TsconfigParsed',
      config,
      relativeToBasePath: relativeToBasePathOf(config, input, pathService),
    }),
  })

const readSandboxTsconfig = Effect.fnUntraced(function*(input: SandboxTsconfigInput) {
  const pathService = yield* Path.Path
  const files = yield* ProjectFiles
  const file = Option.fromUndefinedOr(input.project.files.get(input.fileName))
  const tsconfig = yield* Option.match(file, {
    onNone: () => Effect.succeed<typeof RewriteSandboxTsconfigCommand.Encoded['tsconfig']>({ _tag: 'TsconfigMissing' }),
    onSome: (present) => Effect.flatMap(files.read(present), (content) => tsconfigOf(content, input, pathService)),
  })
  return { _tag: 'RewriteSandboxTsconfigCommand' as const, tsconfig, input, file }
})

export interface SandboxTsconfigRewrite {
  readonly rewritten: Option.Option<ProjectFile>
  readonly follow: ReadonlyArray<string>
}

const unchanged: SandboxTsconfigRewrite = { rewritten: Option.none(), follow: [] }

export const sandboxTsconfigCell: Cell.Cell<
  SandboxTsconfigInput,
  SandboxTsconfigRewrite,
  PlatformError | StrykerError,
  Path.Path | ProjectFiles
> = Sandwich.named(SpanTaxonomy.Spans.sandboxTsconfigRewriteFileArrays.name)(readSandboxTsconfig)
  .decide(rewriteSandboxTsconfig)
  .write({
    TsconfigSkipped: () => Effect.succeed(unchanged),
    TsconfigKept: ({ reason }, raw) =>
      Effect.as(
        Effect.logWarning(
          `Could not rewrite tsconfig file "${raw.input.fileName}": ${reason}. Its extends, project references, and file array properties were not rewritten for the sandbox, so this file still points at paths outside it.`,
        ),
        unchanged,
      ),
    TsconfigRewritten: ({ config, follow }, raw) =>
      Effect.gen(function*() {
        const pathService = yield* Path.Path
        const content = yield* S.encodeEffect(S.fromJsonString(TsConfigSchema, { space: 2 }))(config).pipe(Effect.orDie)
        return {
          rewritten: Option.map(raw.file, (present) => ({ ...present, content })),
          follow: Arr.map(follow, (entry) => pathService.resolve(pathService.dirname(raw.input.fileName), entry)),
        }
      }),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `Could not decide the sandbox rewrite of a tsconfig file: ${issue}` })),
  })
