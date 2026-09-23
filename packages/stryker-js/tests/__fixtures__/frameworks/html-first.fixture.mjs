export const strykerFrameworks = [
  {
    kind: 'Framework',
    name: 'html-first',
    claim: {
      formatId: 'html-first',
      extensions: ['.html'],
      language: 'html',
      ownerVersion: '1.0.0',
      contractVersion: '1',
    },
    parse: (rawContent) => ({ kind: 'Parsed', value: { formatId: 'html-first', rawContent, regions: [] } }),
    transform: (document) => document,
    print: () => '',
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  },
]
