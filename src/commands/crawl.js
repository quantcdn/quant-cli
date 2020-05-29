/**
 * Crawl and push an entire website to Quant.
 *
 * @usage
 *  quant crawl -d https://www.google.com/
 */

const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');
const util = require('util');
const crawler = require('simplecrawler');
const request = require('request');
const post = util.promisify(request.post);
const fs = require('fs');
const matchAll = require('string.prototype.matchall');
const resumeFile = "./crawler-queue-tmp"

var crawl;
var count=0;
var failures=[];

function writeResumeState() {

    console.log(chalk.bold.blue('Stopping crawl..'));
    crawl.stop();
    console.log(chalk.bold.blue('Writing resume state to disk..'));

    var queue = crawl.queue;

    // Re-queue in-progress items before freezing...
    queue.forEach(function(item) {
        if (item.fetched !== true) {
            item.status = "queued";
        }
    });

    if (fs.existsSync(resumeFile)) {
      fs.unlinkSync(resumeFile)
    }

    var resumeStream = fs.createWriteStream(resumeFile, {flags:'a'});

    queue.forEach(function(item, idx, arr) {

      var appendString = '';

      // Add opener.
      if (idx === 0){
        appendString = '[';
      }

      // Add comma to all but last item.
      if (idx !== arr.length - 1){
        appendString += JSON.stringify(item, null, 2) + ",";
      }

      // Add closer.
      if (idx === arr.length - 1){
        appendString += JSON.stringify(item, null, 2) + "\n]";
      }

      resumeStream.write(appendString);
    });

    resumeStream.end();
    console.log(chalk.bold.green('✅ DONE: Wrote resume state to ' + resumeFile));


    fs.writeFile("last-run-failures.json", failures, 'utf8', function (err) {
      if (err) {
        console.log("An error occured while writing JSON Object to File.");
        return console.log(err);
      }

      console.log(chalk.bold.green('✅ DONE: Wrote failure log to last-run-failures.json'));
 
    }); 


}

process.on('SIGINT', function() {
  crawl.stop();
  writeResumeState();
});

module.exports = async function(argv) {
  console.log(chalk.bold.green('*** Quant crawl ***'));

  // Make sure configuration is loaded.
  config.load();

  const headers = {
    'User-Agent': 'Quant (+http://api.quantcdn.io)',
    'Quant-Token': config.get('token'),
    'Quant-Customer': config.get('clientid'),
    'Quant-Project': config.get('project'),
    'Content-Type': 'application/json',
  };

  const domain = argv.domain;
  crawl = crawler(domain);
  crawl.interval = 300;
  crawl.maxConcurrency = 3;
  crawl.decodeResponses = true;
  crawl.maxResourceSize = 268435456; // 256MB
  crawl.sortQueryParameters = false;

  const quant = client(config);

  // ABS redirect testing..
  //crawl.queueURL('https://www.abs.gov.au/AUSSTATS/abs@.nsf/DetailsPage/6291.0.55.001Feb%202020?OpenDocument');
  crawl.queueURL('https://www.abs.gov.au/AUSSTATS/ABS@Archive.nsf/log?openagent&6291001.xls&6291.0.55.001&Time%20Series%20Spreadsheet&7A8851CFD452D91BCA2585360017E1B7&0&Feb%202020&26.03.2020&Latest');
  crawl.maxDepth = 1;


  // Get the domain host.
  var hostname = domain;
  if (hostname.indexOf("//") > -1) {
    hostname = hostname.split('/')[2];
  }
  else {
    hostname = hostname.split('/')[0];
  }

  //find & remove port number
  hostname = hostname.split(':')[0];
  //find & remove "?"
  hostname = hostname.split('?')[0];

  crawl.domainWhitelist = [
    hostname,
  ];

  if (hostname.startsWith('www.')) {
    crawl.domainWhitelist.push(hostname.slice(4));
  }

  // Replace "+" with "%20".
  crawl.on("queueadd", function(queueItem, referrerQueueItem) {
    queueItem.url = queueItem.url.replace(/\+/g, "%20");
  });

  crawl.on("complete", function() {
    console.log(chalk.bold.green('✅ All done! ') + ` ${count} total items.`);
    console.log(chalk.bold.green('Failed items:'));
    console.log(failures);
    writeResumeState();
  });

  crawl.on("fetchredirect", function(queueItem, redirectQueueItem, response) {

    queueItem.url = queueItem.url.replace(/\+/g, "%20");
    redirectQueueItem.url = redirectQueueItem.url.replace(/\+/g, "%20");
    console.log(queueItem);

    // Add internal redirects to the expected domain to the queue.
    if (redirectQueueItem.host == hostname) {
      crawl.queueURL(redirectQueueItem.url, redirectQueueItem.referrer);
      console.log(chalk.bold.green('✅ Adding:') + ` ${redirectQueueItem.url}`);
    }
    else {
      var path = redirectQueueItem.path;

      // Strip last slash.
      if(path.substr(-1) === '/') {
        path = path.substr(0, path.length - 1);
      }

      count++;
      quant.redirect(path, redirectQueueItem.url, 'quant-cli', 301);
      console.log(chalk.bold.green('✅ REDIRECT:') + ` ${path} => ${redirectQueueItem.url}`);
    }
  });

  // Capture errors.
  crawl.on("fetcherror", function(queueItem, response) {
    console.log(chalk.bold.red('❌ ERROR:') + ` ${queueItem.stateData.code} for ${queueItem.url}`);
    failures.push({'code': queueItem.stateData.code,'url': queueItem.url});

    if (queueItem.stateData.code == 403) {
      process.exit();
    }
  });

  crawl.on("fetchcomplete", function(queueItem, responseBuffer, response) {
    //console.log("I just received %s (%d bytes)", queueItem.url, responseBuffer.length);
    //console.log("It was a resource of type %s", response.headers['content-type']);

    // Find background images in css and page body.
    if (response.headers['content-type'].includes("text/html") || response.headers['content-type'].includes("css")) {
      const re = /background(-image)?:.*?url\(\s*(?<url>.*?)\s*\)/gi;
      const found = matchAll(responseBuffer, re);

      for(let result of found) {
        // @todo: Relative paths (relative to queueItem).
        var imageurl = result.groups.url.replace(/'|\"/g,'');

        if (!imageurl.startsWith('#')) {

          if (!imageurl.startsWith('http')) {
            imageurl = queueItem.protocol + "://" + queueItem.host + imageurl;
          }
          crawl.queueURL(imageurl, queueItem.referrer);
        }
      }
    }

    // Cheap strip of domain.
    let url = queueItem.url.replace(domain, '');

    // Send to Quant as content.
    if (response.headers['content-type'].includes("text/html")) {

      const buffer = Buffer.from(responseBuffer, 'utf8');

      const options = {
        url: `${config.get('endpoint')}`,
        json: true,
        body: {
          url: `${url}`,
          content: buffer.toString('utf8'),
          published: true,
        },
        headers,
      };

      post(options, function optionalCallback(err, httpResponse, body) {
        if (err) {
          return console.error('upload failed:', err);
        }

        count++;
        console.log(chalk.bold.green('✅ MARKUP:') + ` ${url}`);
      });
    }
    // Send to Quant as file.
    else {

      let randomFile = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5);

      // Clearly silly downloading the file twice (we already have it in the buffer).
      // fs.writeFile seems to generate a corrupt file , have not investigated.
      const file = fs.createWriteStream("./tmp/"+randomFile);

      const file_options = {
        url: queueItem.url,
        encoding: null
      };

      request.get(file_options, function optionalCallback(err, httpResponse, res) {

        if (typeof res === 'undefined') {
          console.log(chalk.bold.red('❌ FAIL:') + ` ${url}`);
          queueItem.status = 'failed';
          failures.push(url);
          file.close();
          fs.unlink("./tmp/"+randomFile, function (err) {
            if (err) {
              console.log(chalk.bold.red('❌ ERROR REMOVING TEMPORARY FILE:') + ` ./tmp/${randomFile}`);
            }
          }); 
          return;
        }

        // Ignore seemingly empty files..
        if (res.byteLength < 50) {
          console.log(chalk.bold.red('❌ SKIPPING:') + ` ${url}`);
          queueItem.status = 'failed';
          file.close();
          fs.unlink("./tmp/"+randomFile, function (err) {
            if (err) {
              console.log(chalk.bold.red('❌ ERROR REMOVING TEMPORARY FILE:') + ` ./tmp/${randomFile}`);
            }
          });
          return;
        }

        const buffer = Buffer.from(res, 'utf8');
        fs.writeFileSync('./tmp/'+randomFile, buffer);

        const formData = {
          data: fs.createReadStream("./tmp/"+randomFile),
        };

        const options = {
          url: config.get('endpoint'),
          json: true,
          headers: {
            ...headers,
            'Content-Type': 'multipart/form-data',
            'Quant-File-Url': url,
          },
          formData,
        };

        post(options, function optionalCallback(err, httpResponse, body) {

          // Close the open file.
          file.close();

          if (err) {
            return console.error('upload failed:', err);
          }

          count++;
          console.log(chalk.bold.green('✅ FILE:') + ` ${url}`);
          fs.unlink("./tmp/"+randomFile, function (err) {
            if (err) {
              console.log(chalk.bold.red('❌ ERROR REMOVING TEMPORARY FILE:') + ` ./tmp/${randomFile}`);
            }
          });
        });
      });

    }
  });

  // Resume from state file if exists.
  // @todo: Prompt/optional.
  /*
  if (fs.existsSync(resumeFile)) {
    crawl.queue.defrost(resumeFile, function(err) {
        if (err) throw err;

        console.log(chalk.bold.green('✅ DONE: Loaded resume state from ' + resumeFile));
        crawl.start();
    });
  } else {
    crawl.start();
  }*/

  crawl.start();
    
};
