import { defineConfig } from '@systemfsoftware/stryker-js/config'

const endpoint = process.env['VERDICT_STORE_ENDPOINT']

if (endpoint === undefined || endpoint === '') {
  throw new Error('stryker.s3.config.ts needs VERDICT_STORE_ENDPOINT, the S3 endpoint the run stores verdicts at')
}

export default defineConfig({
  testRunner: 'vm',
  testFiles: ['src/**/*.test.ts'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  reporters: ['json'],
  verdictStore: {
    kind: 's3',
    bucket: 'stryker-verdicts',
    prefix: 'e2e/',
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
  },
})
