import { createRequire } from 'node:module'

const effectPackageDir = process.env['SKEW_EFFECT_DIR']
const runnerManifest = process.env['SKEW_RUNNER_MANIFEST']
const outDir = process.env['SKEW_OUT_DIR']

if (effectPackageDir === undefined || runnerManifest === undefined || outDir === undefined) {
  throw new Error('SKEW_EFFECT_DIR, SKEW_RUNNER_MANIFEST and SKEW_OUT_DIR must all be set')
}

const requireFromSkewedEffect = createRequire(`${effectPackageDir}/package.json`)
const requireFromPackagingHost = createRequire(runnerManifest)

const isEffect = (source) => source === 'effect' || source.startsWith('effect/')
const isFromPackagingHost = (source) => source.startsWith('@effect/') || source.startsWith('@systemfsoftware/')

const skewResolver = {
  name: 'effect-release-skew',
  resolveId(source) {
    if (isEffect(source)) return requireFromSkewedEffect.resolve(source)
    if (isFromPackagingHost(source)) return requireFromPackagingHost.resolve(source)
    return null
  },
}

export default {
  entry: {
    index: new URL('./src/index.ts', import.meta.url).pathname,
    main: new URL('./src/main.ts', import.meta.url).pathname,
  },
  outDir,
  format: 'esm',
  platform: 'node',
  dts: false,
  clean: true,
  shims: true,
  deps: { alwaysBundle: [/./], neverBundle: [/^vitest(\/|$)/] },
  plugins: [skewResolver],
}
