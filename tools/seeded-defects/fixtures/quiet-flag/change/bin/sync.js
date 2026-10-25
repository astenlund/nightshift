const { sync } = require('../src/sync');

const args = process.argv.slice(2);
const silent = args.includes('--silent');
const target = args.find(arg => !arg.startsWith('--'));
const log = silent ? () => {} : line => console.log(line);
sync(target, log);
