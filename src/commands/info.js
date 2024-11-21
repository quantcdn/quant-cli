/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant info
 */
const { isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  describe: 'Show information about current configuration',
  
  async promptArgs() {
    // No arguments needed for info command
    return {};
  },

  async handler(args) {
    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = client(config);
    
    try {
      await quant.ping();
    } catch (err) {
      throw new Error(`Unable to connect to quant: ${err.message}`);
    }

    const info = {
      endpoint: config.get('endpoint'),
      customer: config.get('clientid'),
      project: config.get('project'),
      token: '****'
    };

    try {
      const meta = await quant.meta();
      if (meta && meta.total_records) {
        const totals = { content: 0, redirects: 0 };
        
        if (meta.records) {
          meta.records.forEach(item => {
            if (item.type && item.type === 'redirect') {
              totals.redirects++;
            } else {
              totals.content++;
            }
          });
        }

        info.totalRecords = meta.total_records;
        info.contentItems = totals.content;
        info.redirects = totals.redirects;
      }
    } catch (err) {
      info.error = 'Could not fetch metadata';
    }

    return info;
  }
};

module.exports = command;
