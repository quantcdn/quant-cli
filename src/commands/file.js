/**
 * Deploy a single file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant file <file> <location>
 */
const config = require('../config');
const client = require('../quant-client');
const io = require('../io');

const command = {};

command.command = 'file <file> <location>';
command.describe = 'Deploy a single asset';
command.builder = (yargs) => {
  yargs.positional('file', {
    describe: 'Path to local file',
    type: 'string',
  });
  yargs.positional('location', {
    describe: 'The access URI',
    type: 'string',
  });
};

command.handler = function(argv) {
  const filepath = argv.file;
  const location = argv.location;

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  io.title('Quant file');

  client(config).file(filepath, location)
      .then((body) => io.update(`Added [${filepath}]`)) // eslint-disable-line
      .catch((err) => {
        io.info(`File [${filepath}] exists at location (${location})`);
      });
};

module.exports = command;
