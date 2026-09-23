import type { SvelteCompilerModule, SvelteWalkFn } from '../../src/svelte-format.js'

const childrenOf = (node: unknown): readonly unknown[] => {
  if (typeof node !== 'object' || node === null) {
    return []
  }
  const children: unknown = Reflect.get(node, 'children')
  return Array.isArray(children) ? children : []
}

const walkChildren = (node: unknown, enter: (node: unknown) => void): void => {
  enter(node)
  for (const child of childrenOf(node)) {
    walkChildren(child, enter)
  }
}

export const testWalker: SvelteWalkFn = (root, handlers) => walkChildren(root, handlers.enter)

export const shapelessCompiler: unknown = { shapeless: true }

export const noHtmlCompiler: SvelteCompilerModule = {
  VERSION: '3.30.0',
  parse: () => ({}),
  walk: testWalker,
}

export const rangelessScriptCompiler: SvelteCompilerModule = {
  VERSION: '3.30.0',
  parse: () => ({ html: {}, instance: { content: {} } }),
  walk: testWalker,
}

export const throwingCompiler = (cause: unknown): SvelteCompilerModule => ({
  VERSION: '3.30.0',
  parse: () => {
    throw cause
  },
  walk: testWalker,
})

const elementScriptCompiler = (scripts: readonly unknown[]): SvelteCompilerModule => ({
  VERSION: '3.30.0',
  parse: () => ({ html: { children: scripts } }),
  walk: testWalker,
})

export const scriptElementCompiler: SvelteCompilerModule = elementScriptCompiler([
  {
    type: 'Element',
    name: 'script',
    attributes: [],
    children: [{ type: 'Text', start: 8, end: 28 }],
  },
  {
    type: 'MustacheTag',
    expression: { type: 'Identifier', start: 42, end: 43 },
  },
])

export const childlessScriptCompiler: SvelteCompilerModule = elementScriptCompiler([
  { type: 'Element', name: 'script', attributes: [], children: [] },
  { type: 'MustacheTag', expression: {} },
])

export const langAttributeCompiler: SvelteCompilerModule = elementScriptCompiler([
  {
    type: 'Element',
    name: 'script',
    attributes: [{ type: 'Attribute', name: 'lang', value: [{ type: 'Text', data: 'ts' }] }],
    children: [{ type: 'Text', start: 8, end: 28 }],
  },
])

export const swappedScriptsCompiler: SvelteCompilerModule = {
  VERSION: '3.30.0',
  parse: () => ({
    html: {},
    instance: { content: { start: 8, end: 30 }, attributes: [] },
    module: { content: { start: 40, end: 62 }, attributes: [] },
  }),
  walk: testWalker,
}

export const hashbangCompiler: SvelteCompilerModule = {
  VERSION: '3.30.0',
  parse: (code) => ({
    html: {},
    instance: { content: { start: 8, end: code.indexOf('</script>') }, attributes: [] },
  }),
  walk: testWalker,
}

export const hashbangSource = (body: string): string => `<script>${body}</script>\n`
