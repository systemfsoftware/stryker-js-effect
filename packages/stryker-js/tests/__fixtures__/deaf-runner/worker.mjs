import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

const options = JSON.parse(await readFile(join(process.env['STRYKER_WORKER_DIR'], 'options.json'), 'utf8'))
await writeFile(options.testRunner.options.pidFile, String(process.pid))

createServer().listen(0, '127.0.0.1')
