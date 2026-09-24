import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'

import { AdmitSurvivorsRunCommand } from './admit-survivors-run.workflow.js'

type Enc = typeof AdmitSurvivorsRunCommand.Encoded

declare const options: StrykerOptions

export const probeConfig: Enc['currentConfig'] = options

export const probeSurvivor: Enc['priorSurvivors'][number] = {
  id: 'm1',
  fileName: 'src/a.ts',
  relativeFileName: 'src/a.ts',
  mutatorName: 'Block',
  replacement: 'x',
  location: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
}

export const probeFacts: NonNullable<Enc['priorReport']> = {
  config: {},
  frameworkVersion: undefined,
}

export const probeFull: Enc = {
  currentConfig: options,
  frameworkVersion: 'x',
  priorReport: undefined,
  priorSourceHashes: {},
  priorSurvivors: [],
  sourceContentHashes: {},
}
