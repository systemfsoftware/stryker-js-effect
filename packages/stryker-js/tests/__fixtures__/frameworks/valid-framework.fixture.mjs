export const strykerFrameworks = [
  {
    kind: 'Framework',
    name: 'fixture-format',
    claim: {
      formatId: 'fixture',
      extensions: ['.fixture'],
      language: 'fixture',
      ownerVersion: '1.0.0',
      contractVersion: '1',
    },
    parse: (rawContent) => ({ kind: 'Parsed', value: { formatId: 'fixture', rawContent, regions: [] } }),
    transform: (document) => document,
    print: () => '',
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  },
]
