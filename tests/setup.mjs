import { expect, assert, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

// Add sinon-chai assertions
use(sinonChai);

// Global test helpers
global.expect = expect;
global.assert = assert;
global.sinon = sinon;

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalHome = os.homedir;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-cli-tests-'));
// config.save() writes a user-level file as well as quant.json. Tests must
// never overwrite a developer's saved credentials.
os.homedir = () => testHome;
export const mochaHooks = {
  afterAll() {
    os.homedir = originalHome;
    fs.rmSync(testHome, { recursive: true, force: true });
  }
};
