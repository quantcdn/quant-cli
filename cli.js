#!/usr/bin/env node

const chalk = require('chalk');
const log = console.log;
const yargs = require('yargs');
const prompt = require('prompt');
const fs = require('fs');
const config_file = 'quant.json';
const cliProgress = require('cli-progress');
const _colors = require('colors');
const fetch = require('node-fetch');

const argv = yargs
    .usage('usage: $0 <command>')
    .command('init', 'Initialise QuantCDN in current working directory', {
        token: {
            description: 'Optionally provide token',
            alias: 't',
            type: 'string',
        },
        clientid: {
            description: 'Optionally provide client id',
            alias: 'c',
            type: 'string',
        },
    })
    .command('deploy', 'Deploy a static folder to QuantCDN', {
      dir: {
          description: 'Directory containing static assets',
          alias: 'd',
          type: 'string',
      }
    })
    .command('info', 'Give info based on current folder')
    .help()
    .alias('help', 'h')
    .argv;



if (argv._.includes('info')) {
    const dir = argv.dir;

    log(chalk.bold.green("*** Quant info ***"));

    const fs = require('fs');

    fs.readFile(config_file, (err, data) => {
      if (err) throw err;
      let config = JSON.parse(data);
      log(config);

      // Attept connection to API.
      ping(config)
    });
}


if (argv._.includes('deploy')) {
    const dir = argv.dir;

    log(chalk.bold.green("*** Quant deploy ***"));

    const fs = require('fs');

    fs.readFile(config_file, (err, data) => {
      if (err) throw err;
      let config = JSON.parse(data);

      const { promisify } = require('util');
      const { resolve } = require('path');
      const fs = require('fs');
      const readdir = promisify(fs.readdir);
      const stat = promisify(fs.stat);
      
      async function getFiles(dir) {
        const subdirs = await readdir(dir);
        const files = await Promise.all(subdirs.map(async (subdir) => {
          const res = resolve(dir, subdir);
          return (await stat(res)).isDirectory() ? getFiles(res) : res;
        }));
        return files.reduce((a, f) => a.concat(f), []);
      }

      let path = require('path');
      var p = path.resolve(process.cwd(), config.dir);

      getFiles(p)
        .then(files => {
          // create new progress bar
          const b1 = new cliProgress.SingleBar({
            format: 'Progress |' + _colors.green('{bar}') + '| {percentage}% || {value}/{total} assets || Speed: {speed}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
          });
 
          b1.start(files.length, 0, {
            speed: "N/A"
          });

          for (file in files) {
            let filepath = path.relative(p, files[file])
            
            // Treat index.html files as route.
            if (filepath.endsWith("index.html")) {

              fs.readFile(files[file], {encoding: 'utf-8'}, (err, data) => {
                if (err) throw err;

                let payload = {
                  "url": "/"+filepath,
                  "content": data,
                  "published": true
                };

                fetch(config.endpoint, {
                  method: 'post',
                  body: JSON.stringify(payload),
                  headers: {
                    'Content-Type': 'application/json',
                    'Quant-Customer': config.clientid,
                    'Quant-Token': config.token
                  }
                })
                .then(res => res.json());
                //.then(json => console.log(json));
              });
            }
            else {

              // @todo: Properly subit files, obviously.
              var util = require('util');
              var exec = require('child_process').exec;

              var command = 'curl -H "Quant-Customer: '+config.clientid+'" -H "Quant-Token: '+config.token+'" -H "Quant-File-Url: /'+filepath+'" -F "filename=@'+files[file]+'" '+config.endpoint

              child = exec(command, function(error, stdout, stderr){
                if(error !== null)
                {
                  console.log('exec error: ' + error);
                }
              });                

            }

            b1.increment();
          }

          b1.stop();
        })
        .catch(e => console.error(e));


    });



}

if (argv._.includes('init')) {
    const token    = argv.token;
    const clientid = argv.clientid;

    log(chalk.bold.green("*** Initialise Quant ***"));

    if (!token || !clientid) {

      var schema = {
        properties: {
          endpoint: {
            required: true,
            description: 'Enter QuantCDN endpoint',
            default: "https://uploads.quantcdn.io"
          },
          clientid: {
            pattern: /^[a-zA-Z0-9\-]+$/,
            message: 'Client id must be only letters, numbers or dashes',
            required: true,
            description: 'Enter QuantCDN client id'
          },
          token: {
            hidden: true,
            replace: '*',
            required: true,
            description: 'Enter QuantCDN token'
          },
          dir: {
            required: true,
            description: 'Directory containing static assets',
            default: 'build'
          }
        }
      };
      prompt.start();
      prompt.get(schema, function (err, result) {
        init(result.clientid, result.token, result.endpoint, result.dir);
      });
    }
    else {
      init(clientid, token);
    }

}


function init(clientid, token, endpoint, dir) {

  endpoint = endpoint || "https://uploads.quantcdn.io"
  dir = dir || "build"

  let config = {
    clientid: clientid,
    token: token,
    endpoint: endpoint,
    dir: dir
  };

  let data = JSON.stringify(config, null, 2);

  // @todo: Read existing config/update
  fs.writeFile(config_file, data, (err) => {
      if (err) throw err;
      console.log('Wrote quant.json config');
  });

  // Test API connectivity
  ping(config)
}


function ping(config) {

  fetch(config.endpoint+'/ping', {
    method: 'get',
    headers: {
      'Content-Type': 'application/json',
      'Quant-Customer': config.clientid,
      'Quant-Token': config.token
    }
  })
  .then(res => res.json())
  .then(json => {
    console.log(json);
    if (!json.error) {
      log(chalk.bold.green(`✅✅✅ Successfully connected to API using project: ${json.project}`));
    }
    else {
      log(chalk.bold.red("Unable to connect to API"));
    }
  });

}

