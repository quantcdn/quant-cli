// A small dev server for the --run tests: it listens on the given port and
// writes its pid to the given file.
import fs from 'node:fs';
import http from 'node:http';

const [port, pidFile] = process.argv.slice(2);
http.createServer((_req, res) => res.end('dev')).listen(Number(port), '127.0.0.1', () => {
  fs.writeFileSync(pidFile, String(process.pid));
});
