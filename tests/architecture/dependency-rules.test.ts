import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it } from 'vitest';

const execFileAsync = promisify(execFile);

/**
 * Runs the exact same dependency-cruiser rule set `npm run arch:check` uses, but as part of
 * `npm test` — so a hexagonal-layering violation (e.g. application importing an infrastructure
 * repository directly, or a route reaching into RevenueRepository) fails CI the same way a
 * broken unit test would, instead of requiring a separate manual command.
 */
describe('Architecture: dependency-cruiser rules', () => {
  it('has zero dependency-cruiser violations across src/', async () => {
    try {
      await execFileAsync('npx', ['depcruise', '--config', '.dependency-cruiser.cjs', 'src'], {
        cwd: process.cwd(),
      });
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout ?? '';
      const stderr = (error as { stderr?: string }).stderr ?? '';
      throw new Error(`dependency-cruiser reported violations:\n${stdout}\n${stderr}`);
    }
  });
});
