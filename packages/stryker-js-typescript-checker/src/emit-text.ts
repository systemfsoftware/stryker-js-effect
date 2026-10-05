const SOURCE_MAP_COMMENT = /^\/\/# sourceMappingURL=.*$/gmu

export const normalizeEmit = (emit: string): string =>
  emit
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .replace(SOURCE_MAP_COMMENT, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()
