import { describe, it } from '@systemfsoftware/vitest'
import * as S from 'effect/Schema'

import { checkedOnLeg, corpusEntries, ISOLATED_DECLARATIONS_PROJECT, projectOnLeg } from '../corpus.js'
import { ProjectLeg } from '../Parity.schema.js'
import { inShard } from '../shard.js'

const FIXTURE_DIRECTORY = ISOLATED_DECLARATIONS_PROJECT.slice(0, ISOLATED_DECLARATIONS_PROJECT.lastIndexOf('/') + 1)

describe('projectOnLeg', () => {
  it.prop(
    '∀l_FixtureFileCheckedOnTheLeg_≡FixtureProjectOnTheLeg',
    { of: [ProjectLeg, S.String], subject: projectOnLeg },
    (subject, [drawn, name]) => {
      const leg = { ...drawn, project: ISOLATED_DECLARATIONS_PROJECT }
      return !checkedOnLeg(leg)(`${FIXTURE_DIRECTORY}${name}`) || subject(leg)
    },
  )

  it.prop(
    '∀l_NotSampledNothingChanged_≡OffTheLegUnlessSampled',
    { of: [ProjectLeg], subject: projectOnLeg },
    (subject, [drawn]) => {
      const unchanged = { ...drawn, samplesOnLeg: false, changedFiles: [] }
      return !subject(unchanged) && subject({ ...unchanged, samplesOnLeg: true })
    },
  )
})

describe('checkedOnLeg', () => {
  it.prop(
    '∀l_FixtureFile_≡CheckedOnItsShardWhateverThePullRequestChanged',
    { of: [ProjectLeg, S.String], subject: checkedOnLeg },
    (subject, [drawn, name]) => {
      const file = `${FIXTURE_DIRECTORY}${name}`
      return subject({ ...drawn, project: ISOLATED_DECLARATIONS_PROJECT })(file) === inShard(file, drawn.shard)
    },
  )
})

describe('corpusEntries', () => {
  it.prop(
    '∀d_VendoredSubtreeTsconfig_≡NotInTheWorkspaceCorpus',
    { of: [S.String], subject: corpusEntries },
    (subject, [directory]) => {
      const vendored = `repos/${directory}/tsconfig.app.json`
      const owned = 'packages/stryker-js/tsconfig.app.json'
      return subject([vendored, owned]).workspaceTsconfigs.join() === owned
    },
  )
})
