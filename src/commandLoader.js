const fs = require('fs');
const path = require('path');
const { select, text, password, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');

// Load all command modules
function loadCommands() {
  const commands = {};
  const commandsDir = path.join(__dirname, 'commands');
  
  fs.readdirSync(commandsDir)
    .filter(file => file.endsWith('.js'))
    .forEach(file => {
      const command = require(path.join(commandsDir, file));
      const name = path.basename(file, '.js');
      commands[name] = command;
    });

  return commands;
}

// Convert commands to Clack options
function getCommandOptions() {
  const commands = loadCommands();
  return Object.entries(commands).map(([name, command]) => ({
    value: name,
    label: command.describe || name,
  }));
}

// Get command handler
function getCommand(name) {
  const commands = loadCommands();
  return commands[name];
}

module.exports = {
  loadCommands,
  getCommandOptions,
  getCommand
}; 