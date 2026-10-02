import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

import {
  failureCatalogDocumentSource,
  spanTaxonomyDocumentSource,
  stockCatalogDocumentSource,
  streamDocumentSource,
} from '../scripts/contract-documents.js'

const Feature = makeFeature({ it })

const platformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const readCommitted = (relativePath: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* path.fromFileUrl(new URL('..', import.meta.url))
    return yield* fs.readFileString(path.join(root, relativePath))
  })

Feature('Regenerating the published CLI contract documents')
  .withLayer(platformLayer)
  .live('every scenario reads the committed contract files from disk through the platform file system')
  .body(({ scenario }) => {
    scenario(
      'The committed stream document is byte for byte what the generator writes from the event union',
      Gherkin.Do.pipe(
        Given('the committed stream document')('committed', () => readCommitted('contract/stream.schema.json')),
        When('the generator reconstructs the document from the event union')(
          'regenerated',
          () => Effect.sync(() => streamDocumentSource()),
        ),
        Then('the regenerated document equals the committed bytes')((s, expect) =>
          expect(s.regenerated).toEqual(s.committed)
        ),
      ),
    )

    scenario(
      'The committed stock catalog document is byte for byte what the generator writes from the catalog',
      Gherkin.Do.pipe(
        Given('the committed stock catalog document')('committed', () => readCommitted('contract/stock-catalog.json')),
        When('the generator reconstructs the document from the catalog')(
          'regenerated',
          () => Effect.sync(() => stockCatalogDocumentSource()),
        ),
        Then('the regenerated document equals the committed bytes')((s, expect) =>
          expect(s.regenerated).toEqual(s.committed)
        ),
      ),
    )

    scenario(
      'The committed failure catalog document is byte for byte what the generator writes from the catalog',
      Gherkin.Do.pipe(
        Given('the committed failure catalog document')(
          'committed',
          () => readCommitted('contract/failure-catalog.json'),
        ),
        When('the generator reconstructs the document from the failure catalog')(
          'regenerated',
          () => Effect.sync(() => failureCatalogDocumentSource()),
        ),
        Then('the regenerated document equals the committed bytes')((s, expect) =>
          expect(s.regenerated).toEqual(s.committed)
        ),
      ),
    )

    scenario(
      'The committed span taxonomy document is byte for byte what the generator writes from the taxonomy',
      Gherkin.Do.pipe(
        Given('the committed span taxonomy document')('committed', () => readCommitted('contract/span-taxonomy.json')),
        When('the generator reconstructs the document from the taxonomy')(
          'regenerated',
          () => Effect.sync(() => spanTaxonomyDocumentSource()),
        ),
        Then('the regenerated document equals the committed bytes')((s, expect) =>
          expect(s.regenerated).toEqual(s.committed)
        ),
      ),
    )
  })
