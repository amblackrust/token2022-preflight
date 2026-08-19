import { runCli } from './index.js';

const exitCode = await runCli(process.argv.slice(2), process.env, {
  writeStdout: (value) => process.stdout.write(value),
  writeStderr: (value) => process.stderr.write(value),
});

process.exitCode = exitCode;
