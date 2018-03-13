const misc = require('./misc');

const enabledNamespaces = [];
const disabledNamespaces = [];

const enabledVerbose = [];
const disabledVerbose = [];

const colors = ['blue', 'green', 'magenta', 'yellow', 'cyan', 'red'];
let colorsIndex = 0;

const noop = () => {};
noop.verbose = noop;
noop.v = noop;
noop.isEnabled = false;
noop.verbose.isEnabled = false;
noop.v.isEnabled = false;

let logger = console.log;


// initialize
if (process.env.DEBUG) {
  process.env.DEBUG
    .replace(/\*/g, '.*?')
    .split(',')
    .filter(s => !!s)
    .forEach((namespace) => {
      (namespace.substr(0, 1) === '-')
        ? disabledNamespaces.push(namespace.substr(1))
        : enabledNamespaces.push(namespace);
    });
}

if (process.env.VERBOSE) {
  process.env.VERBOSE.replace(/\*/g, '.*?')
    .split(',')
    .filter(s => !!s)
    .forEach((namespace) => {
      (namespace.substr(0, 1) === '-')
        ? disabledVerbose.push(namespace.substr(1))
        : enabledVerbose.push(namespace);
    });
}


function namespaceIsEnabled(name) {
  if (!enabledNamespaces.length) return false;

  function matches(namespace) {
    return name.match(new RegExp(`^${namespace}$`));
  }

  if (disabledNamespaces.some(matches)) return false;
  if (enabledNamespaces.some(matches)) return true;

  return false;
}


function namespaceIsVerbose(name) {
  if (!enabledVerbose.length) return false;

  function matches(namespace) {
    return name.match(new RegExp(`^${namespace}$`));
  }

  if (disabledVerbose.some(matches)) return false;
  if (enabledVerbose.some(matches)) return true;

  return false;
}


function timestamp() {
  const now = new Date();

  const time = [
    misc.padStart(now.getHours(), 2, '0'),
    misc.padStart(now.getMinutes(), 2, '0'),
    misc.padStart(now.getSeconds(), 2, '0'),
    misc.padStart(now.getMilliseconds(), 3, '0'),
  ];

  return `[${time.join(':')}]`;
}


/**
 * Returns debug fn if debug is enabled, noop if not
 *
 * @param  {string} namespace
 * @return {function}
 */
module.exports = function debug(namespace) {
  if (!namespaceIsEnabled(namespace)) return noop;

  // shorten Zeroconf:filename.js -> filename… becuase its driving me crazy
  let shortname = namespace.replace('dnssd:', '');
  if (shortname.length > 10) shortname = shortname.substr(0, 9) + '…';
  if (shortname.length < 10) shortname = misc.pad(shortname, 10);

  const color = colors[colorsIndex++ % colors.length];
  const prefix = misc.color('•' + shortname, color);

  function logFn(msg, ...args) {
    // '•Query.js [10:41:54:482] '
    let output = `${prefix} ${misc.color(timestamp(), 'grey')} `;
    output += misc.format(msg, ...args);

    logger(output);
  }

  logFn.isEnabled = true;

  if (namespaceIsVerbose(namespace)) {
    logFn.verbose = logFn;
    logFn.v = logFn;
    logFn.verbose.isEnabled = true;
    logFn.v.isEnabled = true;
  } else {
    logFn.verbose = noop;
    logFn.v = noop;
  }

  return logFn;
};
