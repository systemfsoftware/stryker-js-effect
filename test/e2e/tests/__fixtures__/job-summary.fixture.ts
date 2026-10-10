import { Config, Effect, FileSystem, Option } from 'effect'

export const publishToJobSummary = (title: string, lines: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const summaryPath = yield* Config.option(Config.String('GITHUB_STEP_SUMMARY'))
    const text = [`### ${title}`, '', ...lines, ''].join('\n')
    yield* Effect.logInfo(text)
    yield* Option.match(summaryPath, {
      onNone: () => Effect.void,
      onSome: (path) => fs.writeFileString(path, `${text}\n`, { flag: 'a' }),
    })
  })
