// A --run command that moves the dev server to the background and exits 0,
// as some dev servers do. With "own-group", the dev server also leaves the
// process group.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [port, pidFile, mode] = process.argv.slice(2);
const server = fileURLToPath(new URL('./dev-server.mjs', import.meta.url));
const child = spawn(process.execPath, [server, port, pidFile], { detached: mode === 'own-group', stdio: 'ignore' });
child.unref();
process.exit(0);
