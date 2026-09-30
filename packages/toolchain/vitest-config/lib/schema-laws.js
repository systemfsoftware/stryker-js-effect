import { findExportedSchemas } from '@systemfsoftware/effect-schema-discovery'
import {
  RECURSION_BUDGET_RUNTIME_SPECIFIER,
  recursionBudgetTransform,
} from '@systemfsoftware/effect-schema-recursion-budget'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @import { Plugin } from 'vitest/config' */

const lawModule = '@systemfsoftware/effect-schema-law'
const lawsBinding = '__schemaLaws'

/**
 * @param {string} srcDir
 * @returns {ReadonlyMap<string, ReadonlyArray<string>>}
 */
const schemaNamesByModule = (srcDir) => {
  /** @type {Map<string, string[]>} */
  const byModule = new Map()
  for (const { filePath, name } of findExportedSchemas(srcDir)) {
    byModule.set(filePath, [...(byModule.get(filePath) ?? []), name])
  }
  return byModule
}

/**
 * @param {ReadonlyArray<string>} names
 * @returns {string}
 */
const lawBlockOf = (names) =>
  [
    'if (import.meta.vitest) {',
    `  const ${lawsBinding} = await import('${lawModule}')`,
    ...names.flatMap((name) => [
      `  ${lawsBinding}.ruleOfSchemas('${name}', ${name})`,
      `  ${lawsBinding}.recursionLaws('${name}', ${name})`,
    ]),
    '}',
  ].join('\n')

/** @returns {Plugin} */
export const inSourceSchemaLaws = () => {
  const budgets = recursionBudgetTransform()
  /** @type {ReadonlyMap<string, ReadonlyArray<string>>} */
  let lawsByModule = new Map()
  return {
    name: '@systemfsoftware/vitest-config:in-source-schema-laws',
    enforce: 'pre',
    configResolved(config) {
      lawsByModule = schemaNamesByModule(resolve(config.root, 'src'))
    },
    configureVitest({ project }) {
      const base = project.config.dir || project.config.root
      const notYetCollected = [...lawsByModule.keys()].filter((file) => !project.matchesTestGlob(file))
      project.config.include.push(...notYetCollected.map((file) => relative(base, file)))
    },
    resolveId(source) {
      return source === RECURSION_BUDGET_RUNTIME_SPECIFIER
        ? fileURLToPath(import.meta.resolve(RECURSION_BUDGET_RUNTIME_SPECIFIER))
        : null
    },
    transform(code, id) {
      const budgeted = budgets.transform(code, id)
      const names = lawsByModule.get(id.split('?')[0] ?? id)
      if (names === undefined) return budgeted
      return `${budgeted ?? code}\n${lawBlockOf(names)}\n`
    },
  }
}
