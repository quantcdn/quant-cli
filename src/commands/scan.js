/**
 * Scan local files and validate checksums.
 */
const { text, confirm, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');
const md5File = require('md5-file');
const revisions = require('../helper/revisions');
const color = require('picocolors');
const { chunk } = require('../helper/array');

const command = {
  command: 'scan [options]',
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
      .option('skip-unpublish', {
        describe: 'Skip the unpublish process',
        type: 'boolean',
        default: false
      })
      .option('skip-unpublish-regex', {
        describe: 'Skip the unpublish process for specific regex',
        type: 'string'
      });
  },

  async promptArgs(providedArgs = {}) {
    let diffOnly = providedArgs['diff-only'];
    if (typeof diffOnly !== 'boolean') {
      diffOnly = await confirm({
        message: 'Show only source files different from Quant?',
        initialValue: false
      });
      if (isCancel(diffOnly)) return null;
    }

    let unpublishOnly = providedArgs['unpublish-only'];
    if (typeof unpublishOnly !== 'boolean') {
      unpublishOnly = await confirm({
        message: 'Show only the unpublished results?',
        initialValue: false
      });
      if (isCancel(unpublishOnly)) return null;
    }

    let skipUnpublishRegex = providedArgs['skip-unpublish-regex'];
    if (skipUnpublishRegex === undefined) {
      skipUnpublishRegex = await text({
        message: 'Enter regex pattern to skip unpublish (optional)',
      });
      if (isCancel(skipUnpublishRegex)) return null;
    }

    return {
      'diff-only': diffOnly,
      'unpublish-only': unpublishOnly,
      'skip-unpublish-regex': skipUnpublishRegex || undefined
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
    const buildDir = args.dir || config.get('dir') || 'build';
    const p = path.resolve(process.cwd(), buildDir);

    console.log('Fetching metadata from Quant...');
    let metadata;
    try {
      metadata = await quant.meta(true);
      console.log('Metadata fetched successfully');
    } catch (err) {
      throw new Error('Failed to fetch metadata from Quant');
    }

    console.log('Scanning local files...');
    let files;
    try {
      files = await getFiles(p);
      console.log(`Found ${files.length} local files`);
    } catch (err) {
      throw new Error(err.message);
    }

    const results = {
      upToDate: [],
      different: [],
      notFound: [],
      toUnpublish: []
    };

    // Helper function to normalize paths for comparison
    const normalizePath = (filepath) => {
      // Convert to lowercase and ensure leading slash
      let normalizedPath = '/' + filepath.toLowerCase();
      
      // Special cases for HTML files
      if (!args['enable-index-html'] && normalizedPath.endsWith('/index.html')) {
        // Case 1: Root index.html -> /
        if (normalizedPath === '/index.html') {
          return '/';
        }
        
        // Case 2: Directory index.html -> directory path
        if (normalizedPath.endsWith('/index.html')) {
          return normalizedPath.slice(0, -11); // Remove index.html including the slash
        }
      }
      
      return normalizedPath;
    };

    // Initialize revision log
    const projectName = config.get('project');
    const revisionLogPath = path.resolve(process.cwd(), `quant-revision-log_${projectName}`);
    revisions.enabled(true);
    revisions.load(revisionLogPath);
    console.log(color.dim(`Using revision log: ${revisionLogPath}`));

    // Check local files
    const totalFiles = files.length;
    const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinIndex = 0;

    // Clear line helper
    const clearLine = () => {
      process.stdout.write('\x1b[2K\r');
    };

    // Process files in batches
    const batchSize = 20;
    const batches = chunk(files, batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchPaths = batch.map(file => {
        const filepath = path.relative(p, file);
        return normalizePath(filepath);
      });

      // Update progress
      const progress = `[${i * batchSize + 1}-${Math.min((i + 1) * batchSize, files.length)}/${files.length}]`;
      clearLine();
      const spinChar = spinChars[spinIndex];
      spinIndex = (spinIndex + 1) % spinChars.length;
      process.stdout.write(`${spinChar} ${progress} Checking batch of files...`);

      try {
        const response = await quant.batchMeta(batchPaths);        
        // Process each file in the batch
        for (let j = 0; j < batch.length; j++) {
          const file = batch[j];
          const filepath = path.relative(p, file);
          let localPath = '/' + filepath.toLowerCase();
          
          // Normalize path
          localPath = normalizePath(filepath);

          const localmd5 = md5File.sync(file);

          // Find matching record in response
          const record = response.global_meta.records.find(r => {
            if (!r || !r.meta) return false;
            const recordUrl = r.meta.url || '';
            const matches = recordUrl.toLowerCase() === localPath;
            return matches;
          });

          if (record && record.meta.md5 === localmd5) {
            if (!args['diff-only']) {
              results.upToDate.push(filepath);
            }
            // Store matching MD5s in revision log
            revisions.store({
              url: filepath,
              md5: localmd5
            });
          } else if (record) {
            results.different.push(filepath);
          } else {
            results.notFound.push(filepath);
          }
        }
      } catch (err) {
        // Fall back to checking files individually
        for (const file of batch) {
          const filepath = path.relative(p, file);
          results.notFound.push(filepath);
        }
      }
    }


    // Find paths to unpublish from initial metadata
    const processedUrls = new Set(); // Track what we've already processed
    const skippedByRegex = new Set(); // Track files skipped by regex
    
    if (!args['skip-unpublish'] && metadata && metadata.records) {
      const skipPattern = args['skip-unpublish-regex'] ? new RegExp(args['skip-unpublish-regex']) : null;
      
      metadata.records.forEach(record => {
        if (!record.url || processedUrls.has(record.url)) return;

        // Skip redirects
        if (record.type === 'redirect') {
          return;
        }

        // Skip if matches the skip pattern
        if (skipPattern && skipPattern.test(record.url)) {
          skippedByRegex.add(record.url);
          return;
        }

        // Check if file exists locally
        const localFile = files.find(file => {
          const filepath = path.relative(p, file);
          const localPath = normalizePath(filepath);
          const recordPath = record.url.toLowerCase();
          return localPath === recordPath || localPath === recordPath.replace(/^\//, '');
        });

        if (!localFile) {
          results.toUnpublish.push(record.url);
          processedUrls.add(record.url);
        }
      });
    }

    // Clear the last progress line
    clearLine();
    process.stdout.write('\n');
    console.log('Scan completed');

    // Save revision log
    revisions.save();
    console.log(color.dim('Revision log updated'));

    // Format the results as a string
    let output = '\nScan Results:\n';
    
    if (results.upToDate.length > 0 && !args['diff-only']) {
      output += color.green('\nUp to date:') + `\n${results.upToDate.join('\n')}\n`;
    }

    if (results.different.length > 0) {
      output += color.yellow('\nDifferent:') + `\n${results.different.join('\n')}\n`;
    }

    if (results.notFound.length > 0) {
      output += color.red('\nNot found:') + `\n${results.notFound.join('\n')}\n`;
    }

    if (results.toUnpublish.length > 0) {
      output += color.magenta('\nTo be unpublished:') + `\n${results.toUnpublish.join('\n')}\n`;
    }

    if (skippedByRegex.size > 0) {
      output += color.blue('\nSkipped by regex:') + `\n${Array.from(skippedByRegex).join('\n')}\n`;
    }

    if (output === '\nScan Results:\n') {
      output += 'No changes found';
    }

    // Add summary
    output += '\nSummary:\n';
    output += `Total files scanned: ${totalFiles}\n`;
    output += `Up to date: ${results.upToDate.length}\n`;
    output += `Different: ${results.different.length}\n`;
    output += `Not found: ${results.notFound.length}\n`;
    output += `To be unpublished: ${results.toUnpublish.length}\n`;
    if (skippedByRegex.size > 0) {
      output += `Skipped by regex: ${skippedByRegex.size}\n`;
    }

    return output;
  }
};

module.exports = command;
