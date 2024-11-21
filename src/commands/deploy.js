const { text, confirm, isCancel, select } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');
const md5File = require('md5-file');
const { chunk } = require('../helper/array');
const revisions = require('../helper/revisions');

const command = {
  command: 'deploy [dir]',
  describe: 'Deploy the output of a static generator',
  
  builder: (yargs) => {
    return yargs
      .positional('dir', {
        describe: 'Location of build artifacts',
        type: 'string',
        default: null
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
      .option('chunk-size', {
        alias: 'cs',
        type: 'number',
        description: 'Control the chunk-size for concurrency',
        default: 10
      })
      .option('force', {
        alias: 'f',
        type: 'boolean',
        description: 'Force the deployment (ignore md5 match)',
        default: false
      });
  },

  async promptArgs() {
    const dir = await text({
      message: 'Enter the build directory to deploy',
      defaultValue: config.get('dir') || 'build'
    });

    if (isCancel(dir)) return null;

    const attachments = await confirm({
      message: 'Find attachments?',
      initialValue: false
    });

    if (isCancel(attachments)) return null;

    const skipUnpublish = await confirm({
      message: 'Skip the automatic unpublish process?',
      initialValue: false
    });

    if (isCancel(skipUnpublish)) return null;

    const chunkSize = await text({
      message: 'Enter chunk size for concurrency (1-20)',
      defaultValue: '10',
      validate: value => {
        const num = parseInt(value);
        if (isNaN(num) || num < 1 || num > 20) {
          return 'Please enter a number between 1 and 20';
        }
      }
    });

    if (isCancel(chunkSize)) return null;

    return {
      dir,
      attachments,
      'skip-unpublish': skipUnpublish,
      'chunk-size': parseInt(chunkSize),
      force: false // Could add this as a prompt if needed
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const p = path.resolve(process.cwd(), args.dir);
    const quant = client(config);

    try {
      await quant.ping();
    } catch (err) {
      throw new Error(`Unable to connect to Quant: ${err.message}`);
    }

    let files;
    try {
      files = await getFiles(p);
    } catch (err) {
      throw new Error(err.message);
    }

    // Process files in chunks
    files = chunk(files, args['chunk-size']);
    for (let i = 0; i < files.length; i++) {
      await Promise.all(files[i].map(async (file) => {
        const md5 = md5File.sync(file);
        const filepath = path.relative(p, file);
        
        try {
          const meta = await quant.send(
            file, 
            filepath, 
            true, 
            args.attachments, 
            args['skip-purge'], 
            args['enable-index-html']
          );
          return `Deployed ${filepath}`;
        } catch (err) {
          throw new Error(`Failed to deploy ${filepath}: ${err.message}`);
        }
      }));
    }

    return 'Deployment completed successfully';
  }
};

module.exports = command;
