export const VITEST_RUNNER_DIR = 'packages/stryker-js-vitest-runner'
export const TYPESCRIPT_CHECKER_DIR = 'packages/stryker-js-typescript-checker'
export const IGNORER_DIRS = [
  'packages/ignorers/effect-schema-declarations',
  'packages/ignorers/in-source-vitest-block',
] as const

export const ENGINE_BUILD_DIRS = [
  'packages/stryker-js',
  VITEST_RUNNER_DIR,
  TYPESCRIPT_CHECKER_DIR,
  ...IGNORER_DIRS,
] as const
