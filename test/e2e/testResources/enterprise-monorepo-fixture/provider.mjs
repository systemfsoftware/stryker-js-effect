const flipRiskTag = (node) =>
  node.type === 'Literal' && node.value === 'block' ? [{ type: 'Literal', value: 'hold', raw: null }] : []

export const strykerMutators = {
  namespace: 'guards',
  entries: [
    {
      id: 'flip-risk-tag',
      name: 'guards/FlipRiskTag',
      tier: 'default',
      definition: 'Replace the "block" risk tag with "hold".',
      examples: [{ before: "'block'", after: ['"hold"'] }],
      implementation: flipRiskTag,
    },
  ],
}
