import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { reportDocumentSource, reportModuleSource } from '../scripts/report-contract.js'
import { PublishedReportDocumentSchema } from './__fixtures__/published-report-document.schema.js'

const Feature = makeFeature({ it })

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const readCommitted = (relativePath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* path.fromFileUrl(new URL('..', import.meta.url))
    return yield* fs.readFileString(path.join(root, relativePath))
  })

Feature('Regenerating the published report contract')
  .withLayer(platformLayer)
  .live('every scenario reads the committed contract files from disk through the platform file system')
  .body(({ scenario }) => {
    scenario(
      'The committed module is byte for byte what the generator writes from the pinned upstream document',
      Gherkin.Do.pipe(
        Given('the committed generated module')('committed', () => readCommitted('src/generated/report.generated.ts')),
        When('the generator regenerates the module from the pinned upstream document')(
          'regenerated',
          () => Effect.sync(() => reportModuleSource()),
        ),
        Then('the regenerated module equals the committed bytes')((s, expect) =>
          expect(s.regenerated).toEqual(s.committed)
        ),
      ),
    )

    scenario(
      'The committed document is byte for byte what the assembled contract publishes',
      Gherkin.Do.pipe(
        Given('the committed published document')('committed', () => readCommitted('contract/report.schema.json')),
        When('the generator regenerates the document from the assembled contract')(
          'regenerated',
          () => Effect.sync(() => reportDocumentSource()),
        ),
        Then('the regenerated document equals the committed bytes')((s, expect) =>
          expect(s.regenerated).toEqual(s.committed)
        ),
      ),
    )

    scenario(
      'The published document carries the product break threshold on the thresholds definition',
      Gherkin.Do.pipe(
        Given('the committed published document decoded as a report document')(
          'published',
          () =>
            Effect.gen(function*() {
              const text = yield* readCommitted('contract/report.schema.json')
              return yield* S.decodeEffect(S.fromJsonString(PublishedReportDocumentSchema))(text)
            }),
        ),
        When('the thresholds definition publishes its break threshold')(
          'breakThreshold',
          (s) => Effect.sync(() => s.published.definitions.thresholds.properties.break),
        ),
        Then('the break threshold is the nullable percentage the product writes')((s, expect) =>
          expect(s.breakThreshold).toEqual({
            description: 'The mutation score below which the run breaks. Null disables the break.',
            anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'null' }],
          })
        ),
      ),
    )
  })
