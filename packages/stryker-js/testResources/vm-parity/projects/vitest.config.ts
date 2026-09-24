import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit-node',
          include: ['src/node/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./src/setup.node.ts'],
        },
      },
      {
        test: {
          name: 'unit-dom',
          include: ['src/dom/**/*.test.ts'],
          environment: 'happy-dom',
          setupFiles: ['./src/setup.dom.ts'],
        },
      },
    ],
  },
})
