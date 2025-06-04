const assert = require('assert');
const { getColor } = require('./map_utils.js');

assert.strictEqual(getColor(0), '#f7f7f7');
assert.strictEqual(getColor(0.15), '#fddbc7');
assert.strictEqual(getColor(0.25), '#f4a582');
assert.strictEqual(getColor(0.35), '#d6604d');
assert.strictEqual(getColor(0.45), '#b2182b');
assert.strictEqual(getColor(0.55), '#67001f');

console.log('All tests passed.');

