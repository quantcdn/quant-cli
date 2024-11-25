const { text, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');
const md5File = require('md5-file');
const { chunk } = require('../helper/array');
const revisions = require('../helper/revisions');
const isMD5Match = require('../helper/is-md5-match');

const command = {
  command: 'deploy [dir]',
  describe: 'Deploy the output of a static generator',
  
  builder: (yargs) => {
    return yargs
      .positional('dir', {
        describe: 'Directory containing static assets',
        type: 'string'
      })
      .option('attachments', {
        describe: 'Deploy attachments',
        type: 'boolean',
        default: false,
        hidden: true
      })
      .option('skip-unpublish', {
        describe: 'Skip the unpublish process',
        type: 'boolean',
        default: false
      })
      .option('skip-unpublish-regex', {
        describe: 'Skip the unpublish process for specific regex',
        type: 'string'
      })
      .option('enable-index-html', {
        describe: 'Keep index.html in URLs',
        type: 'boolean',
        default: false
      })
      .option('chunk-size', {
        describe: 'Number of files to process at once',
        type: 'number',
        default: 10
      })
      .option('force', {
        describe: 'Force deployment even if files exist',
        type: 'boolean',
        default: false
      })
      .option('revision-log', {
        describe: 'Path to revision log file',
        type: 'string',
        hidden: true
      });
  },

  async promptArgs(providedArgs = {}) {
    const configDir = config.get('dir') || 'build';
    
    let dir = providedArgs.dir;
    if (!dir) {
      dir = await text({
        message: 'Enter the build directory to deploy',
        defaultValue: configDir,
        placeholder: configDir
      });
      if (isCancel(dir)) return null;
    }

    const attachments = providedArgs.attachments || false;

    const enableIndexHtml = providedArgs['enable-index-html'] || false;

    const chunkSize = providedArgs['chunk-size'] || 10;

    let force = providedArgs.force;
    if (typeof force !== 'boolean') {
      force = await confirm({
        message: 'Force deployment? (ignore MD5 checks and revision log)',
        initialValue: false,
        active: 'Yes',
        inactive: 'No'
      });
      if (isCancel(force)) return null;
    }

    const skipUnpublish = await confirm({
      message: 'Skip the automatic unpublish process?',
      initialValue: false,
      active: 'Yes',
      inactive: 'No'
    });
    if (isCancel(skipUnpublish)) return null;

    const skipPurge = await confirm({
      message: 'Skip the automatic cache purge process?',
      initialValue: false,
      active: 'Yes',
      inactive: 'No'
    });
    if (isCancel(skipPurge)) return null;

    return {
      dir,
      attachments,
      'skip-unpublish': skipUnpublish,
      'skip-purge': skipPurge,
      'enable-index-html': enableIndexHtml,
      'chunk-size': chunkSize,
      force
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = this.client ? this.client(config) : client(config);

    try {
      await quant.ping();
    } catch (err) {
      throw new Error(`Unable to connect to Quant: ${err.message}`);
    }

    const buildDir = args.dir || config.get('dir') || 'build';
    const p = path.resolve(process.cwd(), buildDir);
    console.log('Deploying from:', p);

    if (config.get('enableIndexHtml') === undefined) {
      config.set({
        enableIndexHtml: args['enable-index-html'] || false
      });
      config.save();
      console.log(color.dim(
        `Project configured with ${args['enable-index-html'] ? '--enable-index-html' : 'no --enable-index-html'}`
      ));
    }

    const projectName = config.get('project');
    const revisionLogPath = args['revision-log'] || path.resolve(process.cwd(), `quant-revision-log_${projectName}`);
    revisions.enabled(true);
    revisions.load(revisionLogPath);
    console.log(color.dim(`Using revision log: ${revisionLogPath}`));

    let files;
    try {
      files = await getFiles(p);
      console.log('Found', files.length, 'files to process');
    } catch (err) {
      throw new Error(err.message);
    }

    files = chunk(files, args['chunk-size'] || 10);
    for (let i = 0; i < files.length; i++) {
      await Promise.all(files[i].map(async (file) => {
        const filepath = path.relative(p, file);
        const md5 = md5File.sync(file);

        if (!args.force && revisions.has(filepath, md5)) {
          console.log(color.dim(`Skipping ${filepath} (content unchanged)`));
          return;
        }
        
        try {
          const meta = await quant.send(
            file, 
            filepath, 
            true, 
            args.attachments, 
            args['skip-purge'], 
            args['enable-index-html']
          );

          console.log(color.green('✓'), filepath);
          return meta;
        } catch (err) {
          if (!args.force && isMD5Match(err)) {
            if (revisions.enabled()) {
              revisions.store({
                url: filepath,
                md5: md5
              });
            }
            console.log(color.dim(`Skipping ${filepath} (content unchanged)`));
            return;
          }

          if (args.force && isMD5Match(err)) {
            console.log(color.yellow(`Force uploading ${filepath} (ignoring MD5 match)`));
            return;
          }

          console.log(color.yellow(`Warning: Failed to deploy ${filepath}: ${err.message}`));
          return;
        }
      }));
    }

    revisions.save();

    if (args['skip-unpublish']) {
      console.log(color.dim('Skipping unpublish process'));
      return 'Deployment completed successfully';
    }

    let data;
    try {
      data = await quant.meta(true);
    } catch (err) {
      return 'Deployment completed with warnings';
    }

    const normalizePath = (filePath) => {
      filePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      filePath = filePath.toLowerCase();
      if (filePath.endsWith('/index.html')) {
        return filePath.slice(0, -11);
      }
      if (filePath === 'index.html') {
        return '';
      }
      if (filePath.endsWith('index.html')) {
        return filePath.slice(0, -10);
      }
      return filePath;
    };

    const relativeFiles = new Set();
    for (let i = 0; i < files.length; i++) {
      files[i].forEach((file) => {
        const relativePath = path.relative(p, file);
        const normalizedPath = normalizePath(relativePath);
        relativeFiles.add(normalizedPath);

        if (normalizedPath.endsWith('/')) {
          relativeFiles.add(normalizedPath.slice(0, -1));
        } else {
          relativeFiles.add(normalizedPath + '/');
        }
      });
    }

    if (!data || !('records' in data)) {
      return 'Deployment completed successfully';
    }

    const filesToUnpublish = [];
    for (const item of data.records) {
      const remoteUrl = normalizePath(item.url);

      if (relativeFiles.has(remoteUrl) || 
          relativeFiles.has(remoteUrl + '/') || 
          relativeFiles.has(remoteUrl.replace(/\/$/, ''))) {
        continue;
      }

      if (item.type && item.type === 'redirect') {
        continue;
      }

      if (args['skip-unpublish-regex']) {
        const match = item.url.match(args['skip-unpublish-regex']);
        if (match) {
          continue;
        }
      }

      filesToUnpublish.push(item.url);
    }

    const unpublishBatches = chunk(filesToUnpublish, args['chunk-size'] || 10);
    for (const batch of unpublishBatches) {
      await Promise.all(batch.map(async (url) => {
        try {
          await quant.unpublish(url);
          console.log(color.yellow(`✓ ${url} unpublished`));
        } catch (err) {
          console.log(color.red(`Failed to unpublish ${url}: ${err.message}`));
        }
      }));
    }
    return 'Deployment completed successfully';
  }
};

module.exports = command;
