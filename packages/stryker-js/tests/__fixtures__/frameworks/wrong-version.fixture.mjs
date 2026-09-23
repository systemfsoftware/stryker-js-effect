export const strykerFrameworks = [
  {
    kind: 'Framework',
    name: 'wrong-version',
    claim: {
      formatId: 'wrong-version',
      extensions: ['.wrong-version'],
      language: 'wrong-version',
      ownerVersion: '1.0.0',
      contractVersion: '2',
    },
    parse: (rawContent) => ({ kind: 'Parsed', value: { formatId: 'wrong-version', rawContent, regions: [] } }),
    transform: (document) => document,
    print: () => '',
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  },
]
