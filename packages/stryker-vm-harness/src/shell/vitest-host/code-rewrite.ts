type ScannerContext = {
  readonly kind: 'code' | 'template'
  braceDepth: number
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9_$]/.test(char)

const startsTokenAt = (code: string, token: string, index: number): boolean => {
  if (!code.startsWith(token, index)) return false
  const previous = index === 0 ? undefined : code[index - 1]
  if (isWordChar(previous) || previous === '.' || previous === '?') return false
  return !isWordChar(code[index + token.length])
}

const copyLineComment = (code: string, from: number, out: Array<string>): number => {
  let index = from
  while (index < code.length && code[index] !== '\n') {
    out.push(code[index] as string)
    index += 1
  }
  return index
}

const copyBlockComment = (code: string, from: number, out: Array<string>): number => {
  let index = from
  while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) {
    out.push(code[index] as string)
    index += 1
  }
  out.push('*', '/')
  return index + 2
}

const copyQuoted = (code: string, from: number, out: Array<string>): number => {
  const quote = code[from] as string
  let index = from
  out.push(quote)
  index += 1
  while (index < code.length) {
    const char = code[index] as string
    out.push(char)
    index += 1
    if (char === '\\') {
      if (index < code.length) {
        out.push(code[index] as string)
        index += 1
      }
      continue
    }
    if (char === quote) return index
  }
  return index
}

export const replaceCodeToken = (
  code: string,
  token: string,
  replacement: string,
): { readonly code: string; readonly replaced: boolean } => {
  const out: Array<string> = []
  const stack: Array<ScannerContext> = [{ kind: 'code', braceDepth: 0 }]
  let replaced = false
  let index = 0
  while (index < code.length) {
    const context = stack[stack.length - 1] as ScannerContext
    const char = code[index] as string
    const next = code[index + 1]
    if (context.kind === 'template') {
      if (char === '`') {
        stack.pop()
        out.push(char)
        index += 1
        continue
      }
      if (char === '\\') {
        out.push(char)
        if (next !== undefined) out.push(next)
        index += next === undefined ? 1 : 2
        continue
      }
      if (char === '$' && next === '{') {
        stack.push({ kind: 'code', braceDepth: 0 })
        out.push('$', '{')
        index += 2
        continue
      }
      out.push(char)
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      index = copyLineComment(code, index, out)
      continue
    }
    if (char === '/' && next === '*') {
      index = copyBlockComment(code, index, out)
      continue
    }
    if (char === "'" || char === '"') {
      index = copyQuoted(code, index, out)
      continue
    }
    if (char === '`') {
      stack.push({ kind: 'template', braceDepth: 0 })
      out.push(char)
      index += 1
      continue
    }
    if (char === '{') {
      context.braceDepth += 1
      out.push(char)
      index += 1
      continue
    }
    if (char === '}') {
      if (context.braceDepth === 0 && stack.length > 1) {
        stack.pop()
      } else {
        context.braceDepth -= 1
      }
      out.push(char)
      index += 1
      continue
    }
    if (startsTokenAt(code, token, index)) {
      out.push(replacement)
      replaced = true
      index += token.length
      continue
    }
    out.push(char)
    index += 1
  }
  return { code: out.join(''), replaced }
}
