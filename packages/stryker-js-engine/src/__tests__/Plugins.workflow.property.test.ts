import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import { Schema as S } from 'effect'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import { FastCheck as fc } from 'effect/testing'

import { Framework, Ignorer } from '@systemfsoftware/stryker-js-language'
import type { FrameworkService } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { buildPluginLoadPlan } from '../Plugins.js'
import type { PluginLoaderEntryLike, PluginLoadPlan } from '../Plugins.js'
import { GeneratedEntrySchema, PluginExtensionClaimShadowing, PluginNameShadowing } from '../Plugins.schema.js'
import type { FrameworkClaim, PluginShadowing } from '../Plugins.schema.js'

const EXTENSIONS = ['.html', '.vue', '.svelte'] as const
const NAMES = ['alpha', 'beta', 'gamma'] as const
const KINDS = ['Framework', 'Ignore'] as const

interface GeneratedEntry {
  readonly moduleId: string
  readonly contributionName: string
  readonly extensions: readonly string[]
}

const dedupeExtensions = (entry: GeneratedEntry): GeneratedEntry => ({
  ...entry,
  extensions: [...new Set(entry.extensions)],
})

const entryArbitrary = S.toArbitrary(GeneratedEntrySchema)(fc).map(dedupeExtensions)

const byModuleId = (left: GeneratedEntry, right: GeneratedEntry): number => {
  if (left.moduleId < right.moduleId) return -1
  if (left.moduleId > right.moduleId) return 1
  return 0
}

const frameworkServiceOf = (claim: FrameworkClaim): FrameworkService => ({
  claim,
  parse: (rawContent) => Effect.succeed({ formatId: claim.formatId, rawContent, regions: [] }),
  transform: (document) => Effect.succeed(document),
  print: (document) => Effect.succeed(document.rawContent),
  disableTypeChecks: (content) => Effect.succeed(content),
})

const entryOf = (entry: GeneratedEntry): PluginLoaderEntryLike => {
  const claim: FrameworkClaim = {
    formatId: entry.contributionName,
    extensions: entry.extensions,
    language: entry.contributionName,
    ownerVersion: '1',
    contractVersion: '1',
  }
  const service = frameworkServiceOf(claim)
  return {
    moduleName: entry.moduleId,
    outcome: 'loaded',
    plugins: [
      declarePlugin('Framework', entry.contributionName, Layer.succeed(Framework, service)),
      declarePlugin('Ignore', entry.contributionName, Layer.succeed(Ignorer, { shouldIgnore: () => Option.none() })),
    ],
    schemaContribution: undefined,
    frameworks: [{ moduleName: entry.moduleId, contributionName: entry.contributionName, claim, service }],
  }
}

const isExtensionShadowing = (shadowing: PluginShadowing): shadowing is PluginExtensionClaimShadowing =>
  shadowing instanceof PluginExtensionClaimShadowing

const isNameShadowing = (shadowing: PluginShadowing): shadowing is PluginNameShadowing =>
  shadowing instanceof PluginNameShadowing

const participantsOf = (
  entries: readonly GeneratedEntry[],
  pick: (entry: GeneratedEntry) => boolean,
): readonly string[] => entries.filter(pick).map((entry) => entry.moduleId)

const retainedCount = (plan: PluginLoadPlan, kind: (typeof KINDS)[number]): number =>
  Option.getOrElse(HashMap.get(plan.pluginsByKind, kind), () => []).length

const declares = (entry: GeneratedEntry, name: string): boolean => entry.contributionName === name

const extensionWinnerHolds = (
  entries: readonly GeneratedEntry[],
  records: readonly PluginExtensionClaimShadowing[],
): boolean =>
  EXTENSIONS.every((extension) => {
    const claimants = participantsOf(entries, (entry) => entry.extensions.includes(extension))
    const extensionRecords = records.filter((record) => record.extension === extension)
    if (claimants.length <= 1) {
      return extensionRecords.length === 0
    }
    return extensionRecords.length === claimants.length - 1 &&
      extensionRecords.every((record) => record.winnerModule === claimants[0]) &&
      extensionRecords.map((record) => record.loserModule).join('|') === claimants.slice(1).join('|')
  })

const nameWinnerHolds = (
  entries: readonly GeneratedEntry[],
  records: readonly PluginNameShadowing[],
): boolean =>
  KINDS.every((kind) =>
    NAMES.every((name) => {
      const declarers = participantsOf(entries, (entry) => declares(entry, name))
      const nameRecords = records.filter((record) => record.kind === kind && record.name === name)
      if (declarers.length <= 1) {
        return nameRecords.length === 0
      }
      return nameRecords.length === declarers.length - 1 &&
        nameRecords.every((record) => record.winnerModule === declarers[0]) &&
        nameRecords.map((record) => record.loserModule).join('|') === declarers.slice(1).join('|')
    })
  )

describe('buildPluginLoadPlan', () => {
  it.prop(
    '∀e_Plan_⊆nothing-dropped-first-claimant-wins-extensions',
    [fc.uniqueArray(entryArbitrary, { selector: (entry) => entry.contributionName, minLength: 1, maxLength: 3 })],
    ([entries]) => {
      const ordered = [...entries].sort(byModuleId)
      const plan = buildPluginLoadPlan(ordered.map(entryOf))
      const extensionRecords = plan.shadowings.filter(isExtensionShadowing)
      return extensionWinnerHolds(ordered, extensionRecords) &&
        plan.shadowings.filter(isNameShadowing).length === 0 &&
        plan.frameworks.length === ordered.length &&
        plan.outcomes.length === ordered.length &&
        retainedCount(plan, 'Framework') === ordered.length &&
        retainedCount(plan, 'Ignore') === ordered.length
    },
  )

  it.prop(
    '∀e_Plan_=name-shadows-recorded-once',
    [fc.uniqueArray(entryArbitrary, { selector: (entry) => entry.moduleId, minLength: 1, maxLength: 5 })],
    ([entries]) => {
      const ordered = [...entries].sort(byModuleId)
      const plan = buildPluginLoadPlan(ordered.map(entryOf))
      const nameRecords = plan.shadowings.filter(isNameShadowing)
      return nameWinnerHolds(ordered, nameRecords) &&
        plan.shadowings.filter(isExtensionShadowing).every((record) => record.winnerModule !== record.loserModule)
    },
  )
})
