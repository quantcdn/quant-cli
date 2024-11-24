import { expect, assert, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

// Add sinon-chai assertions
use(sinonChai);

// Global test helpers
global.expect = expect;
global.assert = assert;
global.sinon = sinon; 