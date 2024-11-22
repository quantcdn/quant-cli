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

const command = {
  command: 'search <operation>',
  describe: 'Perform search index operations',
  
  builder: (yargs) => {
    return yargs
      .positional('operation', {
        describe: 'Operation to perform',
        type: 'string',
        choices: ['status', 'index', 'unindex', 'clear']
      })
      .option('path', {
        describe: 'Path to file or URL',
        type: 'string'
      });
  },

  async promptArgs(providedArgs = {}) {
    // If operation is provided, skip that prompt
    let operation = providedArgs.operation;
    if (!operation) {
      operation = await select({
        message: 'Select search operation',
        options: [
          { value: 'status', label: 'Show search index status' },
          { value: 'index', label: 'Add/update items in search index' },
          { value: 'unindex', label: 'Remove item from search index' },
          { value: 'clear', label: 'Clear entire search index' }
        ]
      });
      if (isCancel(operation)) return null;
    }

    // If path is needed and not provided, prompt for it
    let path = providedArgs.path;
    if ((operation === 'index' || operation === 'unindex') && !path) {
      path = await text({
        message: operation === 'index' 
          ? 'Enter path to JSON file containing search data'
          : 'Enter URL to remove from search index',
        validate: value => !value ? 'Path is required' : undefined
      });
      if (isCancel(path)) return null;
    }

    // For clear operation, ask for confirmation
    if (operation === 'clear') {
      const shouldClear = await confirm({
        message: 'Are you sure you want to clear the entire search index?',
        initialValue: false
      });
      if (isCancel(shouldClear) || !shouldClear) return null;
    }

    return { operation, path };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = client(config);

    switch (args.operation) {
      case 'status':
        const status = await quant.searchStatus();
        return `Search index status:\nTotal documents: ${status.index?.entries || 0}`;

      case 'index':
        if (!args.path) {
          throw new Error('Path to JSON file is required');
        }
        await quant.searchIndex(args.path);
        return 'Successfully added items to search index';

      case 'unindex':
        if (!args.path) {
          throw new Error('URL to remove is required');
        }
        await quant.searchRemove(args.path);
        return `Successfully removed ${args.path} from search index`;

      case 'clear':
        await quant.searchClearIndex();
        return 'Successfully cleared search index';
    }
  }
};

module.exports = command;
