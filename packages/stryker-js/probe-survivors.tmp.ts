import { AdmitSurvivorsRunCommand } from './src/admit-survivors-run.workflow.js'

type Enc = typeof AdmitSurvivorsRunCommand.Encoded
type Typ = typeof AdmitSurvivorsRunCommand.Type

declare const enc: Enc
declare const typ: Typ

declare const encShape: Enc
const probeEnc: Enc = enc
const probeTyp: Typ = typ

declare const plainCandidate: typeof plainSurvivor
const plainSurvivor = {
  id: 'm1',
  fileName: 'src/a.ts',
  relativeFileName: 'src/a.ts',
  mutatorName: 'BlockStatement',
  replacement: 'x',
  location: {
    start: { line: 0, column: 0 },
    end: { line: 0, column: 5 },
  },
}

const encWithPlain: Enc = {
  priorReport: undefined,
  currentConfig: {},
  frameworkVersion: '1.0.0',
  sourceContentHashes: {},
  priorSourceHashes: {},
  priorSurvivors: [plainSurvivor],
}

export { probeEnc, probeTyp, encWithPlain }
