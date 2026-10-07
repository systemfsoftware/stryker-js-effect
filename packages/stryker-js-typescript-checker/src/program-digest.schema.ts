import * as Arr from 'effect/Array'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'

export const ProgramFile = S.Struct({ fileName: S.String, digest: S.String })
export type ProgramFile = typeof ProgramFile.Type

export type ProgramIdentityInput = {
  readonly typescriptVersion: string
  readonly checkerVersion: string
  readonly checkerOptionsJson: string
  readonly sourceFiles: readonly ProgramFile[]
  readonly tsconfigs: readonly ProgramFile[]
}

const entryLineOf = (kind: string, entry: ProgramFile): string => `${kind}\u0000${entry.fileName}\u0000${entry.digest}`

export const programKeyOf = (input: ProgramIdentityInput): string =>
  [
    `typescript\u0000${input.typescriptVersion}`,
    `checker\u0000${input.checkerVersion}`,
    `options\u0000${input.checkerOptionsJson}`,
    ...Arr.sort(Arr.map(input.sourceFiles, (entry) => entryLineOf('source', entry)), Order.String),
    ...Arr.sort(Arr.map(input.tsconfigs, (entry) => entryLineOf('tsconfig', entry)), Order.String),
  ].join('\n')
