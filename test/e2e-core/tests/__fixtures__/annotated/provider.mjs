const flipSide = (node) =>
  node.type === 'Literal' && node.value === 'left' ? [{ type: 'Literal', value: 'right', raw: null }] : []

export const strykerMutators = {
  namespace: 'acme',
  entries: [
    {
      id: 'flip-side',
      name: 'acme/FlipSide',
      tier: 'default',
      definition: 'Replace a "left" string literal with "right".',
      examples: [{ before: "'left'", after: ['"right"'] }],
      implementation: flipSide,
    },
  ],
}
