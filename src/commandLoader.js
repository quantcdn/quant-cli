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
import functionsAddCommand from './commands/functions-add.js';
import rulesCommand from './commands/rules.js';
import kvIndexesCommand from './commands/kv-indexes.js';
import unpublishCommand from './commands/unpublish.js';
import deleteCommand from './commands/delete.js';
import infoCommand from './commands/info.js';
import initCommand from './commands/init.js';
import publishCommand from './commands/publish.js';

// serve and kv load @quantcdn/edge-kv. Their modules are imported only when
// one of them runs, so that the other commands never load it. Until then the
// command list holds the name and the description only.
const LAZY = {
  serve: {
    command: 'serve [dir]',
    describe: 'Run the site locally: static files, edge functions and rules',
    load: () => import('./commands/serve.js')
  },
  kv: {
    command: 'kv <action> <store> [key] [value]',
    describe: 'Read and write the local KV store (list, get, set, delete)',
    load: () => import('./commands/kv.js')
  }
};

async function loadLazy(name) {
  return (await LAZY[name].load()).default;
}

function lazyStub(name) {
  const { command, describe } = LAZY[name];
  return {
    command,
    describe,
    builder: (yargs) => yargs,
    promptArgs: async () => (await loadLazy(name)).promptArgs(),
    handler: async (argv) => (await loadLazy(name)).handler(argv)
  };
}

/**
 * The commands by name. serve and kv are the full modules only when argv
 * names them; else they are stubs that import the module when they run.
 * @param {string[]} [argv] The command-line arguments.
 */
export async function loadCommands(argv = []) {
  const lazy = {};
  for (const name of Object.keys(LAZY)) {
    lazy[name] = argv.includes(name) ? await loadLazy(name) : lazyStub(name);
  }
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
    'functions-add': functionsAddCommand,
    'rules': rulesCommand,
    'kv-indexes': kvIndexesCommand,

    // Local development
    'serve': lazy.serve,
    'kv': lazy.kv,

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
    { value: 'functions-add', label: 'Add an edge function to a manifest (new UUID)' },
    { value: 'rules', label: 'Deploy managed rules from JSON' },
    { value: 'kv-indexes', label: 'Declare KV indexes from meta.json' },
    { value: 'serve', label: 'Run the site locally' },
    { value: 'kv', label: 'Read and write the local KV store' },

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

export async function getCommand(name) {
  return (await loadCommands([name]))[name];
}
