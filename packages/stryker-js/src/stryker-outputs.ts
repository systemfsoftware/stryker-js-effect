import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'

import { tempSiblingRuleOf } from './replace-file-atomically.js'

export const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'

export const DEFAULT_PROGRESS_STREAM_FILE = 'reports/mutation-stream.jsonl'

export const sarifFileNameOf = (jsonReportFileName: string): string =>
  `${jsonReportFileName.replace(/\.[^./\\]*$/, '')}.sarif`

type OutputOptions = Pick<
  Options.StrykerOptions,
  'tempDirName' | 'incrementalFile' | 'progressStreamFile' | 'htmlReporter' | 'jsonReporter' | 'verdictStore'
>

interface StrykerOutput {
  readonly label: string
  readonly filesOf: (options: OutputOptions) => readonly string[]
}

const optionOutput = (option: 'tempDirName' | 'incrementalFile' | 'progressStreamFile'): StrykerOutput => ({
  label: `\`${option}\``,
  filesOf: (options) => [options[option]],
})

const reporterOutput = (reporter: 'htmlReporter' | 'jsonReporter'): StrykerOutput => ({
  label: `\`${reporter}.fileName\``,
  filesOf: (options) => [options[reporter].fileName],
})

const fixedOutput = (file: string): StrykerOutput => ({ label: `\`${file}\``, filesOf: () => [file] })

const STRYKER_OUTPUTS: ReadonlyArray<StrykerOutput> = [
  optionOutput('tempDirName'),
  optionOutput('incrementalFile'),
  {
    label: 'the temp files a write of `incrementalFile` leaves beside it',
    filesOf: (options) => [tempSiblingRuleOf(options.incrementalFile)],
  },
  optionOutput('progressStreamFile'),
  fixedOutput(DEFAULT_PROGRESS_STREAM_FILE),
  reporterOutput('htmlReporter'),
  reporterOutput('jsonReporter'),
  {
    label: 'the SARIF file beside `jsonReporter.fileName`',
    filesOf: (options) => [sarifFileNameOf(options.jsonReporter.fileName)],
  },
  fixedOutput(REPRODUCERS_FILE),
  {
    label: '`verdictStore.directory` of a filesystem verdict store',
    filesOf: ({ verdictStore }) => verdictStore.kind === 'fs' ? [verdictStore.directory] : [],
  },
]

export const strykerOutputFilesOf = (options: OutputOptions): readonly string[] =>
  STRYKER_OUTPUTS.flatMap((output) => output.filesOf(options))

export const strykerOutputSources: readonly string[] = STRYKER_OUTPUTS.map((output) => output.label)
