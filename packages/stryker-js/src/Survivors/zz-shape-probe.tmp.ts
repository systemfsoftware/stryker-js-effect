import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'

import { Admitted, AdmitSurvivorsRunCommand, NoSurvivors } from './admit-survivors-run.workflow.js'

type Enc = typeof AdmitSurvivorsRunCommand.Encoded

declare const survivorEnc: Enc['priorSurvivors'][number]

export const probeTag: 'Mutant' = survivorEnc._tag

export const probeId: string = survivorEnc.id

export const probeFileName: string = survivorEnc.fileName

declare const mutantType: Mutant

export const probeEncodedAssignableToType: Mutant = survivorEnc

export const probeTypeAssignableToEncoded: Enc['priorSurvivors'][number] = mutantType

export const probeDecisionTag: 'Admitted' | 'NoSurvivors' = (null as unknown as Admitted | NoSurvivors)._tag

export const probeNoSurvivors: NoSurvivors = NoSurvivors.make()
