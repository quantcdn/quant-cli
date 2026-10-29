/**
 * Get a file list for a given directory.
 */

import fs from 'fs';
import { promisify } from 'util';
import { resolve, basename, dirname } from 'path';

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
 * True for any file whose name contains quant.json (any case): quant.json,
 * quant.json.bak, .quant.json.swp, quant.json~, myquant.json and so on.
 * These can hold a live token. quantXjson does not match.
 */
const QUANT_JSON = /quant\.json/i;
function isQuantJson(file) {
  return QUANT_JSON.test(basename(file));
}

/**
 * True for quant/serve.json (any case): the local settings of `quant serve`.
 * It can hold a basic authentication password, and it is never deployed.
 */
function isServeConfig(file) {
  return basename(file).toLowerCase() === 'serve.json' && basename(dirname(file)).toLowerCase() === 'quant';
}

/**
 * Build a path test. Extra exclusions are regex sources. No global flag,
 * so no state is shared between calls.
 */
function buildExclusionTest(exclusions) {
  const extra = exclusions.length ? new RegExp(exclusions.join('|'), 'i') : null;
  return (file) => isQuantJson(file) || isServeConfig(file) || (extra !== null && extra.test(file));
}

export default getFiles;
