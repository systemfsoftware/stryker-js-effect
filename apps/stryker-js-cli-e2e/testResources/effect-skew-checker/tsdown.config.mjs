import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

const effectPackageDir = process.env['SKEW_EFFECT_DIR']
const runnerManifest = process.env['SKEW_RUNNER_MANIFEST']
const outDir = process.env['SKEW_OUT_DIR']

if (effectPackageDir === undefined || runnerManifest === undefined || outDir === undefined) {
  throw new Error('SKEW_EFFECT_DIR, SKEW_RUNNER_MANIFEST and SKEW_OUT_DIR must all be set')
}

const runnerDirectory = dirname(runnerManifest)

const entryOf = (packageDirectory, subpath) => {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
  const exportsMap = manifest.exports ?? {}
  const candidate = subpath === undefined
    ? exportsMap['.']
    : exportsMap[`./${subpath}`] ?? exportsMap['./*']?.replace('*', subpath)
  const relative = typeof candidate === 'string' ? candidate : candidate?.default
  if (typeof relative !== 'string') {
    throw new Error(`no module entry for "${subpath ?? '.'}" in ${packageDirectory}`)
  }
  return join(realpathSync(packageDirectory), relative)
}

const skewedEffectEntryOf = (source) =>
  entryOf(effectPackageDir, source === 'effect' ? undefined : source.slice('effect/'.length))

const packagingHostEntryOf = (source) => {
  const segments = source.split('/')
  const packageSegmentCount = source.startsWith('@') ? 2 : 1
  const subpath = segments.slice(packageSegmentCount).join('/')
  return entryOf(
    join(runnerDirectory, 'node_modules', segments.slice(0, packageSegmentCount).join('/')),
    subpath === '' ? undefined : subpath,
  )
}

const isEffect = (source) => source === 'effect' || source.startsWith('effect/')
const isFromPackagingHost = (source) => source.startsWith('@effect/') || source.startsWith('@systemfsoftware/')

const skewResolver = {
  name: 'effect-release-skew',
  resolveId(source) {
    if (isEffect(source)) return skewedEffectEntryOf(source)
    if (isFromPackagingHost(source)) return packagingHostEntryOf(source)
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
