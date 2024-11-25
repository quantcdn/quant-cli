/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant info
 */
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'info',
  describe: 'Show information about current configuration',
  
  builder: (yargs) => {
    return yargs;
  },

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

    let output = '';
    output += `Endpoint: ${config.get('endpoint')}\n`;
    output += `Customer: ${config.get('clientid')}\n`;
    output += `Project: ${config.get('project')}\n`;
    output += `Token: ****\n`;

    try {
      const meta = await quant.meta();
      if (meta && meta.total_records) {
        output += `\nTotal records: ${meta.total_records}`;
      }
    } catch (err) {
      output += '\nCould not fetch metadata';
    }

    return output;
  }
};

module.exports = command;
