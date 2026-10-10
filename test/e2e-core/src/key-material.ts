import type { FileBytes, FixtureInput, PackInput } from './bake-key.schema.js'

const encodeChunk = (text: string): Uint8Array => new TextEncoder().encode(text)

const fileChunks = (label: string, files: ReadonlyArray<FileBytes>): ReadonlyArray<Uint8Array> =>
  [...files]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .flatMap((file) => [encodeChunk(`${label}\0${file.relativePath}\0`), file.bytes, encodeChunk('\0')])

const joinChunks = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  chunks.reduce<number>((offset, chunk) => {
    bytes.set(chunk, offset)
    return offset + chunk.length
  }, 0)
  return bytes
}

export const packsKeyBytes = (input: PackInput): Uint8Array =>
  joinChunks([
    encodeChunk(`image\0${input.baseImage}\0`),
    encodeChunk(`bake\0${input.registryCutoff}\0`),
    input.bakeScript,
    encodeChunk('\0'),
    ...[...input.packs]
      .sort((left, right) => left.fileName.localeCompare(right.fileName))
      .flatMap((pack) => fileChunks(`pack\0${pack.fileName}`, pack.files)),
  ])

export const fixtureKeyBytes = (input: FixtureInput): Uint8Array =>
  joinChunks(fileChunks(`fixture\0${input.fixtureId}`, input.files))

interface BakeKeyMaterial {
  readonly packs: Uint8Array
  readonly fixtures: ReadonlyArray<{ readonly fixtureId: string; readonly bytes: Uint8Array }>
}

const bakeKeyMaterialOf = (packs: PackInput, fixtures: ReadonlyArray<FixtureInput>): BakeKeyMaterial => ({
  packs: packsKeyBytes(packs),
  fixtures: fixtures.map((fixture) => ({ fixtureId: fixture.fixtureId, bytes: fixtureKeyBytes(fixture) })),
})

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Hex = await import('effect/encoding/Hex')
  const S = await import('effect/Schema')

  const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text)
  const fileOf = (relativePath: string, seed: string): FileBytes => ({ relativePath, bytes: textBytes(seed) })
  const hexOf = (bytes: Uint8Array): string => Hex.encode(bytes)

  const packsOf = (baseImage: string, seed: string): PackInput => ({
    baseImage,
    bakeScript: textBytes('install'),
    registryCutoff: '2026-10-10T05:51:38Z',
    packs: [{ fileName: 'a.tgz', files: [fileOf('package.json', seed)] }],
  })

  const fixtureOf = (fixtureId: string, seed: string): FixtureInput => ({
    fixtureId,
    files: [fileOf('index.ts', seed)],
  })

  it.prop(
    '∀c_ClosureDifferingInOnePackedFile_≡PacksKeyChanges',
    { of: [S.NonEmptyString, S.NonEmptyString], subject: bakeKeyMaterialOf },
    (subject, [baseImage, seed]) => {
      const original = subject(packsOf(baseImage, seed), [])
      const edited = subject(packsOf(baseImage, `${seed}!`), [])
      return hexOf(original.packs) !== hexOf(edited.packs)
    },
  )

  it.prop(
    '∀f_SetDifferingInOneFixturesBytes_≡EditedKeyChangesTheRestHold',
    { of: [S.NonEmptyString, S.NonEmptyString, S.NonEmptyString], subject: bakeKeyMaterialOf },
    (subject, [fixtureId, otherSeed, seed]) => {
      const before = subject(packsOf('node:24-alpine', 'packs'), [
        fixtureOf(fixtureId, seed),
        fixtureOf(`${fixtureId}0`, otherSeed),
      ])
      const after = subject(packsOf('node:24-alpine', 'packs'), [
        fixtureOf(fixtureId, `${seed}!`),
        fixtureOf(`${fixtureId}0`, otherSeed),
      ])
      const byId = (material: BakeKeyMaterial): Record<string, string> =>
        Object.fromEntries(material.fixtures.map((fixture) => [fixture.fixtureId, hexOf(fixture.bytes)]))
      const beforeHex = byId(before)
      const afterHex = byId(after)
      return beforeHex[fixtureId] !== afterHex[fixtureId] && beforeHex[`${fixtureId}0`] === afterHex[`${fixtureId}0`]
    },
  )
}
