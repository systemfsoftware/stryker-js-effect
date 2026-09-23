export const strykerFrameworks = [
  {
    kind: 'Framework',
    name: 'malformed',
    claim: {
      formatId: 'malformed',
      extensions: ['.malformed'],
      language: 'malformed',
      ownerVersion: '1.0.0',
      contractVersion: '1',
    },
    transform: () => undefined,
    print: () => '',
    disableTypeChecks: (rawContent) => ({ kind: 'Parsed', value: rawContent }),
  },
]
