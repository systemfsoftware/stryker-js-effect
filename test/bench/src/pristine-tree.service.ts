import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

export interface PristineTree {
  readonly root: string
  readonly files: HashMap.HashMap<string, Uint8Array>
  readonly directories: HashSet.HashSet<string>
}

interface TreeListing {
  readonly files: ReadonlyArray<string>
  readonly directories: ReadonlyArray<string>
}

const UNTRACKED_NAMES = HashSet.make('node_modules', '.git')

const VITE_CACHE = ['node_modules', '.vite'] as const

const ROOT = '.'

const listTree = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  relative: string,
): Effect.Effect<TreeListing, PlatformError> =>
  Effect.gen(function*() {
    const names = yield* fs.readDirectory(path.join(root, relative))
    const children = yield* Effect.forEach(
      names.filter((name) => !HashSet.has(UNTRACKED_NAMES, name)),
      (name): Effect.Effect<TreeListing, PlatformError> => {
        const child = path.join(relative, name)
        return Effect.flatMap(fs.stat(path.join(root, child)), (info) =>
          info.type === 'Directory'
            ? Effect.map(listTree(fs, path, root, child), (inner) => ({
              files: inner.files,
              directories: [child, ...inner.directories],
            }))
            : Effect.succeed({ files: [child], directories: [] }))
      },
    )
    return {
      files: Arr.flatMap(children, (listing) => listing.files),
      directories: Arr.flatMap(children, (listing) => listing.directories),
    }
  })

export const snapshotTree = (
  root: string,
): Effect.Effect<PristineTree, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const listing = yield* listTree(fs, path, root, '')
    const files = yield* Effect.forEach(
      listing.files,
      (file) => Effect.map(fs.readFile(path.join(root, file)), (bytes) => [file, bytes] as const),
    )
    return { root, files: HashMap.fromIterable(files), directories: HashSet.fromIterable(listing.directories) }
  })

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])

const inPristineDirectory = (pristine: PristineTree, path: Path.Path, entry: string): boolean => {
  const parent = path.dirname(entry)
  return parent === ROOT || HashSet.has(pristine.directories, parent)
}

export const restoreTree = (
  pristine: PristineTree,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const at = (relative: string): string => path.join(pristine.root, relative)
    const current = yield* listTree(fs, path, pristine.root, '')
    const addedDirectories = current.directories.filter((directory) =>
      !HashSet.has(pristine.directories, directory) && inPristineDirectory(pristine, path, directory)
    )
    const addedFiles = current.files.filter((file) =>
      !HashMap.has(pristine.files, file) && inPristineDirectory(pristine, path, file)
    )
    yield* Effect.forEach(addedDirectories, (directory) => fs.remove(at(directory), { recursive: true }), {
      discard: true,
    })
    yield* Effect.forEach(addedFiles, (file) => fs.remove(at(file)), { discard: true })
    yield* Effect.forEach(
      pristine.files,
      ([file, bytes]) =>
        Effect.flatMap(fs.readFile(at(file)).pipe(Effect.option), (now) =>
          Option.match(
            Option.filter(now, (present) => sameBytes(present, bytes)),
            {
              onSome: () => Effect.void,
              onNone: () =>
                fs.makeDirectory(path.dirname(at(file)), { recursive: true }).pipe(
                  Effect.andThen(fs.writeFile(at(file), bytes)),
                ),
            },
          )),
      { discard: true },
    )
    yield* fs.remove(path.join(pristine.root, ...VITE_CACHE), { recursive: true, force: true })
  })
