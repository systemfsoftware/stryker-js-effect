import { Arr, Result } from 'effect'

const printedFile = (name: string): Result.Result<ReadonlyArray<{ name: string }>, string> =>
  Result.succeed([{ name }])

const parsed = [{ file: 'a' }, { file: 'b' }]

const flatMapped = Arr.flatMap(parsed, ({ file }) => printedFile(file))
console.log('flatMapped length:', flatMapped.length, 'isResult[0]:', Result.isResult(flatMapped[0]))

const all = Result.all(flatMapped)
console.log('all success:', Result.isSuccess(all))
if (Result.isSuccess(all)) {
  console.log('files:', all.success.length, JSON.stringify(all.success.flat()))
} else {
  console.log('failure:', all.failure)
}
