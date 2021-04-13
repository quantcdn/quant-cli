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
const {write, read} = require('../helper/resumeState');
const request = require('request');
const util = require('util');
const fs = require('fs');
const tmp = require('tmp');
const detectImage = require('../helper/detectImage');
const detectImage = require('../helper/responsiveImages');

let crawl;
let count = 0;
const failures = [];
const get = util.promisify(request.get);

const command = {};

command.command = 'crawl [domain]';
command.describe = 'Crawl and push an entire domain';
command.builder = {};

/**
 * When the operator interrupts the process, store the
 * state of the crawler.
 */
process.on('SIGINT', function() {
  if (typeof crawl != 'undefined') {
    crawl.stop();
    write(crawl);
  }
});

command.handler = async function(argv) {
  console.log(chalk.bold.green('*** Quant crawl ***'));

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  const domain = argv.domain;

  if (!domain) {
    console.log('Missing required parameter: ' + chalk.red('[domain]'));
    return;
  }

  crawl = crawler(domain);

  crawl.interval = 300;
  crawl.decodeResponses = true;
  crawl.maxResourceSize = 268435456; // 256MB
  crawl.maxConcurrency = 4;
  crawl.respectRobotsTxt = false;

  const quant = client(config);

  // Get the domain host.
  let hostname = domain;
  if (hostname.indexOf('//') > -1) {
    hostname = hostname.split('/')[2];
  } else {
    hostname = hostname.split('/')[0];
  }

  // find & remove port number
  hostname = hostname.split(':')[0];
  // find & remove "?"
  hostname = hostname.split('?')[0];

  crawl.domainWhitelist = [
    hostname,
  ];

  if (hostname.startsWith('www.')) {
    crawl.domainWhitelist.push(hostname.slice(4));
  }

  crawl.on('complete', await function() {
    console.log(chalk.bold.green('✅ All done! ') + ` ${count} total items.`);
    console.log(chalk.bold.green('Failed items:'));
    console.log(failures);
    write(crawl);
  });

  crawl.on('fetchredirect', function(queueItem, redirectQueueItem, response) {
    let path = queueItem.path;

    // Strip last slash.
    if (path.substr(-1) === '/') {
      path = path.substr(0, path.length - 1);
    }

    // Add internal redirects to the expected domain to the queue.
    if (redirectQueueItem.host == hostname) {
      crawl.queueURL(redirectQueueItem.url, redirectQueueItem.referrer);
      console.log(chalk.bold.green('✅ Adding:') + ` ${redirectQueueItem.url}`);

      // Ensure redirects pointing to themselves are ignored.
      if (queueItem.path == path || queueItem.path == redirectQueueItem.path) {
        return;
      }

      crawl.queueURL(redirectQueueItem.url, redirectQueueItem.referrer);
      console.log(chalk.bold.green('✅ Adding:') + ` ${redirectQueueItem.url}`);

      // Add internal redirect.
      if (queueItem.path != path) {
        quant.redirect(queueItem.path, path, 'quant-cli', 301);
        console.log(chalk.bold.green('✅ REDIRECT:') + ` ${queueItem.path} => ${path}`);
      }
    } else {
      count++;
      quant.redirect(path, redirectQueueItem.url, 'quant-cli', 301);
      console.log(chalk.bold.green('✅ REDIRECT:') + ` ${path} => ${redirectQueueItem.url}`);
    }
  });

  // Capture errors.
  crawl.on('fetcherror', function(queueItem, response) {
    console.log(chalk.bold.red('❌ ERROR:') + ` ${queueItem.stateData.code} for ${queueItem.url}`);
    failures.push({'code': queueItem.stateData.code, 'url': queueItem.url});
    if (queueItem.stateData.code == 403) {
      console.log('403');
    }
  });

  crawl.on('fetchcomplete', async function(queueItem, responseBuffer, response) {
    const items = [];

    if (response.headers['content-type'] && (response.headers['content-type'].includes('text/html') || response.headers['content-type'].includes('css'))) {
      // Find background images in css and page body and add them to the queue.
      const images = await detectImage(responseBuffer, queueItem.host, queueItem.protocol);
      images.map((i) => items.push(i));
    }

    // Detect pictures and srcset attributes.
    if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
      const images = await responsiveImages(responseBuffer, queueItem.host, queueItem.protocol);
      images.map((i) => items.push(i));
    }

    items.forEach((item) => crawl.queueURL(item, queueItem.referrer));


    // Cheap strip of domain.
    const url = queueItem.url.replace(domain, '');
    const buffer = Buffer.from(responseBuffer, 'utf8');

    if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
      // @todo: Relative link rewrite, needs to be more robust and configurable.
      const makeRelative = true;
      let content = buffer.toString();
      if (makeRelative) {
        const domainRegex = new RegExp(domain, 'g');
        content = content.replace(domainRegex, '');
      }
      console.log(chalk.bold.green('✅ MARKUP:') + ` ${url}`);
      try {
        await quant.markup(Buffer.from(content), url);
      } catch (err) {}
    } else {
      // @TODO: Identify why the file needs to be downloaded twice is -
      // it looks to only affect some files, it seems PNG is affected but
      // not all files.
      const tmpfile = tmp.fileSync();
      const file = fs.createWriteStream(tmpfile.name);
      const opts = {url: queueItem.url, encoding: null};
      const response = await get(opts);

      if (!response.body || response.body.byteLength < 50) {
        queueItem.status = 'failed';
        file.close();
      }

      const asset = Buffer.from(response.body, 'utf8');
      fs.writeFileSync(tmpfile.name, asset);

      console.log(chalk.bold.green('✅ FILE:') + ` ${url}`);
      try {
        await quant.file(tmpfile.name, url, true);
      } catch (err) {}
    }
    count++;
  });

  read(crawl);
  crawl.start();
};

module.exports = command;
