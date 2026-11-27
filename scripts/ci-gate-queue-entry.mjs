// Entry point for the bundled CI gate queue step (media/bin/atlasmind-ci-gate.mjs).
// The logic lives in src/cli/ciGateQueue.ts and src/core/ciGateQueue.ts; this
// file only connects it to the process, so the TypeScript stays importable by
// the extension and the tests.
import { runCiGateQueueCli } from '../src/cli/ciGateQueue.ts';

process.exitCode = await runCiGateQueueCli(process.argv.slice(2), process.env, {
  log: line => console.log(line),
  error: line => console.error(line),
});
