/**
 * Perform Search API oprtations.
 *
 * @usage
 *   quant search <index|unindex|clear>
 */
const { text, select, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const fs = require('fs');
const glob = require('glob');

const command = {
  command: 'search <operation>',
  describe: 'Perform search index operations',
  
  builder: (yargs) => {
    return yargs
      .positional('operation', {
        describe: 'Operation to perform (status|index|unindex|clear)',
        type: 'string',
        choices: ['status', 'index', 'unindex', 'clear']
      })
      .option('path', {
        describe: 'Path to JSON file(s) for index/unindex operations',
        type: 'string'
      })
      .check((argv) => {
        if ((argv.operation === 'index' || argv.operation === 'unindex') && !argv.path) {
          throw new Error('Path is required for index and unindex operations');
        }
        return true;
      });
  },

  async promptArgs() {
    const operation = await select({
      message: 'Select search operation',
      options: [
        { value: 'status', label: 'Show search index status' },
        { value: 'index', label: 'Add/update search records' },
        { value: 'unindex', label: 'Remove item from search index' },
        { value: 'clear', label: 'Clear entire search index' }
      ]
    });

    if (isCancel(operation)) return null;

    let additionalArgs = {};

    switch (operation) {
      case 'index':
        const path = await text({
          message: 'Enter path to JSON file(s)',
          validate: value => !value ? 'Path is required' : undefined
        });
        if (isCancel(path)) return null;
        additionalArgs.path = path;
        break;

      case 'unindex':
        const urlPath = await text({
          message: 'Enter URL path to remove from index',
          validate: value => !value ? 'Path is required' : undefined
        });
        if (isCancel(urlPath)) return null;
        additionalArgs.path = urlPath;
        break;

      case 'clear':
        const confirmClear = await confirm({
          message: 'Are you sure you want to clear the entire search index?',
          initialValue: false
        });
        if (isCancel(confirmClear) || !confirmClear) return null;
        break;
    }

    return {
      operation,
      ...additionalArgs
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // Check for required arguments and prompt if missing
    if (!args.operation || ((['index', 'unindex'].includes(args.operation)) && !args.path)) {
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

    switch (args.operation) {
      case 'status':
        const status = await quant.searchStatus();
        return status;

      case 'index':
        let jsonFiles = [];
        const stats = fs.statSync(args.path);
        
        if (stats.isDirectory()) {
          jsonFiles = glob.sync(args.path + '/*.json');
        } else {
          jsonFiles = [args.path];
        }

        for (const file of jsonFiles) {
          await quant.searchIndex(file);
        }
        return `Successfully indexed ${jsonFiles.length} file(s)`;

      case 'unindex':
        await quant.searchRemove(args.path);
        return `Successfully removed ${args.path} from search index`;

      case 'clear':
        await quant.searchClearIndex();
        return 'Successfully cleared search index';
    }
  }
};

module.exports = command;
