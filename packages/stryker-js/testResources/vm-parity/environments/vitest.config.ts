import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        url: 'https://happy-dom.example/dashboard',
      },
    },
    exclude: ['**/node_modules/**', '**/dist/**', 'node/**'],
  },
})
