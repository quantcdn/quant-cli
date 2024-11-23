const { text, confirm, isCancel, select } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const normalizePaths = require('../helper/normalizePaths');
const path = require('path');
const md5File = require('md5-file');
const { chunk } = require('../helper/array');
const quantUrl = require('../helper/quant-url');
const revisions = require('../helper/revisions');
const { sep } = require('path');

const command = {
  command: 'deploy [dir]',
  describe: 'Deploy the output of a static generator',
  
  builder: (yargs) => {
    return yargs
      .positional('dir', {
        describe: 'Location of build artifacts',
        type: 'string'
      })
      .option('attachments', {
        alias: 'a',
        type: 'boolean',
        description: 'Find attachments',
        default: false
      })
      .option('skip-unpublish', {
        alias: 'u',
        type: 'boolean',
        description: 'Skip the automatic unpublish process',
        default: false
      })
      .option('skip-unpublish-regex', {
        type: 'string',
        description: 'Skip unpublishing paths that match this regex pattern'
      })
      .option('enable-index-html', {
        alias: 'h',
        type: 'boolean',
        description: 'Push index.html files with page assets',
        default: false
      })
      .option('chunk-size', {
        alias: 'cs',
        type: 'number',
        description: 'Control the chunk-size for concurrency',
        default: 10
      })
      .option('force', {
        alias: 'f',
        type: 'boolean',
        description: 'Force deployment and update revision log',
        default: false
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

    const buildDir = args.dir || config.get('dir') || 'build';
    const p = path.resolve(process.cwd(), buildDir);
    console.log('Resolved build directory:', p);
    console.log('Directory exists:', require('fs').existsSync(p));

    const quant = client(config);

    // If enableIndexHtml is not set in config, this is first deploy
    if (config.get('enableIndexHtml') === undefined) {
      config.set({
        enableIndexHtml: args['enable-index-html'] || false
      });
      config.save();
      console.log(color.dim(
        `Project configured with ${args['enable-index-html'] ? '--enable-index-html' : 'no --enable-index-html'}`
      ));
    }

    // Always enable revision log
    const projectName = config.get('project');
    const revisionLogPath = path.resolve(process.cwd(), `quant-revision-log_${projectName}`);
    revisions.enabled(true);
    revisions.load(revisionLogPath);
    console.log(color.dim(`Using revision log: ${revisionLogPath}`));

    try {
      await quant.ping();
    } catch (err) {
      throw new Error(`Unable to connect to Quant: ${err.message}`);
    }

    let files;
    try {
      files = await getFiles(p);
      console.log('Found files:', files.length);
    } catch (err) {
      console.log('Error getting files:', err);
      throw new Error(err.message);
    }

    // Helper function to check if error is an MD5 match
    const isMD5Match = (error) => {
      // Check for any kind of MD5 match message
      if (error.response && error.response.data && error.response.data.errorMsg) {
        if (error.response.data.errorMsg === 'MD5 already matches existing file.' ||
            error.response.data.errorMsg.includes('Published version already has md5')) {
          return true;
        }
      }

      if (error.message) {
        if (error.message.includes('Published version already has md5') ||
            error.message.includes('MD5 already matches')) {
          return true;
        }
      }

      return false;
    };

    // Process files in chunks
    files = chunk(files, args['chunk-size'] || 10);
    for (let i = 0; i < files.length; i++) {
      await Promise.all(files[i].map(async (file) => {
        const filepath = path.relative(p, file);
        const md5 = md5File.sync(file);

        // Check revision log if not forcing
        if (!args.force && revisions.has(filepath, md5)) {
          console.log(color.dim(`Skipping ${filepath} (matches revision log)`));
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

          // Clear line before output
          process.stdout.write('\x1b[2K\r');
          console.log(color.green('✓') + ` ${filepath}`);
          return meta;
        } catch (err) {
          // If not forcing and it's an MD5 match, skip the file
          if (!args.force && isMD5Match(err)) {
            process.stdout.write('\x1b[2K\r');
            console.log(color.dim(`Skipping ${filepath} (already up to date)`));
            // Store MD5 matches in revision log
            if (revisions.enabled()) {
              revisions.store({
                url: filepath,
                md5: md5
              });
            }
            return;
          }

          // If forcing, or it's not an MD5 match, show warning and continue
          if (args.force && isMD5Match(err)) {
            process.stdout.write('\x1b[2K\r');
            console.log(color.yellow(`Force uploading ${filepath} (ignoring MD5 match)`));
            return;
          }

          // For actual errors
          process.stdout.write('\x1b[2K\r');
          console.log(color.yellow(`Warning: Failed to deploy ${filepath}: ${err.message}`));
          return; // Continue with next file
        }
      }));
    }

    // Save revision log
    revisions.save();
    console.log(color.dim('Revision log updated'));

    if (args['skip-unpublish']) {
      console.log(color.yellow('Skipping the automatic unpublish process'));
      return 'Deployment completed successfully';
    }

    let data;
    try {
      data = await quant.meta(true);
    } catch (err) {
      console.log(color.yellow(`Failed to fetch metadata: ${err.message}`));
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

    // Get list of files to unpublish
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
          process.stdout.write('\x1b[2K\r');  // Clear line
          console.log(color.dim(`Skipping unpublish via regex match: ${item.url}`));
          continue;
        }
      }

      filesToUnpublish.push(item.url);
    }

    // Process unpublish in chunks
    const unpublishBatches = chunk(filesToUnpublish, args['chunk-size'] || 10);
    for (const batch of unpublishBatches) {
      await Promise.all(batch.map(async (url) => {
        try {
          await quant.unpublish(url);
          process.stdout.write('\x1b[2K\r');  // Clear line
          console.log(color.yellow(`✓ ${url} unpublished`));
        } catch (err) {
          process.stdout.write('\x1b[2K\r');  // Clear line
          console.log(color.red(`Failed to unpublish ${url}: ${err.message}`));
        }
      }));
    }

    // Clear any remaining spinner before final message
    process.stdout.write('\x1b[2K\r');

    // Cute robot animation frames
    const frames = [
      '\\(o o)/',  // arms up
      '|(o o)|',   // arms middle
      '/(o o)\\',  // arms down
      '|(o o)|',   // arms middle
      '\\(o o)/',  // arms up
      '\\(- -)/',  // blink!
    ];

    // Play the animation
    for (let i = 0; i < frames.length; i++) {
      process.stdout.write('\x1b[2K\r'); // Clear line
      console.log(color.cyan(frames[i]));
      await new Promise(resolve => setTimeout(resolve, 150)); // 150ms between frames
      process.stdout.write('\x1b[1A'); // Move cursor up one line
    }

    // Clear the animation
    process.stdout.write('\x1b[2K\r');
    return 'Deployment completed successfully';
  }
};

module.exports = command;
