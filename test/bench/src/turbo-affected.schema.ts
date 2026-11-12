import * as Arr from 'effect/Array'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

const TurboAffectedWire = S.Struct({
  data: S.Struct({ affectedPackages: S.Struct({ items: S.Array(S.Struct({ path: S.String })) }) }),
})

export const TurboAffectedPaths: S.Codec<ReadonlyArray<string>, string> = S.fromJsonString(TurboAffectedWire).pipe(
  S.decodeTo(
    S.Array(S.String),
    SchemaTransformation.transform<ReadonlyArray<string>, typeof TurboAffectedWire.Type>({
      decode: (wire) => Arr.map(wire.data.affectedPackages.items, (item) => item.path),
      encode: (paths) => ({ data: { affectedPackages: { items: Arr.map(paths, (path) => ({ path })) } } }),
    }),
  ),
)
