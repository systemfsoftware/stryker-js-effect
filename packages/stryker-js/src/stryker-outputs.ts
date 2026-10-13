import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

export const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

export const sarifFileNameOf = (jsonReportFileName: string): string =>
  `${jsonReportFileName.replace(/\.[^./\\]*$/, '')}.sarif`

export const strykerOutputFilesOf = (
  options: Pick<
    Options.StrykerOptions,
    'tempDirName' | 'incrementalFile' | 'progressStreamFile' | 'htmlReporter' | 'jsonReporter'
  >,
): readonly string[] => [
  options.tempDirName,
  options.incrementalFile,
  options.progressStreamFile,
  DEFAULT_PROGRESS_STREAM_FILE,
  options.htmlReporter.fileName,
  options.jsonReporter.fileName,
  sarifFileNameOf(options.jsonReporter.fileName),
  REPRODUCERS_FILE,
]
