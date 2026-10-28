// Use with node --import: installs hooks.mjs before the entry point loads.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
