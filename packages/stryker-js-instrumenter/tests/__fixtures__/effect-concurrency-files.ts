import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

export interface FixtureFile {
  readonly name: string
  readonly content: string
}

const FIXTURES_DIRECTORY = new URL('../../testResources/effect-concurrency/', import.meta.url).pathname

export const effectConcurrencyFixtureContent = (fileName: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) => fileSystem.readFileString(`${FIXTURES_DIRECTORY}${fileName}`))

export const effectConcurrencyFixtureFiles = Effect.flatMap(
  FileSystem.FileSystem,
  (fileSystem) =>
    Effect.flatMap(fileSystem.readDirectory(FIXTURES_DIRECTORY, { recursive: true }), (entries) =>
      Effect.forEach(
        entries.filter((entry) => entry.endsWith('.ts')).sort(),
        (entry) =>
          Effect.map(fileSystem.readFileString(`${FIXTURES_DIRECTORY}${entry}`), (content) => ({
            name: entry,
            content,
          })),
      )),
)
