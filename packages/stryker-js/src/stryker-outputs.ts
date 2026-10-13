import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

export const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

export const sarifFileNameOf = (jsonReportFileName: string): string =>
  `${jsonReportFileName.replace(/\.[^./\\]*$/, '')}.sarif`

type OutputOptions = Pick<
  Options.StrykerOptions,
  'tempDirName' | 'incrementalFile' | 'progressStreamFile' | 'htmlReporter' | 'jsonReporter'
>

const OPTION_OUTPUTS = ['tempDirName', 'incrementalFile', 'progressStreamFile'] as const

const REPORTER_OUTPUTS = ['htmlReporter', 'jsonReporter'] as const

export const strykerOutputFilesOf = (options: OutputOptions): readonly string[] => [
  ...OPTION_OUTPUTS.map((option) => options[option]),
  DEFAULT_PROGRESS_STREAM_FILE,
  ...REPORTER_OUTPUTS.map((reporter) => options[reporter].fileName),
  sarifFileNameOf(options.jsonReporter.fileName),
  REPRODUCERS_FILE,
]

export const strykerOutputSources: readonly string[] = [
  ...OPTION_OUTPUTS.map((option) => `\`${option}\``),
  `\`${DEFAULT_PROGRESS_STREAM_FILE}\``,
  ...REPORTER_OUTPUTS.map((reporter) => `\`${reporter}.fileName\``),
  'the SARIF file beside `jsonReporter.fileName`',
  `\`${REPRODUCERS_FILE}\``,
]
