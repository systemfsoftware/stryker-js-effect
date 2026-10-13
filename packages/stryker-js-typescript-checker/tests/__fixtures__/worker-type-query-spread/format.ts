export interface TransformerOptions {
  readonly excludedMutations: ReadonlyArray<string>
  readonly noHeader?: boolean
}

export interface InstrumenterOptions {
  readonly excludedMutations: ReadonlyArray<string>
  readonly noHeader?: boolean | undefined
}

export const toTransformerOptions = (options: InstrumenterOptions): TransformerOptions => ({
  excludedMutations: [...options.excludedMutations],
  ...(options.noHeader !== undefined ? { noHeader: options.noHeader } : {}),
})
