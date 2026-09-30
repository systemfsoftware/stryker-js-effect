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

/**
 * @param {string} srcDir
 * @returns {ReadonlyMap<string, string>}
 */
const lawBlocksByModule = (srcDir) => {
  /** @type {Map<string, string[]>} */
  const namesByModule = new Map()
  for (const { filePath, name } of findExportedSchemas(srcDir)) {
    const names = namesByModule.get(filePath)
    if (names === undefined) namesByModule.set(filePath, [name])
    else names.push(name)
  }
  return new Map([...namesByModule].map(([filePath, names]) => [filePath, lawBlockOf(names)]))
}

/** @returns {Plugin} */
export const inSourceSchemaLaws = () => {
  const budgets = recursionBudgetTransform()
  /** @type {ReadonlyMap<string, string>} */
  let lawBlocks = new Map()
  return {
    name: '@systemfsoftware/vitest-config:in-source-schema-laws',
    enforce: 'pre',
    configResolved(config) {
      lawBlocks = lawBlocksByModule(resolve(config.root, 'src'))
    },
    configureVitest({ project }) {
      const base = project.config.dir || project.config.root
      const notYetCollected = [...lawBlocks.keys()].filter((file) => !project.matchesTestGlob(file))
      project.config.include.push(...notYetCollected.map((file) => relative(base, file)))
    },
    resolveId(source) {
      return source === RECURSION_BUDGET_RUNTIME_SPECIFIER
        ? fileURLToPath(import.meta.resolve(RECURSION_BUDGET_RUNTIME_SPECIFIER))
        : null
    },
    transform(code, id) {
      const budgeted = budgets.transform(code, id)
      const lawBlock = lawBlocks.get(id.split('?')[0] ?? id)
      if (lawBlock === undefined) return budgeted
      return `${budgeted ?? code}\n${lawBlock}\n`
    },
  }
}
