const flipOther = (node) =>
  node.type === 'Literal' && node.value === 'right' ? [{ type: 'Literal', value: 'left', raw: null }] : []

export const strykerMutators = {
  namespace: 'acme',
  entries: [
    {
      id: 'flip-other',
      name: 'acme/FlipOther',
      tier: 'default',
      definition: 'Replace a "right" string literal with "left".',
      examples: [{ before: '"right"', after: ["'left'"] }],
      implementation: flipOther,
    },
  ],
}
