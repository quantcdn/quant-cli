// A @quantcdn/kv-ledger-conformance adapter around the KV that quant serve
// wires (openLocalKv, in memory). Each store the suite asks for is declared
// as a meta.json store would be, so the allow-list of quant serve applies.

import { openLocalKv } from '../../src/serve/kv/wire.js';

const ORG = 'kvc';
const PROJECT = 'serve';

function capabilitiesOf(clock, budgetRows) {
  return {
    virtualClock: clock.virtual === true,
    eventualIndexLists: false,
    indexBuildStates: false,
    proofTiming: true,
    signedProofs: true,
    search: true,
    secretEncryption: true,
    subjectV1: true,
    setClock: true,
    advanceArchive: true,
    injectFault: true,
    shortPages: budgetRows <= 10
  };
}

function createAdmin(kv) {
  let counter = 0;
  return {
    async createStore() {
      counter += 1;
      const storeId = await kv.declare({ name: `store-${counter}`, indexes: [], initialValues: [] });
      return { storeId, identity: { org: ORG, store: storeId } };
    },
    declareIndex: (storeId, def, { wait = true } = {}) => kv.backend.declareIndex(storeId, def, { wait }),
    async dropIndex(storeId, name) {
      await kv.backend.dropIndex(storeId, name);
    },
    declareLedger: (storeId, def, { wait = true } = {}) => kv.backend.declareLedger(storeId, def, { wait }),
    async dropLedger(storeId, name) {
      await kv.backend.dropLedger(storeId, name);
    },
    shred: (storeId, ledger, body) => kv.backend.shred(storeId, ledger, body),
    subjectEntries: async (storeId, ledger, body) => kv.backend.subjectEntries(storeId, ledger, body),
    async proofPublicKey() {
      return kv.backend.publicKey();
    },
    async dispose() {
      await kv.backend.reset();
    }
  };
}

function createControl(backend) {
  return {
    setClock: async (ms) => { await backend.setClock(ms); },
    injectFault: async (fault) => { backend.injectFault(fault); },
    advanceArchive: async (storeId) => { await backend.archiveNow(storeId); },
    setIndexState: (storeId, name, state) => backend.setIndexState(storeId, name, state)
  };
}

export async function createAdapter(options = {}) {
  const { clock, budgetRows = 3 } = options;
  const kv = await openLocalKv({ root: process.cwd(), org: ORG, project: PROJECT, stores: [], memory: true, clock, budgetRows });
  return {
    name: 'quant serve (openLocalKv, memory)',
    kvStore: kv.kvStore,
    shapes: ['global', 'handle'],
    clock,
    capabilities: capabilitiesOf(clock, budgetRows),
    admin: createAdmin(kv),
    control: createControl(kv.backend)
  };
}
