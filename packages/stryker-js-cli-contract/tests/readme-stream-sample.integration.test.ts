import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const SAMPLE_HEADING = '## 📡 Real-Time NDJSON Machine Output'
const CONSOLE_FENCE = '```console'
const FENCE = '```'
const PROMPT = '$ '

const readRepositoryReadme = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* path.fromFileUrl(new URL('../../..', import.meta.url))
  return yield* fs.readFileString(path.join(root, 'README.md'))
})

const sampleLinesOf = (readme: string): ReadonlyArray<string> => {
  const section = readme.slice(readme.indexOf(SAMPLE_HEADING))
  const opened = section.slice(section.indexOf(CONSOLE_FENCE) + CONSOLE_FENCE.length)
  return opened
    .slice(0, opened.indexOf(FENCE))
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith(PROMPT))
}

const decodeWireLine = S.decodeUnknownResult(RunEvent.RunEventWireLine)

Feature('The README stream sample is a stream the contract decodes')
  .withLayer(platformLayer)
  .live('the scenario reads the committed repository README from disk through the platform file system')
  .body(({ scenario }) => {
    scenario(
      'Every line of the documented `--json` transcript decodes under the published wire codec',
      Gherkin.Do.pipe(
        Given('the NDJSON transcript the README shows under its machine-output section')(
          'lines',
          () => Effect.map(readRepositoryReadme, sampleLinesOf),
        ),
        When('each line is decoded as a run event wire line')(
          'decoded',
          (s) =>
            Effect.sync(() =>
              s.lines.map((line) =>
                Result.match(decodeWireLine(line), {
                  onFailure: (error) => `refused: ${error.message} :: ${line}`,
                  onSuccess: (event) => event._tag,
                })
              )
            ),
        ),
        Then('the transcript reads as a whole run, every line accepted')((s, expect) =>
          expect(s.decoded).toEqual([
            'stream',
            'phase',
            'plan',
            'mutantTested',
            'mutantTested',
            'mutantTested',
            'verdict',
          ])
        ),
      ),
    )
  })
