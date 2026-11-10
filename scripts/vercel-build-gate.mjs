import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Vercel ignoreCommand: exit 0 skips deployment; exit 1 continues its build. */
export function ignoredBuildExitCode(environment) {
  return environment === 'preview' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = ignoredBuildExitCode(process.env.VERCEL_ENV);
  process.stdout.write(result === 1 ? 'TREFIL_PREVIEW_BUILD_ALLOWED\n' : 'TREFIL_NON_PREVIEW_BUILD_SKIPPED\n');
  process.exitCode = result;
}
