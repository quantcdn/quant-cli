/**
 * Purge the cache for a given URL.
 *
 * @usage
 *   quant purge <path>
 */
const { text, confirm, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'purge <path>',
  describe: 'Purge the cache for a given URL',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Path to purge from cache',
        type: 'string',
        coerce: (arg) => {
          return arg.replace(/^["']|["']$/g, '');
        }
      })
      .option('cache-keys', {
        describe: 'Cache keys to purge (space separated)',
        type: 'string',
        conflicts: 'path'
      })
      .option('soft-purge', {
        describe: 'Mark content as stale rather than delete from edge caches',
        type: 'boolean',
        default: false
      })
      .example('quant purge "/about"', 'Purge a single path')
      .example('quant purge "/*"', 'Purge all content (use quotes)')
      .example('quant purge --cache-keys="key1 key2"', 'Purge specific cache keys')
      .example('quant purge "/about" --soft-purge', 'Soft purge a path');
  },

  async promptArgs(providedArgs = {}) {
    let path = providedArgs.path;
    let cacheKeys = providedArgs['cache-keys'];
    let softPurge = providedArgs['soft-purge'];

    // If neither path nor cache-keys provided, prompt for one
    if (!path && !cacheKeys) {
      const purgeType = await select({
        message: 'What would you like to purge?',
        options: [
          { value: 'path', label: 'Purge by path' },
          { value: 'keys', label: 'Purge by cache keys' }
        ]
      });
      if (isCancel(purgeType)) return null;

      if (purgeType === 'path') {
        path = await text({
          message: 'Enter path to purge from cache',
          validate: value => !value ? 'Path is required' : undefined
        });
        if (isCancel(path)) return null;
      } else {
        cacheKeys = await text({
          message: 'Enter cache keys (space separated)',
          validate: value => !value ? 'Cache keys are required' : undefined
        });
        if (isCancel(cacheKeys)) return null;
      }
    }

    // If not provided and in interactive mode, ask about soft purge
    if (softPurge === undefined) {
      softPurge = await confirm({
        message: 'Use soft purge (mark as stale rather than delete)?',
        initialValue: false
      });
      if (isCancel(softPurge)) return null;
    }

    // For wildcard paths, ask for confirmation
    if (path && path.includes('*')) {
      const shouldPurge = await confirm({
        message: `Are you sure you want to purge ${path}? This could affect multiple paths.`,
        initialValue: false
      });
      if (isCancel(shouldPurge) || !shouldPurge) return null;
    }

    return { 
      path,
      'cache-keys': cacheKeys,
      'soft-purge': softPurge
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = client(config);

    try {
      const options = {
        softPurge: args['soft-purge']
      };

      if (args['cache-keys']) {
        await quant.purge(null, args['cache-keys'], options);
        return `Successfully purged cache keys: ${args['cache-keys']}`;
      } else {
        await quant.purge(args.path, null, options);
        return `Successfully purged ${args.path}`;
      }
    } catch (err) {
      throw new Error(`Failed to purge: ${err.message}`);
    }
  }
};

module.exports = command;
