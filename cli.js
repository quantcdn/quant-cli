#!/usr/bin/env node

const { intro, outro, text, password, select, confirm, isCancel, spinner } = require('@clack/prompts');
const color = require('picocolors');
const { getCommandOptions, getCommand } = require('./src/commandLoader');
const config = require('./src/config');
const yargs = require('yargs');

async function interactiveMode() {
  intro(color.bgCyan(' QuantCDN CLI '));

  try {
    // Check for config before showing menu
    if (!await config.fromArgs({ _: [''] })) {
      process.exit(1);
    }

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
    // Check if command was called with no arguments
    const commandParts = command.command.split(' ');
    const requiredArgs = commandParts.filter(part => part.startsWith('<')).length;
    const providedArgs = argv._.length - 1; // Subtract 1 for command name

    // If no arguments provided at all, go straight to interactive mode
    if (providedArgs === 0 && requiredArgs > 0) {
      intro(color.bgCyan(' QuantCDN CLI '));
      const args = await command.promptArgs();
      if (!args) {
        outro(color.yellow('Operation cancelled'));
        process.exit(0);
      }
      argv = { ...argv, ...args };
    } 
    // If some arguments are missing, let yargs handle the error
    else if (providedArgs < requiredArgs) {
      return command.builder(yargs).argv;
    }

    // Add _command property to args for config check
    argv._ = argv._ || [];
    argv._[0] = commandParts[0];
    
    const result = await command.handler(argv);
    console.log(color.green(result || 'Operation completed successfully!'));
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
      default: 'https://api.quantcdn.io'
    })
    .option('bearer', {
      describe: 'Scoped API bearer token',
      type: 'string',
    });

  // Add all commands to yargs
  const commands = require('./src/commandLoader').loadCommands();
  Object.entries(commands).forEach(([name, command]) => {
    yargsInstance.command(
      command.command || name,
      command.describe,
      command.builder || {},
      (argv) => handleCommand(command, argv)
    );
  });

  yargsInstance.demandCommand().parse();
}

// Determine if we should run in interactive or CLI mode
if (process.argv.length <= 2) {
  interactiveMode().catch((error) => {
    outro(color.red(`Error: ${error.message}`));
    process.exit(1);
  });
} else {
  cliMode();
}

// Handle interrupts gracefully
process.on('SIGINT', () => {
  outro(color.yellow('\nOperation cancelled'));
  process.exit(0);
});
