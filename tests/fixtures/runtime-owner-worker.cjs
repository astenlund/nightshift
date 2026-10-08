'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { execute } = require('../../internal/runtime/cli');
const { ReviewStore } = require('../../internal/runtime/review-store');
const [root, reviewContextId, session] = process.argv.slice(2);
const actor = { host: 'codex', session };
const dependencies = { nativeOwner: () => ({ pid: 12345, created: 'fixture-process', name: 'codex.exe' }), ownerAlive: () => true };

process.once('message', async () => {
  let result;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const store = new ReviewStore(root, { contextId: reviewContextId });
      let revision;
      try { revision = store.read().revision; } finally { store.close(); }
      await execute(root, { action: 'worker', reviewContextId, actor, revision, worker: { id: session, session: session + '-worker', assignment: 'Own the shared file', role: 'implementer', writes: ['shared.js'] } }, dependencies);
      result = { accepted: true };
      break;
    } catch (error) {
      if (error.code === 'runtime-ownership-busy' || error.code === 'ERR_SQLITE_ERROR' && /database is locked/.test(error.message)) {
        await delay(20);
        continue;
      }
      result = { accepted: false, code: error.code, message: error.message };
      break;
    }
  }
  process.send(result ?? { accepted: false, code: 'retry-exhausted' });
  process.disconnect();
});
process.send({ ready: true });
