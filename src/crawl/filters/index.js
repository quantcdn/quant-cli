/**
 * Directory loader for DOM filters.
 */
const path = require('path');
require('fs').readdirSync(__dirname).forEach(function(file) {
  if (file === 'index.js') {
    return;
  }
  /* Store module with its name (from filename) */
  module.exports[path.basename(file, '.js')] = require(path.join(__dirname, file));
});
