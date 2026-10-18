import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type * as Scope from 'effect/Scope'
import type { SourceFile } from 'typescript/unstable/ast'
import { API, DiagnosticCategory, type Project, type Snapshot } from 'typescript/unstable/async'
import { createVirtualFileSystem, type FileSystem } from 'typescript/unstable/fs'

const Feature = makeFeature({ it })

const TSCONFIG_FILE = '/virtual-project/tsconfig.json'
const FIRST_FILE = '/virtual-project/first.ts'
const SECOND_FILE = '/virtual-project/second.ts'

const TSCONFIG_SOURCE = JSON.stringify(
  {
    compilerOptions: { noEmit: true, strict: true, target: 'ES2022' },
    files: ['first.ts', 'second.ts'],
  },
  null,
  2,
) + '\n'

const FIRST_SOURCE = 'export const first: number = 1\n'
const SECOND_SOURCE = 'export const second: number = 2\n'
const FIRST_EDITED = 'export const first: number = 11\n'
const SECOND_EDITED = 'export const second: number = 22\n'
const FIRST_BROKEN = 'export const first: number = "one"\n'

const projectOf = (snapshot: Snapshot): Effect.Effect<Project> =>
  Effect.orDie(
    Effect.fromOption(Option.fromUndefinedOr(snapshot.getProject(TSCONFIG_FILE)), () => 'tsgo opened no project'),
  )

const sourceFileOf = (snapshot: Snapshot, fileName: string): Effect.Effect<SourceFile> =>
  Effect.orDie(
    Effect.gen(function*() {
      const project = yield* projectOf(snapshot)
      const file = yield* Effect.promise(() => project.program.getSourceFile(fileName))
      return yield* Effect.fromOption(Option.fromUndefinedOr(file), () => `tsgo served no source file for ${fileName}`)
    }),
  )

const textOf = (snapshot: Snapshot, fileName: string): Effect.Effect<string> =>
  Effect.map(sourceFileOf(snapshot, fileName), (file) => file.text)

const errorCountOf = (snapshot: Snapshot, fileName: string): Effect.Effect<number> =>
  Effect.orDie(
    Effect.gen(function*() {
      const project = yield* projectOf(snapshot)
      const diagnostics = yield* Effect.promise(() => project.program.getSemanticDiagnostics(fileName))
      return Arr.filter(diagnostics, (diagnostic) => diagnostic.category === DiagnosticCategory.Error).length
    }),
  )

const closeApi = (api: API): Effect.Effect<void> =>
  Effect.tryPromise(() => api.close()).pipe(Effect.timeoutOption('1 second'), Effect.ignore)

const withApi = <A>(fs: FileSystem, use: (api: API) => Effect.Effect<A>): Effect.Effect<A, never, Scope.Scope> =>
  Effect.acquireRelease(Effect.sync(() => new API({ fs })), closeApi).pipe(Effect.flatMap(use))

const virtualProject = (): FileSystem =>
  createVirtualFileSystem({
    [TSCONFIG_FILE]: TSCONFIG_SOURCE,
    [FIRST_FILE]: FIRST_SOURCE,
    [SECOND_FILE]: SECOND_SOURCE,
  })

Feature('Pinning the tsgo snapshot-update contract the checker rounds rest on', { timeout: 120_000 })
  .live('real tsgo API servers spawned over an in-memory file system')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'One snapshot update carries the new text of every changed file',
      Gherkin.Do.pipe(
        Given('a project of two files whose texts both change before a single snapshot update')(
          'observed',
          () =>
            Effect.gen(function*() {
              const fs = virtualProject()
              return yield* withApi(fs, (api) =>
                Effect.gen(function*() {
                  const opened = yield* Effect.promise(() => api.updateSnapshot({ openProjects: [TSCONFIG_FILE] }))
                  const beforeFirst = yield* textOf(opened, FIRST_FILE)
                  const beforeSecond = yield* textOf(opened, SECOND_FILE)
                  fs.writeFile?.(FIRST_FILE, FIRST_EDITED)
                  fs.writeFile?.(SECOND_FILE, SECOND_EDITED)
                  const updated = yield* Effect.promise(() =>
                    api.updateSnapshot({
                      openProjects: [TSCONFIG_FILE],
                      fileChanges: { changed: [FIRST_FILE, SECOND_FILE] },
                    })
                  )
                  const afterFirst = yield* textOf(updated, FIRST_FILE)
                  const afterSecond = yield* textOf(updated, SECOND_FILE)
                  return { beforeFirst, beforeSecond, afterFirst, afterSecond }
                }))
            }),
        ),
        Then('the second snapshot serves the edited text of both files, not the first file alone')((s, expect) =>
          expect(s.observed).toEqual({
            beforeFirst: FIRST_SOURCE,
            beforeSecond: SECOND_SOURCE,
            afterFirst: FIRST_EDITED,
            afterSecond: SECOND_EDITED,
          })
        ),
      ),
    )

    scenario(
      'A file an update rewrites is re-checked, and its diagnostics follow its text',
      Gherkin.Do.pipe(
        Given('a project whose first file starts valid and is then rewritten broken and valid again')(
          'observed',
          () =>
            Effect.gen(function*() {
              const fs = virtualProject()
              return yield* withApi(fs, (api) =>
                Effect.gen(function*() {
                  const opened = yield* Effect.promise(() => api.updateSnapshot({ openProjects: [TSCONFIG_FILE] }))
                  const validErrors = yield* errorCountOf(opened, FIRST_FILE)
                  fs.writeFile?.(FIRST_FILE, FIRST_BROKEN)
                  const broken = yield* Effect.promise(() =>
                    api.updateSnapshot({ openProjects: [TSCONFIG_FILE], fileChanges: { changed: [FIRST_FILE] } })
                  )
                  const brokenErrors = yield* errorCountOf(broken, FIRST_FILE)
                  fs.writeFile?.(FIRST_FILE, FIRST_SOURCE)
                  const restored = yield* Effect.promise(() =>
                    api.updateSnapshot({ openProjects: [TSCONFIG_FILE], fileChanges: { changed: [FIRST_FILE] } })
                  )
                  const restoredErrors = yield* errorCountOf(restored, FIRST_FILE)
                  return { validErrors, brokenErrors, restoredErrors }
                }))
            }),
        ),
        Then('the file has no error, then an error after the change, then none again after changing back')(
          (s, expect) =>
            expect({
              valid: s.observed.validErrors === 0,
              broken: s.observed.brokenErrors > 0,
              restored: s.observed.restoredErrors === 0,
            }).toEqual({ valid: true, broken: true, restored: true }),
        ),
      ),
    )
  })
