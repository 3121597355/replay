// Node tests run outside Next's bundler. Preserve the production import guard;
// only replace its marker in this explicitly required test bootstrap.
const Module = require('node:module');
const original = Module._load;
Module._load = function (id, ...args) {
  if (id === 'server-only') return {};
  return original.call(this, id, ...args);
};
