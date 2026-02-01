/**
 * Perform Search API operations.
 */
import { text, select, confirm, isCancel } from '@clack/prompts';
import color from 'picocolors';
import config from '../config.js';
import client from '../quant-client.js';
import fs from 'fs';

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

    // For clear operation, ask for confirmation
    if (operation === 'clear') {
      const shouldClear = await confirm({
        message: 'Are you sure you want to clear the entire search index? This cannot be undone.',
        initialValue: false
      });
      if (isCancel(shouldClear) || !shouldClear) return null;
    }

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

    // For index operation, validate JSON file
    if (operation === 'index' && path) {
      try {
        const fileContent = fs.readFileSync(path, 'utf8');
        const data = JSON.parse(fileContent);

        // Validate array structure
        if (!Array.isArray(data)) {
          throw new Error('JSON must be an array of records');
        }

        // Validate required fields
        data.forEach((record, index) => {
          if (!record.url || !record.title || !record.content) {
            throw new Error(`Record at index ${index} missing required fields (url, title, content)`);
          }
        });

      } catch (err) {
        if (err.code === 'ENOENT') {
          console.log(color.red(`Error: File not found: ${path}`));
        } else {
          console.log(color.red('Error: Invalid JSON file'));
          console.log(color.yellow('Make sure your JSON:'));
          console.log('1. Uses double quotes for property names');
          console.log('2. Has valid syntax (no trailing commas)');
          console.log('3. Follows the required format:');
          console.log(color.dim(`
[
    {
        "title": "This is a record",
        "url": "/blog/page",
        "summary": "The record is small and neat.",
        "content": "Lots of good content here. But not too much!"
    },
    {
        "title": "Fully featured search record",
        "url": "/about-us",
        "summary": "The record contains all the trimmings.",
        "content": "Lorem ipsum dolor sit amet...",
        "image": "https://www.example.com/images/about.jpg",
        "categories": [ "Blog", "Commerce" ],
        "tags": [ "Tailwind", "QuantCDN" ]
    }
]`));
          console.log('\nError details:', err.message);
        }
        return null;
      }
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

    try {
      switch (args.operation) {
        case 'status': {
          const status = await quant.searchStatus();
          return `Search index status:\nTotal documents: ${status.index && status.index.entries || 0}`;
        }

        case 'index':
          await quant.searchIndex(args.path);
          return 'Successfully added items to search index';

        case 'unindex':
          await quant.searchRemove(args.path);
          return `Successfully removed ${args.path} from search index`;

        case 'clear':
          await quant.searchClearIndex();
          return 'Successfully cleared search index';
      }
    } catch (err) {
      throw new Error(`Failed to ${args.operation}: ${err.message}`);
    }
  }
};

export default command;
