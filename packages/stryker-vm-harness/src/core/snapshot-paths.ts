import * as Match from 'effect/Match'
import type { Path } from 'effect/Path'

export const SNAPSHOT_DIRECTORY = '__snapshots__'
export const SNAPSHOT_SUFFIX = '.snap'

export type SnapshotUpdateMode = 'none' | 'new'

export const defaultSnapshotPath = (path: Path, testFile: string): string =>
  path.join(path.dirname(testFile), SNAPSHOT_DIRECTORY, `${path.basename(testFile)}${SNAPSHOT_SUFFIX}`)

const ciIsSet = (declared: string | undefined): boolean =>
  declared !== undefined && declared !== '' && declared !== 'false'

export const snapshotUpdateMode = (ci: string | undefined): SnapshotUpdateMode =>
  Match.value(ciIsSet(ci)).pipe(
    Match.when(true, (): SnapshotUpdateMode => 'none'),
    Match.when(false, (): SnapshotUpdateMode => 'new'),
    Match.exhaustive,
  )
