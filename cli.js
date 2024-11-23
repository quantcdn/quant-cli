#!/usr/bin/env node

const { intro, outro, text, password, select, confirm, isCancel, spinner } = require('@clack/prompts');
const color = require('picocolors');
const { getCommandOptions, getCommand } = require('./src/commandLoader');
const config = require('./src/config');
const yargs = require('yargs');

function showActiveConfig() {
  const endpoint = config.get('endpoint');
  const clientId = config.get('clientid');
  const project = config.get('project');
  const defaultEndpoint = 'https://api.quantcdn.io/v1';

  console.log(color.dim('─────────────────────────────────────'));
  console.log(color.dim('Active configuration:'));
  console.log(color.dim(`Organization: ${clientId}`));
  console.log(color.dim(`Project: ${project}`));
  if (endpoint !== defaultEndpoint) {
    console.log(color.dim(`Endpoint: ${endpoint}`));
  }
  console.log(color.dim('─────────────────────────────────────'));
}

async function interactiveMode() {
  intro(color.bgCyan(' QuantCDN CLI '));

  try {
    // Check for config before showing menu
    if (!await config.fromArgs({ _: [''] })) {
      const shouldInit = await confirm({
        message: 'No configuration found. Would you like to initialize a new project?',
        initialValue: true
      });

      if (isCancel(shouldInit) || !shouldInit) {
        outro(color.yellow('Configuration required to continue. You can:'));
        outro(color.yellow('1. Run "quant init" to create a new configuration'));
        outro(color.yellow('2. Create a quant.json file in this directory'));
        outro(color.yellow('3. Set environment variables (QUANT_CLIENT_ID, QUANT_PROJECT, QUANT_TOKEN)'));
        outro(color.yellow('4. Provide configuration via command line arguments'));
        process.exit(0);
      }

      // Get the init command and run it
      const initCommand = getCommand('init');
      const initArgs = await initCommand.promptArgs();
      if (!initArgs) {
        outro(color.yellow('Operation cancelled'));
        process.exit(0);
      }
      await initCommand.handler(initArgs);
    }

    showActiveConfig();

    const command = await select({
      message: 'What would you like to do?',
      options: getCommandOptions()
    });

    if (isCancel(command)) {
      outro(color.yellow('Operation cancelled'));
      process.exit(0);
    }

    const commandHandler = getCommand(command);
    if (!commandHandler) {
      throw new Error(`Unknown command: ${command}`);
    }

    const args = await commandHandler.promptArgs();
    
    const spin = spinner();
    spin.start(`Executing ${command}`);
    
    try {
      const result = await commandHandler.handler(args);
      spin.stop(`${command} completed successfully`);
      outro(color.green(result || 'Operation completed successfully!'));
    } catch (error) {
      spin.stop(`${command} failed`);
      throw error;
    }
  } catch (error) {
    outro(color.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

async function handleCommand(command, argv) {
  try {
    // Add _command property to args for config check
    argv._ = argv._ || [];
    argv._[0] = command.command.split(' ')[0];

    // Extract command definition parts
    const commandParts = command.command.split(' ');
    const requiredArgs = commandParts
      .filter(part => part.startsWith('<'))
      .map(part => part.replace(/[<>]/g, ''));

    // For positional arguments, they're in argv._ after the command name
    const providedPositionalArgs = argv._.slice(1);

    // Check if we have all required positional arguments
    const hasAllRequiredArgs = requiredArgs.every((arg, index) => {
      // For the first argument, check if it's provided either as positional or named
      if (index === 0) {
        return providedPositionalArgs[index] || argv[arg];
      }
      // For subsequent arguments, they must be provided as positional args
      return providedPositionalArgs[index];
    });

    if (!await config.fromArgs(argv)) {
      process.exit(1);
    }

    showActiveConfig();

    // Always pass existing args to promptArgs, even in interactive mode
    if (!hasAllRequiredArgs) {
      intro(color.bgCyan(' QuantCDN CLI '));
      const promptedArgs = await command.promptArgs(argv);
      if (!promptedArgs) {
        outro(color.yellow('Operation cancelled'));
        process.exit(0);
      }
      argv = { ...argv, ...promptedArgs };
    }

    const spin = spinner();
    spin.start(`Executing ${command.command.split(' ')[0]}`);
    
    try {
      const result = await command.handler(argv);
      spin.stop('');
      console.log(color.green(result || 'Operation completed successfully!'));
    } catch (error) {
      spin.stop('');
      throw error;
    }
  } catch (error) {
    console.error(color.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

function cliMode() {
  const yargsInstance = yargs(process.argv.slice(2))
    .strict()
    .help()
    // Global options
    .option('clientid', {
      alias: 'c',
      describe: 'Project customer id for QuantCDN',
      type: 'string',
    })
    .option('project', {
      alias: 'p',
      describe: 'Project name for QuantCDN',
      type: 'string',
    })
    .option('token', {
      alias: 't',
      describe: 'Project token for QuantCDN',
      type: 'string',
    })
    .option('endpoint', {
      alias: 'e',
      describe: 'API endpoint for QuantCDN',
      type: 'string',
    });

  // Add all commands to yargs
  const commands = require('./src/commandLoader').loadCommands();
  Object.entries(commands).forEach(([name, command]) => {
    yargsInstance.command(
      command.command || name,
      command.describe,
      command.builder || {},
      async (argv) => handleCommand(command, argv)
    );
  });

  yargsInstance.demandCommand().parse();
}

// Check if being run directly
if (require.main === module) {
  // No arguments = interactive mode
  if (process.argv.length === 2) {
    interactiveMode();
  } else {
    cliMode();
  }
}

module.exports = {
  interactiveMode,
  cliMode
};
