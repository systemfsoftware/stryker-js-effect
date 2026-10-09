import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

export const sarifFileNameOf = (jsonReportFileName: string): string =>
  `${jsonReportFileName.replace(/\.[^./\\]*$/, '')}.sarif`

const verdictStoreFilesOf = (store: Options.VerdictStoreOptions): readonly string[] =>
  store.kind === 'fs' ? [store.directory] : []

export const strykerOutputFilesOf = (
  options: Pick<
    Options.StrykerOptions,
    'tempDirName' | 'incrementalFile' | 'progressStreamFile' | 'htmlReporter' | 'jsonReporter' | 'verdictStore'
  >,
): readonly string[] => [
  options.tempDirName,
  options.incrementalFile,
  options.progressStreamFile,
  options.htmlReporter.fileName,
  options.jsonReporter.fileName,
  sarifFileNameOf(options.jsonReporter.fileName),
  REPRODUCERS_FILE,
  ...verdictStoreFilesOf(options.verdictStore),
]
