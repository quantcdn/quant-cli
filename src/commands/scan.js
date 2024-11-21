/**
 * Validate local file checksums.
 *
 * @usage
 *   quant scan
 */

const { text, confirm, isCancel, select } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');
const md5File = require('md5-file');

const command = {
  command: 'scan',
  describe: 'Validate local file checksums',
  
  builder: (yargs) => {
    return yargs
      .option('diff-only', {
        describe: 'Show only source files different from Quant',
        type: 'boolean',
        default: false
      })
      .option('unpublish-only', {
        describe: 'Show only the unpublished results',
        type: 'boolean',
        default: false
      })
      .option('skip-unpublish-regex', {
        describe: 'Skip the unpublish process for specific regex',
        type: 'string'
      });
  },

  async promptArgs() {
    const showDiffOnly = await confirm({
      message: 'Show only source files different from Quant?',
      initialValue: false
    });

    if (isCancel(showDiffOnly)) return null;

    const unpublishOnly = await confirm({
      message: 'Show only the unpublished results?',
      initialValue: false
    });

    if (isCancel(unpublishOnly)) return null;

    const skipUnpublishRegex = await text({
      message: 'Enter regex pattern to skip unpublish (optional)',
    });

    if (isCancel(skipUnpublishRegex)) return null;

    return {
      'diff-only': showDiffOnly,
      'unpublish-only': unpublishOnly,
      'skip-unpublish-regex': skipUnpublishRegex || undefined
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!args['diff-only'] && !args['unpublish-only'] && !args['skip-unpublish-regex']) {
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
    const dir = config.get('dir') || 'build';
    const p = path.resolve(process.cwd(), dir);

    let data;
    try {
      data = await quant.meta(true);
    } catch (err) {
      throw new Error('Failed to fetch metadata from Quant');
    }

    let files;
    try {
      files = await getFiles(p);
    } catch (err) {
      throw new Error(err.message);
    }

    const results = {
      upToDate: [],
      different: [],
      notFound: [],
      toUnpublish: []
    };

    // Check local files
    for (const file of files) {
      const filepath = path.relative(p, file);
      const relativeFile = `/${filepath.toLowerCase()}`;
      
      if (!args['unpublish-only']) {
        try {
          const revision = await quant.revision(filepath);
          const localmd5 = md5File.sync(file);

          if (revision.md5 === localmd5) {
            if (!args['diff-only']) {
              results.upToDate.push(filepath);
            }
          } else {
            results.different.push(filepath);
          }
        } catch (err) {
          results.notFound.push(filepath);
        }
      }
    }

    // Check remote files
    data.records.forEach(item => {
      const f = item.url.replace('/index.html', '.html');
      const relativeFiles = files.map(file => `/${path.relative(p, file).toLowerCase()}`);

      if (relativeFiles.includes(item.url) || relativeFiles.includes(f)) {
        return;
      }

      if (item.type && item.type === 'redirect') {
        return;
      }

      if (args['skip-unpublish-regex']) {
        const match = item.url.match(args['skip-unpublish-regex']);
        if (match) {
          return;
        }
      }

      results.toUnpublish.push(item.url);
    });

    return results;
  }
};

module.exports = command;
