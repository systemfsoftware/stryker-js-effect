import pkgJson from '@systemfsoftware/stryker-js/package.json' with { type: 'json' }
import * as S from 'effect/Schema'

export class StrykerPackage extends S.Class<StrykerPackage>('StrykerPackage')({
  name: S.String,
  version: S.String,
}) {
  static readonly version: string = pkgJson.version
}