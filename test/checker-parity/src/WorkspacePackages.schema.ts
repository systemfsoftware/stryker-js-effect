import * as S from 'effect/Schema'

/** The JSON `pnpm ls -r --depth -1 --json` prints: one entry per workspace package, with its absolute directory. */
export const WorkspacePackages = S.Struct({ path: S.String }).pipe(S.Array, S.fromJsonString)
