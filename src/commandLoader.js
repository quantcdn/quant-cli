function loadCommands() {
  const commands = {
    // Primary deployment commands
    'deploy': require('./commands/deploy'),
    'page': require('./commands/page'),
    'file': require('./commands/file'),
    'redirect': require('./commands/redirect'),
    'purge': require('./commands/purge'),
    'waflogs': require('./commands/waflogs'),
    'search': require('./commands/search'),
    'scan': require('./commands/scan'),

    // Destructive operations
    'unpublish': require('./commands/unpublish'),
    'delete': require('./commands/delete'),

    // Project management
    'info': require('./commands/info'),
    'init': require('./commands/init'),
  };

  return commands;
}

function getCommandOptions() {
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

    // Destructive operations
    { value: 'unpublish', label: 'Unpublish an asset' },
    { value: 'delete', label: 'Delete an asset' },

    // Visual separator
    { value: 'separator2', label: '───────────────────────', disabled: true },

    // Project management
    { value: 'info', label: 'Show project info' },
    { value: 'init', label: 'Reinitialize project settings' },
  ];
}

module.exports = {
  loadCommands,
  getCommandOptions,
  getCommand: (name) => loadCommands()[name]
}; 