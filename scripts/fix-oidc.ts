#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-read --allow-write --allow-run=git,pnpm,npm --allow-env=GITHUB_REPOSITORY --allow-net=registry.npmjs.org --allow-import

import { parseArgs } from '@std/cli/parse-args'
import {
  expectedSlug,
  packageExistsOnRegistry,
  publicWorkspacePackages,
  trustCommand,
  WORKFLOW_FILE,
  type WorkspacePackage,
} from './lib/oidc.ts'

const flags = parseArgs(Deno.args, {
  boolean: ['fix', 'assert', 'generate-script'],
  string: ['output-script', 'workflow'],
})

const workflowFile = flags.workflow ?? WORKFLOW_FILE
const currentSlug = await expectedSlug()
console.log(`Repository target slug: ${currentSlug}`)
console.log(`Workflow file: ${workflowFile}`)

const packages = await publicWorkspacePackages()
console.log(`Found ${packages.length} public workspace package(s).`)

const driftedPackages: { pkg: WorkspacePackage; currentUrl: string }[] = []
for (const pkg of packages) {
  if (pkg.repositorySlug !== currentSlug) {
    driftedPackages.push({ pkg, currentUrl: pkg.repositorySlug ?? 'none' })
  }
}

if (driftedPackages.length > 0) {
  console.log(`\nDetected ${driftedPackages.length} package.json file(s) with mismatched repository slug:`)
  for (const { pkg } of driftedPackages) {
    console.log(`  - ${pkg.name}: ${pkg.repositorySlug ?? '(missing)'} (expected ${currentSlug})`)
  }

  if (flags.fix) {
    console.log(`\nFixing repository fields in package.json files...`)
    for (const { pkg } of driftedPackages) {
      const content = await Deno.readTextFile(pkg.filePath)
      const parsed = JSON.parse(content)
      if (typeof parsed.repository === 'object' && parsed.repository !== null) {
        parsed.repository.url = `git+https://github.com/${currentSlug}.git`
      } else {
        parsed.repository = `git+https://github.com/${currentSlug}.git`
      }
      await Deno.writeTextFile(pkg.filePath, JSON.stringify(parsed, null, 2) + '\n')
      console.log(`  Updated ${pkg.name}`)
    }
  }
} else {
  console.log(`All package.json repository fields match ${currentSlug}.`)
}

console.log(`\nChecking npm registry presence and generating trusted publisher commands...`)
const commands: string[] = []
const uncreatedPackages: string[] = []

for (const pkg of packages) {
  const exists = await packageExistsOnRegistry(pkg.name)
  if (!exists) {
    uncreatedPackages.push(pkg.name)
  }
  commands.push(trustCommand(pkg.name, currentSlug, workflowFile))
}

if (uncreatedPackages.length > 0) {
  console.log(`\nNote: The following package(s) have never been published to npm:`)
  for (const name of uncreatedPackages) {
    console.log(`  - ${name}`)
  }
  console.log(
    `npm trusted publishing requires a package to already exist on npm (registered with 2FA/token once), OR configured via npmjs.com web UI if supported.`,
  )
}

const scriptContent =
  `#!/usr/bin/env bash\nset -euo pipefail\n\n# Configure npm trusted publishing for repository ${currentSlug}\n# Run this locally with an authenticated npm session (npm login with 2FA)\n\n${
    commands.join('\n')
  }\n`

if (flags['output-script']) {
  await Deno.writeTextFile(flags['output-script'], scriptContent, { mode: 0o755 })
  console.log(`\nWrote remediation script to ${flags['output-script']}`)
} else if (flags['generate-script']) {
  console.log(`\n--- npm trusted publisher remediation commands ---`)
  console.log(scriptContent)
}

if (flags.assert && driftedPackages.length > 0 && !flags.fix) {
  console.error(
    `\n::error::Repository slug drift detected in ${driftedPackages.length} package.json file(s). Run \`./scripts/fix-oidc.ts --fix\` to align.`,
  )
  Deno.exit(1)
}
