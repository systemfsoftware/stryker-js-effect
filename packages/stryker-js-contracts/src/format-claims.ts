import * as Option from 'effect/Option'

import type { ClaimedFormat } from './Instrumenter.schema.js'

/** The lower-cased extension of a file name, dot included, or `''` when the base name has none. */
export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  return dot > slash ? fileName.slice(dot).toLowerCase() : ''
}

/** The claim that owns a file: the first one, in precedence order, naming the file's extension. */
export const claimForFile = (
  formats: readonly ClaimedFormat[],
  fileName: string,
): Option.Option<ClaimedFormat> => {
  const extension = extensionOf(fileName)
  return Option.fromUndefinedOr(formats.find((format) => format.extensions.includes(extension)))
}
