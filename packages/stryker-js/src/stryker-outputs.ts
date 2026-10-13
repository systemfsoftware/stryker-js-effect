import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

export const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

export const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

export const sarifFileNameOf = (jsonReportFileName: string): string =>
  `${jsonReportFileName.replace(/\.[^./\\]*$/, '')}.sarif`

type OutputOptions = Pick<
  Options.StrykerOptions,
  'tempDirName' | 'incrementalFile' | 'progressStreamFile' | 'htmlReporter' | 'jsonReporter'
>

interface StrykerOutput {
  readonly label: string
  readonly fileOf: (options: OutputOptions) => string
}

const optionOutput = (option: 'tempDirName' | 'incrementalFile' | 'progressStreamFile'): StrykerOutput => ({
  label: `\`${option}\``,
  fileOf: (options) => options[option],
})

const reporterOutput = (reporter: 'htmlReporter' | 'jsonReporter'): StrykerOutput => ({
  label: `\`${reporter}.fileName\``,
  fileOf: (options) => options[reporter].fileName,
})

const fixedOutput = (file: string): StrykerOutput => ({ label: `\`${file}\``, fileOf: () => file })

const STRYKER_OUTPUTS: ReadonlyArray<StrykerOutput> = [
  optionOutput('tempDirName'),
  optionOutput('incrementalFile'),
  optionOutput('progressStreamFile'),
  fixedOutput(DEFAULT_PROGRESS_STREAM_FILE),
  reporterOutput('htmlReporter'),
  reporterOutput('jsonReporter'),
  {
    label: 'the SARIF file beside `jsonReporter.fileName`',
    fileOf: (options) => sarifFileNameOf(options.jsonReporter.fileName),
  },
  fixedOutput(REPRODUCERS_FILE),
]

export const strykerOutputFilesOf = (options: OutputOptions): readonly string[] =>
  STRYKER_OUTPUTS.map((output) => output.fileOf(options))

export const strykerOutputSources: readonly string[] = STRYKER_OUTPUTS.map((output) => output.label)
