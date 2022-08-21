/**
 * Login via Quant portal.
 *
 * @usage
 *   quant login
 */

const io = require('../io');
const config = require('../config');
const express = require('express');
const open = require('open');
const http = require('http');
const yargs = require('yargs');

const activeOrg = require('./activeOrg');
const activeProject = require('./activeProject');

const command = {};

command.command = 'login';
command.describe = 'Login to QuantCDN';
command.builder = () => {};

command.handler = async (argv) => {
  const app = express();
  const server = http.createServer(app);
  const timer = setTimeout(() => {
    server.close();
    io.dimmed('Timed out waiting for authorization. Please try again.');
    yargs.exit(0);
  }, 60000);

  io.title('login');

  app.get('/oauth', async (req, res) => {
    const token = req.query.token;

    clearTimeout(timer);

    res.send('<script type="text/javscript">setTimeout(() => {window.close()}, 500)</script>Successfully logged in, you can <a href="#" onlcick="window.close();">close</a> the window.');

    config.set({
      tokens: [token],
      activeToken: 0,
    });

    io.verbosity = 0;

    try {
      await activeOrg.handler(argv);
      await activeProject.handler(argv);
    } catch (err) {
      console.log(err);
      io.critical('Unable to set active subscriptions');
      yargs.exit(1);
    }

    io.verbosity = 1;
    io.success('You have successfully logged in! Happy Quanting!');
    server.close();
    yargs.exit(0);
  });

  // express.listen requires a port - this will be static and
  // we don't know what port the users machine will have available
  // this method allows node to auto-assign the port to the next
  // available so we and we can redirect back to localhost correctly.
  await server.listen(0);
  const redir = encodeURIComponent(`http://localhost:${server.address().port}/oauth`);
  open(`http://localhost:8001/oauth/login?redirect=${redir}`);
  io.dimmed('waiting for authorization...');
};

module.exports = command;
