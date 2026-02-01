#!/usr/bin/env node

import { intro, outro, select, confirm, isCancel } from '@clack/prompts';
import color from 'picocolors';
import { getCommandOptions, getCommand, loadCommands } from './src/commandLoader.js';
import config from './src/config.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

async function showActiveConfig() {
  // Try to load config first
  const args = process.argv.slice(2);
  const yargsInstance = yargs(args);
  const argv = await yargsInstance.parse();

  await config.fromArgs(argv, true);

  const endpoint = config.get('endpoint');
  const clientId = config.get('clientid');
  const project = config.get('project');
  const defaultEndpoint = 'https://api.quantcdn.io/v1';

  console.log(color.dim('─────────────────────────────────────'));
  console.log(color.dim('Active configuration:'));
  console.log(color.dim(`Organization: ${clientId || 'Not set'}`));
  console.log(color.dim(`Project: ${project || 'Not set'}`));
  if (endpoint && endpoint !== defaultEndpoint) {
    console.log(color.dim(`Endpoint: ${endpoint}`));
  }
  console.log(color.dim('─────────────────────────────────────'));
}

async function interactiveMode() {
  intro(color.bgCyan(color.white(' QuantCDN CLI ')));

  try {
    // Check for config before showing menu
    if (!await config.fromArgs({ _: [''] }, true)) {
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

    await showActiveConfig();

    const commandOptions = getCommandOptions();
    const command = await select({
      message: 'What would you like to do?',
      options: commandOptions
    });

    if (isCancel(command)) {
      outro('Operation cancelled');
      process.exit(0);
    }

    const cmd = getCommand(command);
    if (!cmd) {
      outro('Invalid command selected');
      process.exit(1);
    }

    const args = await cmd.promptArgs();
    if (!args) {
      outro('Operation cancelled');
      process.exit(0);
    }

    try {
      const result = await cmd.handler(args);
      if (result) {
        console.log(result);
      }
      outro('Operation completed successfully');
    } catch (err) {
      outro(color.red('Error: ' + err.message));
      process.exit(1);
    }
  } catch (err) {
    outro(color.red('Error: ' + err.message));
    process.exit(1);
  }
}

function cliMode() {
  let yargsInstance = yargs(hideBin(process.argv))
    .strict()
    .help()
    // Global options
    .option('clientid', {
      alias: 'c',
      describe: 'Project customer id for QuantCDN',
      type: 'string'
    })
    .option('project', {
      alias: 'p',
      describe: 'Project name for QuantCDN',
      type: 'string'
    })
    .option('token', {
      alias: 't',
      describe: 'Project token for QuantCDN',
      type: 'string'
    })
    .option('endpoint', {
      alias: 'e',
      describe: 'API endpoint for QuantCDN',
      type: 'string'
    });

  // Add all commands to yargs
  const commands = loadCommands();
  Object.entries(commands).forEach(([_name, command]) => {
    yargsInstance = yargsInstance.command({
      command: command.command,
      describe: command.describe,
      builder: command.builder,
      handler: async (argv) => {
        try {
          await showActiveConfig();
          const result = await command.handler(argv);
          if (result) {
            console.log(result);
          }
          process.exit(0);
        } catch (err) {
          console.error(color.red('Error: ' + err.message));
          process.exit(1);
        }
      }
    });
  });

  yargsInstance.parse();
}

if (process.argv.length > 2) {
  cliMode();
} else {
  interactiveMode();
}
