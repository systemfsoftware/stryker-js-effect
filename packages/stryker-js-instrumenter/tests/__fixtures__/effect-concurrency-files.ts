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

const CONCURRENCY_SELECTION_FIXTURE_NAMES: readonly string[] = [
  'import-style-named.ts',
  'import-style-aliased.ts',
  'import-style-effect-namespace.ts',
  'import-style-module-namespace.ts',
  'import-style-bare-function.ts',
  'import-style-bare-function-no-binding.ts',
  'synchronization-removal.ts',
  'refusals.ts',
]

export const effectConcurrencySelectionFixtureFiles = Effect.forEach(
  CONCURRENCY_SELECTION_FIXTURE_NAMES,
  (name) => Effect.map(effectConcurrencyFixtureContent(name), (content) => ({ name, content })),
)
