/**
 * Get a file list for a given directory.
 */

import fs from 'fs';
import { promisify } from 'util';
import { resolve, basename } from 'path';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Get files from a directory.
 *
 * @param {string} dir
 *   The directory from which to get files.
 * @param {array} exclusions
 *   A list of exclusions.
 *
 * @return {array}
 *   An array of files.
 */
export async function getFiles(dir, exclusions = []) {
  const files = await walk(dir);
  const isExcluded = buildExclusionTest(exclusions);
  return files.filter((f) => !isExcluded(f));
}

/**
 * Recursively list all files under a directory as a flat array.
 */
async function walk(dir) {
  const entries = await readdir(dir);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const res = resolve(dir, entry);
      return (await stat(res)).isDirectory() ? walk(res) : res;
    })
  );
  return nested.flat();
}

/**
 * Build a path test. A file named quant.json (any case, any depth) is
 * always excluded; it can hold a live token. Extra exclusions are regex
 * sources. No global flag, so no state is shared between calls.
 */
function buildExclusionTest(exclusions) {
  const extra = exclusions.length ? new RegExp(exclusions.join('|'), 'i') : null;
  return (file) =>
    basename(file).toLowerCase() === 'quant.json' || (extra !== null && extra.test(file));
}

export default getFiles;
