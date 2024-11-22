const fs = require('fs');
const path = require('path');

let isEnabled = false;
let revisions = {};
let revisionFile;

function load(file) {
  // If no file path provided, use current working directory
  if (!file) {
    const projectName = require('../config').get('project');
    file = path.resolve(process.cwd(), `quant-revision-log_${projectName}`);
  }

  revisionFile = file;

  try {
    const data = fs.readFileSync(revisionFile);
    revisions = JSON.parse(data);
  } catch (err) {
    // File doesn't exist or is invalid JSON - start with empty revisions
    revisions = {};
  }
}

function save() {
  if (!revisionFile) {
    const projectName = require('../config').get('project');
    revisionFile = path.resolve(process.cwd(), `quant-revision-log_${projectName}`);
  }

  fs.writeFileSync(revisionFile, JSON.stringify(revisions, null, 2));
}

function store(meta) {
  if (!isEnabled) {
    return;
  }

  revisions[meta.url] = meta;
}

function has(url, md5) {
  if (!isEnabled) {
    return false;
  }

  return revisions[url] && revisions[url].md5 === md5;
}

function enabled(value = null) {
  if (value !== null) {
    isEnabled = value;
  }

  return isEnabled;
}

module.exports = {
  load,
  save,
  store,
  has,
  enabled,
};
