import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentOptions: {
      jsdom: {
        url: 'https://jsdom.example/page',
      },
    },
  },
})
