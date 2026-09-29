import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export type HeaderPattern = RegExp
export type FramingBytes = Uint8Array

export const CONTENT_LENGTH_HEADER: HeaderPattern = /content-length:\s*(\d+)/iu

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const encodeUtf8 = (text: string): FramingBytes => textEncoder.encode(text)

export const decodeUtf8 = (bytes: FramingBytes): string => textDecoder.decode(bytes)

export const FramingBuffer = S.Struct({ bytes: S.Uint8Array })
export type FramingBuffer = typeof FramingBuffer.Type

export const emptyFraming: FramingBuffer = { bytes: new Uint8Array(0) }

export const FramingStep = S.Struct({
  buffer: FramingBuffer,
  frames: S.Array(S.String),
  errors: S.Array(S.String),
})
export type FramingStep = typeof FramingStep.Type

const HEADER_END_BYTES: FramingBytes = new Uint8Array([13, 10, 13, 10])

const HEADERLESS = 'a Content-Length header was expected before the message body'

const concat = (left: FramingBytes, right: FramingBytes): FramingBytes => {
  if (left.length === 0) {
    return right
  }
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left, 0)
  joined.set(right, left.length)
  return joined
}

const isHeaderEndAt = (bytes: FramingBytes, index: number): boolean =>
  HEADER_END_BYTES.every((byte, offset) => bytes[index + offset] === byte)

const headerEndOf = (bytes: FramingBytes): Option.Option<number> =>
  Option.map(
    Option.filter(Option.fromUndefinedOr(bytes.findIndex((_byte, index) => isHeaderEndAt(bytes, index))), (found) =>
      found >= 0),
    (found) =>
      found + HEADER_END_BYTES.length,
  )

const declaredLengthOf = (header: string): Option.Option<number> =>
  Option.filter(
    Option.map(Option.fromNullishOr(CONTENT_LENGTH_HEADER.exec(header)), (match) => Number(match[1])),
    (size) => Number.isSafeInteger(size) && size >= 0,
  )

export const IncompleteAction = S.TaggedStruct('Incomplete', { rest: S.Uint8Array })
export const FrameAction = S.TaggedStruct('Frame', { rest: S.Uint8Array, frame: S.String })
export const HeaderlessAction = S.TaggedStruct('Headerless', { rest: S.Uint8Array })

export type FramingAction =
  | typeof IncompleteAction.Type
  | typeof FrameAction.Type
  | typeof HeaderlessAction.Type

interface FramingState {
  readonly rest: FramingBytes
  readonly frames: Array<string>
  readonly errors: Array<string>
}

const bodyActionOf = (bytes: FramingBytes, headerEnd: number, size: number): FramingAction =>
  Match.value(bytes.length - headerEnd < size).pipe(
    Match.when(true, () => IncompleteAction.make({ rest: bytes })),
    Match.when(false, () =>
      FrameAction.make({
        rest: bytes.subarray(headerEnd + size),
        frame: decodeUtf8(bytes.subarray(headerEnd, headerEnd + size)),
      })),
    Match.exhaustive,
  )

const withinHeader = (bytes: FramingBytes, headerEnd: number): FramingAction =>
  Option.match(declaredLengthOf(decodeUtf8(bytes.subarray(0, headerEnd))), {
    onNone: () => HeaderlessAction.make({ rest: bytes.subarray(headerEnd) }),
    onSome: (size) => bodyActionOf(bytes, headerEnd, size),
  })

const actionOf = (bytes: FramingBytes): FramingAction =>
  Option.match(headerEndOf(bytes), {
    onNone: () => IncompleteAction.make({ rest: bytes }),
    onSome: (headerEnd) => withinHeader(bytes, headerEnd),
  })

const readStep = (state: FramingState): FramingStep =>
  Match.value(actionOf(state.rest)).pipe(
    Match.tag('Incomplete', () => ({ buffer: { bytes: state.rest }, frames: state.frames, errors: state.errors })),
    Match.tag('Frame', (frame) => {
      state.frames.push(frame.frame)
      return readStep({ ...state, rest: frame.rest })
    }),
    Match.tag('Headerless', (headerless) => {
      state.errors.push(HEADERLESS)
      return readStep({ ...state, rest: headerless.rest })
    }),
    Match.exhaustive,
  )

export type FramingReader = {
  (buffer: FramingBuffer, chunk: FramingBytes): FramingStep
  (chunk: FramingBytes): (buffer: FramingBuffer) => FramingStep
}

export const readFrames: FramingReader = dual(
  2,
  (buffer: FramingBuffer, chunk: FramingBytes): FramingStep =>
    readStep({ rest: concat(buffer.bytes, chunk), frames: [], errors: [] }),
)

export const frameOf = (payload: string): FramingBytes => {
  const body = encodeUtf8(payload)
  return concat(encodeUtf8(`Content-Length: ${body.length}\r\n\r\n`), body)
}
