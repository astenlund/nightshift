'use strict';

const fs = require('node:fs');
const path = require('node:path');

function enospc() {
  return Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', errno: -4055, syscall: 'write' });
}

// Fails one of an attempt's artifact files as a full disk would: as it is created, before the host starts, or through the returned
// callback, which a test calls from onProcess once the host is running. One per test, since it mocks fs.createWriteStream.
function artifactFailure(t, basename, { onCreate = false } = {}) {
  const original = fs.createWriteStream;
  let latest = null;
  t.mock.method(fs, 'createWriteStream', (file, ...rest) => {
    const stream = original(file, ...rest);
    if (path.basename(String(file)) === basename) {
      latest = stream;
      if (onCreate) stream.destroy(enospc());
    }
    return stream;
  });
  return () => {
    const stream = latest;
    setTimeout(() => stream.destroy(enospc()), 50);
  };
}

module.exports = { artifactFailure };
