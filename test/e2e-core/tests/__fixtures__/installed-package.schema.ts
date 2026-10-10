import * as S from 'effect/Schema'

export const InstalledPackageJson = S.fromJsonString(
  S.Struct({ name: S.String, version: S.String, description: S.String }),
)
