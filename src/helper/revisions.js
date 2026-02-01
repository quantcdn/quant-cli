import fs from 'fs';
import path from 'path';
import config from '../config.js';

let isEnabled = false;
let revisions = {};
let revisionFile;

export function load(file) {
  // If no file path provided, use current working directory
  if (!file) {
    const projectName = config.get('project');
    file = path.resolve(process.cwd(), `quant-revision-log_${projectName}`);
  }

  revisionFile = file;

  try {
    const data = fs.readFileSync(revisionFile);
    revisions = JSON.parse(data);
  } catch (_err) {
    // File doesn't exist or is invalid JSON - start with empty revisions
    revisions = {};
  }
}

export function save() {
  if (!revisionFile) {
    const projectName = config.get('project');
    revisionFile = path.resolve(process.cwd(), `quant-revision-log_${projectName}`);
  }

  fs.writeFileSync(revisionFile, JSON.stringify(revisions, null, 2));
}

export function store(meta) {
  if (!isEnabled) {
    return;
  }

  revisions[meta.url] = meta;
}

export function has(url, md5) {
  if (!isEnabled) {
    return false;
  }

  return revisions[url] && revisions[url].md5 === md5;
}

export function enabled(value = null) {
  if (value !== null) {
    isEnabled = value;
  }

  return isEnabled;
}

export default {
  load,
  save,
  store,
  has,
  enabled
};
