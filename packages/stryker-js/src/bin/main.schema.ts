import * as Runtime from 'effect/Runtime'
import * as S from 'effect/Schema'

export class UnsupportedNodeVersion extends S.TaggedError<UnsupportedNodeVersion>()('UnsupportedNodeVersion', {
  version: S.String,
  required: S.String,
}) {
  override readonly [Runtime.errorReported] = false
  override get message(): string {
    return `Node.js version ${this.version} detected. StrykerJS requires version to match ${this.required}. Please update your Node.js version or visit https://nodejs.org/ for additional instructions`
  }
}
