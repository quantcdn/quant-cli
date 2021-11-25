/**
 * Crawl and push an entire website to Quant.
 *
 * @usage
 *  quant crawl -d https://www.google.com/
 */
const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');
const crawler = require('simplecrawler');
const {write} = require('../helper/resumeState');
const request = require('request');
const util = require('util');
const fs = require('fs');
const tmp = require('tmp');
const prompt = require('prompt');
const os = require('os');

const {redirectHandler} = require('../crawl/callbacks');

const filters = require('../crawl/filters');
const detectors = require('../crawl/detectors');

let crawl;
let count = 0;
let writingState = false;
let filename;

const tmpfiles = [];
const failures = [];
const get = util.promisify(request.get);

const command = {};

command.command = 'crawl <domain>';
command.describe = 'Crawl and push an entire domain';
command.builder = {
  'rewrite': {
    describe: 'Rewrite host patterns',
    alias: 'r',
    type: 'boolean',
    default: false,
  },
  'attachments': {
    describe: 'Find attachments',
    alias: 'a',
    type: 'boolean',
    default: false,
  },
  'interval': {
    describe: 'Crawl interval',
    alias: 'i',
    type: 'integer',
    default: 200,
  },
  'cookies': {
    describe: 'Accept cookies during the crawl',
    alias: 'c',
    type: 'boolean',
    default: false,
  },
  'concurrency': {
    describe: 'Crawl concurrency',
    alias: 'n',
    type: 'integer',
    default: 4,
  },
  'size': {
    describe: 'Crawl resource buffer size in bytes',
    alias: 's',
    type: 'integer',
    default: 268435456,
  },
  'robots': {
    describe: 'Respect robots',
    type: 'boolean',
    default: false,
  },
  'skip-resume': {
    describe: 'Start a fresh crawl ignoring resume state',
    type: 'boolean',
    default: false,
  },
  'no-interaction': {
    describe: 'No user interaction',
    type: 'boolean',
    default: false,
  },
  'urls-file': {
    describe: 'JSON file containing array of URLs to add to the queue',
    type: 'string'
  }
};

/**
 * When the operator interrupts the process, store the
 * state of the crawler.
 */
[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
  process.on(eventType, function() {
    if (typeof crawl != 'undefined' && !writingState) {
      writingState = true;
      // Saving the state cannot be async as exit hooks don't correctly
      // execute async callbacks.
      write(crawl, filename);
    }
  });
});

command.handler = async function(argv) {
  console.log(chalk.bold.green('*** Quant crawl ***'));

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  // Set the resume-state filename.
  filename = `${config.get('clientid')}-${config.get('project')}`;

  const domain = argv.domain;

  if (!domain) {
    console.log('Missing required parameter: ' + chalk.red('[domain]'));
    return;
  }

  // Queue URLs from urls-file if provided.
  urlsdata = [];
  if (argv['urls-file'] && argv['urls-file'].length > 0) {
    try {
      urlsdata = JSON.parse(fs.readFileSync(argv['urls-file']));
    } catch (error) {
      console.log(chalk.bold.red('❌ ERROR: Cannot read urls-file: ' + argv['urls-file']));
      process.exit(1)
    }
  }

  crawl = crawler(domain);
  crawl.interval = argv.interval;
  crawl.decodeResponses = true;
  crawl.maxResourceSize = argv.size; // 256MB
  crawl.maxConcurrency = argv.concurrency;
  crawl.respectRobotsTxt = argv.robots;
  crawl.acceptCookies = argv.cookies;

  const quant = client(config);

  // Get the domain host.
  let hostname = domain;

  if (hostname.indexOf('//') > -1) {
    hostname = hostname.split('/')[2];
  } else {
    hostname = hostname.split('/')[0];
  }

  // Prepare the hostname.
  hostname = hostname.split(':')[0];
  hostname = hostname.split('?')[0];

  crawl.domainWhitelist = [
    hostname,
  ];

  if (hostname.startsWith('www.')) {
    crawl.domainWhitelist.push(hostname.slice(4));
  }

  crawl.on('complete', function() {
    console.log(chalk.bold.green('✅ All done! ') + ` ${count} total items.`);
    console.log(chalk.bold.green('Failed items:'));
    console.log(failures);
    console.log(`Removing temporary files ${tempfiles.length}`);
    tmpfiles.map(fs.unlinkSync);
    write(crawl, filename);
  });

  // Handle sending redirects to the Quant API.
  crawl.on('fetchredirect', (item, redirect, response) => redirectHandler(quant, item, redirect));

  // Capture errors.
  crawl.on('fetcherror', function(queueItem, response) {
    console.log(chalk.bold.red('❌ ERROR:') + ` ${queueItem.stateData.code} for ${queueItem.url}`);
    failures.push({'code': queueItem.stateData.code, 'url': queueItem.url});
    if (queueItem.stateData.code == 403) {
      console.log('403');
    }
  });

  crawl.on('fetchcomplete', async function(queueItem, responseBuffer, response) {
    const extraItems = [];

    // Prepare the detectors - attempt to locate additional requests to add
    // to the queue based on patterns in the DOMString.
    // eslint-disable-next-line no-unused-vars
    for (const [n, detector] of Object.entries(detectors)) {
      if (detector.applies(response)) {
        await detector.handler(responseBuffer, queueItem.host, queueItem.protocol).map((i) => extraItems.push(i));
      }
    }

    extraItems.forEach((item) => crawl.queueURL(item, queueItem.referrer));

    // Cheap strip of domain.
    const url = queueItem.url.replace(domain, '');
    const buffer = Buffer.from(responseBuffer, 'utf8');

    if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
      let content = buffer.toString();

      // eslint-disable-next-line no-unused-vars
      for (const [name, filter] of Object.entries(filters)) {
        if (!argv.hasOwnProperty(filter.option)) {
          // Filters must have an option to toggle them - if the option is
          // not defined we skip this filter.
          continue;
        }
        if (argv[filter.option]) {
          content = filter.handler(content, queueItem);
        }
      }
      console.log(chalk.bold.green('✅ MARKUP:') + ` ${url}`);

      try {
        await quant.markup(Buffer.from(content), url, true, argv.attachments);
      } catch (err) {}
    } else {
      // @TODO: Identify why the file needs to be downloaded twice is -
      // it looks to only affect some files, it seems PNG is affected but
      // not all files.
      const tmpfile = tmp.fileSync();
      const file = fs.createWriteStream(tmpfile.name);
      const opts = {url: queueItem.url, encoding: null};
      const response = await get(opts);

      tmpfiles.push(tmpfile.name);

      if (!response.body || response.body.byteLength < 50) {
        queueItem.status = 'failed';
        file.close();
      }

      const asset = Buffer.from(response.body, 'utf8');
      const extraHeaders = {};
      fs.writeFileSync(tmpfile.name, asset);

      // Disposition headers.
      ['content-disposition', 'content-type'].map((i) => {
        if (Object.keys(queueItem.stateData.headers).includes(i)) {
          extraHeaders[i] = queueItem.stateData.headers[i];
        }
      });

      console.log(chalk.bold.green('✅ FILE:') + ` ${url}`);
      try {
        await quant.file(tmpfile.name, url, true, extraHeaders);
      } catch (err) {}

      fs.unlinkSync(tmpfile.name)
    }
    count++;
  });

  if (!argv['skip-resume']) {
    let result;

    if (!fs.existsSync(`${os.homedir()}/.quant/${filename}`)) {
      result = {resume: false};
    }
    else if (!argv['no-interaction']) {
      prompt.start();
      result = await prompt.get({
        properties: {
          resume: {
            required: true,
            description: 'Resume from the previous crawl?',
            default: true,
            type: 'boolean',
          },
        },
      });
    } else {
      result = {resume: true};
    }

    if (result.resume) {

      // Prevent manual URL list when resuming.
      if (urlsdata.length > 0) {
        console.log(chalk.bold.green('❌ ERROR: Cannot use --urls-file while resuming, ignoring.'));
        urlsdata = [];
      }

      // Defrost is async and supports non-existent files.
      crawl.queue.defrost(`${os.homedir()}/.quant/${filename}`, (err) => {
        console.log(chalk.bold.green('✅ DONE: Loaded resume state from ' + `${os.homedir()}/.quant/${filename}`)); // eslint-disable-line max-len
      });
    }

  } else {
    console.log(chalk.bold.green('Skipping resume state via --skip-resume.'));
  }

  // Inject URLs provided via urls-file.
  if (urlsdata.length > 0) {
    for (const url of urlsdata) {
      crawl.queueURL(url);
    }
  }

  crawl.start();
};

module.exports = command;
