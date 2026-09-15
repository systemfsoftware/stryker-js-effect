import { Framework } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

/**
 * @param {string} formatId
 * @param {readonly string[]} extensions
 * @param {string} [contractVersion]
 */
export const claim = (formatId, extensions, contractVersion = '1') => ({
  formatId,
  extensions,
  language: formatId,
  contractVersion,
})

/**
 * @param {{ formatId: string, extensions: readonly string[], language: string, contractVersion: string }} claimRecord
 * @returns {{ claim: unknown, parse: (rawContent: string) => Effect.Effect<{ formatId: string, rawContent: string, regions: never[] }, never, never>, transform: (document: { rawContent: string }) => Effect.Effect<{ rawContent: string }, never, never>, print: (document: { rawContent: string }) => string, disableTypeChecks: (content: string) => string }}
 */
export const serviceOf = (claimRecord) => ({
  claim: claimRecord,
  parse: (rawContent) => Effect.succeed({ formatId: claimRecord.formatId, rawContent, regions: [] }),
  transform: (document) => Effect.succeed(document),
  print: (document) => document.rawContent,
  disableTypeChecks: (content) => content,
})
/**
 * @param {string} name
 * @param {{ claim: { formatId: string, extensions: readonly string[], language: string, contractVersion: string }, parse: (rawContent: string) => unknown, transform: (document: { rawContent: string }) => unknown, print: (document: { rawContent: string }) => string, disableTypeChecks: (content: string) => string }} service
 */
export const pluginWithService = (name, service) => declarePlugin('Framework', name, Layer.succeed(Framework, service))

/**
 * @param {string} name
 * @param {{ formatId: string, extensions: readonly string[], language: string, contractVersion: string }} claimRecord
 */
export const frameworkPlugin = (name, claimRecord) => pluginWithService(name, serviceOf(claimRecord))
