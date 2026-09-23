export default {
  extends: './base.ts',
  plugins: ['file:///acme/explicit/index.mjs'],
  thresholds: { high: 71 },
}
