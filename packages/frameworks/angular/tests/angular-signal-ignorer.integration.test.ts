import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Ignorer, Node } from '@systemfsoftware/stryker-framework-interface'
import { strykerIgnorers } from '@systemfsoftware/stryker-js-angular'
import * as Effect from 'effect/Effect'
import { parseSync } from 'oxc-parser'
import { parseAndWalk } from 'oxc-walker'
import { expect } from 'vitest'

const INPUT_MODEL_OUTPUT_CONFIG_MSG =
  'Angular signal based input, model and output functions configuration object cannot be mutated as that causes issues with the Angular compiler.'

const SIGNAL_QUERY_OPTIONS_MSG =
  'Angular signal query options object cannot be mutated as that causes issues with the Angular compiler.'

const ANGULAR_SIGNAL_IGNORER_NAME = 'angular-signal-io'

const PROBE_SOURCE = `class Probe {
  foo = input.required({ required: true })
  bar = viewChild(BarToken, { read: BarToken })
  baz = compute({ keep: 1 })
}
`

interface IgnoredSpan {
  readonly text: string
  readonly reason: string
}

const bundledIgnorer = (): Ignorer => {
  const descriptor = strykerIgnorers.at(0)
  if (descriptor === undefined) {
    throw new Error('@systemfsoftware/stryker-js-angular publishes no bundled ignorer')
  }
  return descriptor
}

const isObjectExpression = (node: { readonly type: string }): boolean => node.type === 'ObjectExpression'

const ignoredSpansIn = (ignorer: Ignorer, code: string): readonly IgnoredSpan[] => {
  const ignored: IgnoredSpan[] = []
  const ancestors: Node[] = []
  const result = parseAndWalk(code, 'probe.ts', {
    parseSync,
    parseOptions: { lang: 'ts', range: true },
    enter(node) {
      if (isObjectExpression(node)) {
        const reason = ignorer.shouldIgnore(node, [...ancestors])
        if (reason !== undefined) {
          ignored.push({ text: code.slice(node.start, node.end), reason })
        }
      }
      ancestors.unshift(node)
    },
    leave() {
      ancestors.shift()
    },
  })
  if (result.errors.length > 0) {
    throw new Error(`the probe source failed to parse: ${result.errors.map((error) => error.message).join('; ')}`)
  }
  return ignored
}

const Feature = makeFeature({ it, layer })

Feature('Ignoring Angular signal configuration objects and queries').body(({ scenario }) => {
  scenario(
    'Signal configuration objects stay unmutated while a plain object beside them is mutated',
    Gherkin.Do.pipe(
      Given('a class holding a signal input config, a signal query options object, and a plain object')(
        'source',
        () => Effect.succeed(PROBE_SOURCE),
      ),
      When("the plugin's bundled ignorer judges every node of that class")(
        'ignored',
        ({ source }: { source: string }) => Effect.sync(() => ignoredSpansIn(bundledIgnorer(), source)),
      ),
      Then('the two signal configs carry their compiler reasons and the plain object is not ignored')((
        { ignored }: { ignored: readonly IgnoredSpan[] },
      ) => {
        expect(ignored).toStrictEqual([
          { text: '{ required: true }', reason: INPUT_MODEL_OUTPUT_CONFIG_MSG },
          { text: '{ read: BarToken }', reason: SIGNAL_QUERY_OPTIONS_MSG },
        ])
      }),
    ),
  )

  scenario(
    'The plugin offers the signal rule under its own name',
    Gherkin.Do.pipe(
      Given('the ignore rules the plugin bundles')('ignorers', () => Effect.sync(() => strykerIgnorers)),
      When('the rule is read')(
        'descriptor',
        ({ ignorers }: { ignorers: readonly Ignorer[] }) => {
          const descriptor = ignorers.at(0)
          if (descriptor === undefined) {
            return Effect.die(new Error('the plugin bundles no ignore rule'))
          }
          return Effect.succeed({ name: descriptor.name, callable: typeof descriptor.shouldIgnore })
        },
      ),
      Then('it is offered under the name hosts select it by, and its decision is callable')((
        { descriptor }: { descriptor: { name: string; callable: string } },
      ) => {
        expect(descriptor).toStrictEqual({ name: ANGULAR_SIGNAL_IGNORER_NAME, callable: 'function' })
      }),
    ),
  )
})
