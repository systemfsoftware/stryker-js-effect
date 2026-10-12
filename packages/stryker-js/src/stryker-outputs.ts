import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

export const sarifFileNameOf = (jsonReportFileName: string): string =>
  `${jsonReportFileName.replace(/\.[^./\\]*$/, '')}.sarif`

type OutputOptions = Pick<
  Options.StrykerOptions,
  'tempDirName' | 'incrementalFile' | 'progressStreamFile' | 'htmlReporter' | 'jsonReporter'
>

interface StrykerOutput {
  readonly source: string
  readonly fileOf: (options: OutputOptions) => string
}

const STRYKER_OUTPUTS: readonly StrykerOutput[] = [
  { source: '`tempDirName`', fileOf: (options) => options.tempDirName },
  { source: '`incrementalFile`', fileOf: (options) => options.incrementalFile },
  { source: '`progressStreamFile`', fileOf: (options) => options.progressStreamFile },
  { source: '`htmlReporter.fileName`', fileOf: (options) => options.htmlReporter.fileName },
  { source: '`jsonReporter.fileName`', fileOf: (options) => options.jsonReporter.fileName },
  {
    source: 'the SARIF file beside the JSON report',
    fileOf: (options) => sarifFileNameOf(options.jsonReporter.fileName),
  },
  { source: `\`${REPRODUCERS_FILE}\``, fileOf: () => REPRODUCERS_FILE },
]

export const strykerOutputFilesOf = (options: OutputOptions): readonly string[] =>
  STRYKER_OUTPUTS.map((output) => output.fileOf(options))

export const strykerOutputSources: readonly string[] = STRYKER_OUTPUTS.map((output) => output.source)
