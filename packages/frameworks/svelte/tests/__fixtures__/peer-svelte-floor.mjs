import manifest from '../../package.json' with { type: 'json' }

const floor = manifest.peerDependencies.svelte.replace('>=', '').split('.').slice(0, 2).join('.')

/**
 * @typedef {object} ScriptBlock
 * @property {number} tagStart Offset of the opening tag.
 * @property {number} contentStart Offset the script content begins at.
 * @property {number} contentEnd Offset the script content ends at.
 * @property {number} tagEnd Offset just past the closing tag.
 */

/**
 * @typedef {object} TemplateNode
 * @property {string} type Node kind the compiler reports.
 * @property {string} [name] Element name the compiler reports.
 * @property {readonly TemplateNode[]} [children] Child nodes the walker descends into.
 * @property {number} [start] Character offset the node begins at.
 * @property {number} [end] Character offset the node ends at.
 * @property {TemplateNode} [expression] The expression a mustache tag carries.
 */

/**
 * @param {string} code Markup handed to the compiler.
 * @returns {ScriptBlock[]} The script blocks the markup declares.
 */
const scriptBlocks = (code) => {
  /** @type {ScriptBlock[]} */
  const blocks = []
  const pattern = /<script\b[^>]*>/g
  let match
  while ((match = pattern.exec(code)) !== null) {
    const contentStart = match.index + match[0].length
    const close = code.indexOf('</script>', contentStart)
    if (close === -1) {
      break
    }
    blocks.push({ tagStart: match.index, contentStart, contentEnd: close, tagEnd: close + 9 })
    pattern.lastIndex = close
  }
  return blocks
}

/**
 * @param {string} code Markup handed to the compiler.
 * @param {readonly ScriptBlock[]} blocks The script blocks already located in it.
 * @returns {{ start: number, end: number }[]} The mustache expressions outside those blocks.
 */
const mustacheRanges = (code, blocks) => {
  /** @type {{ start: number, end: number }[]} */
  const ranges = []
  const pattern = /\{([^{}]*)\}/g
  let match
  while ((match = pattern.exec(code)) !== null) {
    const index = match.index
    const insideScript = blocks.some((block) => index >= block.tagStart && index < block.tagEnd)
    if (!insideScript) {
      ranges.push({ start: index + 1, end: index + match[0].length - 1 })
    }
  }
  return ranges
}

/**
 * @param {string} code Markup handed to the compiler.
 * @returns {TemplateNode[]} The nodes the compiler's walk reports.
 */
const nodesOf = (code) => {
  const blocks = scriptBlocks(code)
  const scripts = blocks.map((block) => ({
    type: 'Element',
    name: 'script',
    children: [{ type: 'Text', name: '', children: [], start: block.contentStart, end: block.contentEnd }],
  }))
  const expressions = mustacheRanges(code, blocks).map((range) => ({
    type: 'MustacheTag',
    expression: { type: 'Identifier', name: 'value', start: range.start, end: range.end },
  }))
  return [...scripts, ...expressions]
}

/**
 * @param {TemplateNode} node Root handed to the walker.
 * @param {{ enter: (node: TemplateNode) => void }} handlers Walker callbacks.
 * @returns {void}
 */
const walkNodes = (node, handlers) => {
  handlers.enter(node)
  const children = node.children ?? []
  children.forEach((child) => walkNodes(child, handlers))
}

export const VERSION = `${floor}.0`

/**
 * @param {string} code Markup handed to the compiler.
 * @param {{ script: (script: { content: string, attributes: unknown }) => { code: string } }} handlers Preprocess callbacks.
 * @returns {Promise<{ code: string }>} The markup with each script content replaced by its placeholder.
 */
export const preprocess = (code, handlers) => {
  const blocks = scriptBlocks(code)
  let replaced = ''
  let cursor = 0
  blocks.forEach((block) => {
    replaced += code.slice(cursor, block.contentStart)
    replaced += handlers.script({ content: code.slice(block.contentStart, block.contentEnd), attributes: {} }).code
    cursor = block.contentEnd
  })
  replaced += code.slice(cursor)
  return Promise.resolve({ code: replaced })
}

/**
 * @param {string} code Markup handed to the compiler.
 * @returns {{ html: { children: TemplateNode[] } }} The compiler's own parse result shape.
 */
export const parse = (code) => ({ html: { children: nodesOf(code) } })

/**
 * @param {TemplateNode} node Root handed to the compiler's walker.
 * @param {{ enter: (node: TemplateNode) => void }} handlers Walker callbacks.
 * @returns {void}
 */
export const walk = (node, handlers) => {
  walkNodes(node, handlers)
}
