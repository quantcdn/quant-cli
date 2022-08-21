/**
 * Deploy the configured build directory to QuantCDN.
 *
 * @usage
 *  quant deploy <dir>
 */
const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const normalizePaths = require('../helper/normalizePaths');
const path = require('path');
const yargs = require('yargs');
const md5File = require('md5-file');
const {chunk} = require('../helper/array');
const io = require('../io');

const command = {};

command.command = 'deploy [dir]';
command.describe = 'Deploy the output of a static generator';
command.builder = (yargs) => {
  yargs.positional('dir', {
    describe: 'Optional location of build artefacts ',
    type: 'string',
    default: null,
  });
  yargs.options('attachments', {
    describe: 'Find attachments',
    alias: 'a',
    type: 'boolean',
    default: false,
  });
  yargs.options('skip-unpublish', {
    describe: 'Skip the automatic unpublish process',
    alias: 'u',
    type: 'boolean',
    default: false,
  });
  yargs.options('skip-unpublish-regex', {
    describe: 'Skip the unpublish process for specific regex',
    type: 'string',
  });
  yargs.options('skip-purge', {
    describe: 'Skip the automatic cache purge process',
    alias: 'sp',
    type: 'boolean',
    default: false,
  });
  yargs.option('chunk-size', {
    describe: 'Control the chunk-size for concurrency',
    alias: 'cs',
    type: 'integer',
    default: 10,
  });
};

command.handler = async function(argv) {
  let files;

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  io.title('Quant deploy');

  const dir = argv.dir || config.get('dir');
  const p = path.resolve(process.cwd(), dir);
  const quant = client(config);

  try {
    await quant.ping();
  } catch (err) {
    io.critical('Unable to connect to Quant: ' + err.message);
    yargs.exit(1);
  }

  try {
    files = await getFiles(p);
  } catch (err) {
    io.critical(err.message);
    yargs.exit(1);
  }

  // Chunk the files array into smaller pieces to handle
  // concurrency with the api requests.
  if (argv['chunk-size'] > 20) {
    argv['chunk-size'] = 20;
  }
  files = chunk(files, argv['chunk-size']);

  for (let i = 0; i < files.length; i++) {
    await Promise.all(files[i].map(async (file) => {
      let filepath = path.relative(p, file);
      filepath = normalizePaths(filepath);

      let revision = false;

      try {
        revision = await quant.revisions(filepath);
      } catch (err) {}

      if (revision) {
        const md5 = md5File.sync(file);
        if (md5 == revision.md5) {
          io.notice(`Published version is up-to-date (${filepath})`);
          return;
        }
      }
      try {
        await quant.send(file, filepath, true, argv.attachments, argv['skip-purge']);
      } catch (err) {
        io.info(err.message + ` (${filepath})`);
        return;
      }
      io.update(filepath);
    }));
  }

  if (argv['skip-unpublish']) {
    io.info(' -> Skipping the automatic unpublish process');
    yargs.exit(0);
  }

  try {
    data = await quant.meta(true);
  } catch (err) {
    io.info(err.message);
  }

  // Quant meta returns relative paths, so we map our local filesystem
  // to relative URL paths so that we can do a simple [].includes to
  // determine if we need to unpublish the URL.
  const relativeFiles = [];
  for (let i = 0; i < files.length; i++) {
    // Quant URLs are all lowercase, relative paths need to be made lc for comparison.
    await Promise.all(files[i].map((item) => relativeFiles.push(`/${path.relative(p, item).toLowerCase()}`)));
  }

  if (!data || ! 'records' in data) {
    // The API doesn't return meta data if nothing has previously been
    // pushed for the project.
    return;
  }

  data.records.map(async (item) => {
    const f = item.url.replace('/index.html', '.html');
    if (relativeFiles.includes(item.url) || relativeFiles.includes(f)) {
      return;
    }
    try {
      // Skip unpublish process if skip unpublish regex matches.
      if (argv['skip-unpublish-regex']) {
        const match = item.url.match(argv['skip-unpublish-regex']);
        if (match) {
          io.notice(`Skipping unpublish via regex match: (${item.url})`);
          return;
        }
      }
      await quant.unpublish(item.url);
    } catch (err) {
      io.info(err.message + ` (${item.url})`);
      return;
    }
    io.update(`${item.url} unpublished`);
  });

  /* eslint-enable guard-for-in */
};

module.exports = command;
