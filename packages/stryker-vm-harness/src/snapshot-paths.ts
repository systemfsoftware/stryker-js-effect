import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import type { Path } from 'effect/Path'

export const SNAPSHOT_DIRECTORY = '__snapshots__'
export const SNAPSHOT_SUFFIX = '.snap'

export type SnapshotUpdateMode = 'none' | 'new'

export const defaultSnapshotPath = dual<
  (testFile: string) => (path: Path) => string,
  (path: Path, testFile: string) => string
>(
  2,
  (path, testFile) =>
    path.join(path.dirname(testFile), SNAPSHOT_DIRECTORY, `${path.basename(testFile)}${SNAPSHOT_SUFFIX}`),
)

const CI_DISABLED_DECLARATIONS: Readonly<Record<string, true>> = { '': true, false: true }

const ciIsSet = (declared: string | undefined): boolean =>
  declared !== undefined && !Object.hasOwn(CI_DISABLED_DECLARATIONS, declared)

export const snapshotUpdateMode = (ci: string | undefined): SnapshotUpdateMode =>
  Match.value(ciIsSet(ci)).pipe(
    Match.when(true, (): SnapshotUpdateMode => 'none'),
    Match.when(false, (): SnapshotUpdateMode => 'new'),
    Match.exhaustive,
  )
