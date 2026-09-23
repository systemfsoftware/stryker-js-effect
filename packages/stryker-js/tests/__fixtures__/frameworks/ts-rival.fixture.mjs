export const strykerFrameworks = [
  {
    kind: 'Framework',
    name: 'ts-rival',
    claim: {
      formatId: 'ts-rival',
      extensions: ['.ts'],
      language: 'ts-rival',
      ownerVersion: '1.0.0',
      contractVersion: '1',
    },
    parse: (rawContent) => ({ kind: 'Parsed', value: { formatId: 'ts-rival', rawContent, regions: [] } }),
    transform: (document) => document,
    print: () => '',
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  },
]
