'use strict';

const fs = require('node:fs');
const path = require('node:path');
const [cli, root, requestFile] = process.argv.slice(2);
const bundle = path.resolve(path.dirname(cli), '../..');
const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
const { admitEntry } = require(path.join(bundle, 'internal/releases/entry'));
const { isReadOnlyAction } = require(path.join(bundle, 'internal/runtime/actions'));
const admitted = admitEntry(bundle, [root, requestFile], 0, { exactProject: true, diagnostic: isReadOnlyAction(request.action) });
const dependencies = {
  resourceContext: admitted.context,
  nativeOwner: host => ({ found: true, pid: process.ppid, created: 'fixture-native-controller', name: host + '.exe' }),
  ownerAlive: owner => owner?.pid === process.ppid,
};

require(cli).execute(root, request, dependencies).then(result => {
  process.stdout.write(JSON.stringify(result) + '\n');
}).catch(error => {
  process.stderr.write(JSON.stringify({ error: error.code, message: error.message }) + '\n');
  process.exitCode = 1;
});
