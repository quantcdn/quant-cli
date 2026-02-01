import deployCommand from './commands/deploy.js';
import pageCommand from './commands/page.js';
import fileCommand from './commands/file.js';
import redirectCommand from './commands/redirect.js';
import purgeCommand from './commands/purge.js';
import waflogsCommand from './commands/waflogs.js';
import searchCommand from './commands/search.js';
import scanCommand from './commands/scan.js';
import functionCommand from './commands/function.js';
import filterCommand from './commands/function_filter.js';
import authCommand from './commands/function_auth.js';
import functionsCommand from './commands/functions.js';
import unpublishCommand from './commands/unpublish.js';
import deleteCommand from './commands/delete.js';
import infoCommand from './commands/info.js';
import initCommand from './commands/init.js';
import publishCommand from './commands/publish.js';

export function loadCommands() {
  const commands = {
    // Primary deployment commands
    'deploy': deployCommand,
    'page': pageCommand,
    'file': fileCommand,
    'redirect': redirectCommand,
    'purge': purgeCommand,
    'waflogs': waflogsCommand,
    'search': searchCommand,
    'scan': scanCommand,

    // Edge functions
    'function': functionCommand,
    'filter': filterCommand,
    'auth': authCommand,
    'functions': functionsCommand,

    // Destructive operations
    'unpublish': unpublishCommand,
    'delete': deleteCommand,

    // Project management
    'info': infoCommand,
    'init': initCommand,
    'publish': publishCommand
  };

  return commands;
}

export function getCommandOptions() {
  return [
    // Primary deployment commands
    { value: 'deploy', label: 'Deploy an entire directory' },
    { value: 'page', label: 'Deploy a single page' },
    { value: 'file', label: 'Deploy a single file' },
    { value: 'redirect', label: 'Create a redirect' },
    { value: 'purge', label: 'Purge the cache for a path' },
    { value: 'waflogs', label: 'Access WAF logs' },
    { value: 'search', label: 'Perform search index operations' },
    { value: 'scan', label: 'Validate local file checksums' },

    // Visual separator
    { value: 'separator1', label: '───────────────────────', disabled: true },

    // Edge functions
    { value: 'function', label: 'Deploy an edge function' },
    { value: 'filter', label: 'Deploy an edge filter' },
    { value: 'auth', label: 'Deploy an edge auth function' },
    { value: 'functions', label: 'Deploy multiple edge functions from JSON' },

    // Visual separator
    { value: 'separator2', label: '───────────────────────', disabled: true },

    // Destructive operations
    { value: 'unpublish', label: 'Unpublish an asset' },
    { value: 'delete', label: 'Delete an asset' },

    // Visual separator
    { value: 'separator3', label: '───────────────────────', disabled: true },

    // Project management
    { value: 'info', label: 'Show project info' },
    { value: 'init', label: 'Reinitialize project settings' }
  ];
}

export function getCommand(name) {
  return loadCommands()[name];
}
