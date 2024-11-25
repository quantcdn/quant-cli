/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant publish <path>
 */
const { text, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'publish [path]',
  describe: 'Publish an asset',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Path to publish',
        type: 'string'
      })
      .option('revision', {
        alias: 'r',
        describe: 'The revision id to publish',
        type: 'string',
        default: 'latest'
      });
  },

  async promptArgs(providedArgs = {}) {
    let path = providedArgs.path;
    if (!path) {
      path = await text({
        message: 'Enter the path to publish',
        validate: value => !value ? 'Path is required' : undefined
      });
      if (isCancel(path)) return null;
    }

    let revision = providedArgs.revision;
    if (!revision) {
      revision = await text({
        message: 'Enter revision ID (or press Enter for latest)',
        defaultValue: 'latest'
      });
      if (isCancel(revision)) return null;
    }

    return { path, revision };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!args.path) {
      const promptedArgs = await this.promptArgs();
      if (!promptedArgs) {
        throw new Error('Operation cancelled');
      }
      args = { ...args, ...promptedArgs };
    }

    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = client(config);

    if (args.revision === 'latest') {
      try {
        const res = await quant.revisions(args.path);
        const revisionIds = Object.keys(res.revisions);
        const latestRevision = Math.max(...revisionIds);
        await quant.publish(args.path, latestRevision);
        return 'Published successfully';
      } catch (err) {
        throw new Error(`Failed to publish: ${err.message}`);
      }
    } else {
      try {
        await quant.publish(args.path, args.revision);
        return 'Published successfully';
      } catch (err) {
        throw new Error(`Failed to publish: ${err.message}`);
      }
    }
  }
};

module.exports = command;
