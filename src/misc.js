let os = require('os');
const util = require('util');

const remove_colors_re = /\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[m|K]/g;


/**
 * Makes a fully qualified domain name from dns labels
 *
 * @param  {...string}
 * @return {string}
 */
module.exports.fqdn = function(...labels) {
  const name = labels.join('.');
  return (name.substr(-1) === '.') ? name : name + '.';
};


/**
 * Get hostname. Strips .local if os.hostname includes it
 * @return {string}
 */
module.exports.hostname = function() {
  return os.hostname().replace(/.local\.?$/, '');
};


/**
 * Parses a resource record name into instance, service type, etc
 *
 * Deals with these name formats:
 * -       Instance . _service . _protocol . domain .
 * - Subtype . _sub . _service . _protocol . domain .
 * -                  _service . _protocol . domain .
 * - Single_Label_Host . local .
 *
 * If name fails to parse as expected, it returns an empty obj.
 *
 * @param  {string}
 * @return {object}
 */
module.exports.parse = function(fullname) {
  const obj = {};

  // a full registration name, eg:
  // - '_http._tcp.local.'
  // - 'Instance No. 1._http._tcp.local.'
  // - 'SubTypeName._sub._http._tcp.local.'
  if (!!~fullname.indexOf('._tcp.') || !!~fullname.indexOf('._udp.')) {
    obj.protocol = (!!~fullname.indexOf('._tcp.') ? '_tcp' : '_udp');

    // [['Instance No', ' 1', '_http'], [local]]
    const parts = fullname
      .split(obj.protocol)
      .map(part => part.split('.').filter(p => !!p));

    obj.domain = parts[1].join('.'); // 'local'
    obj.service = parts[0].pop();    // '_http'

    if (parts[0].slice(-1)[0] === '_sub') {
      obj.subtype = parts[0].slice(0, -1).join('.'); // 'SubTypeName'
    } else {
      obj.instance = parts[0].join('.'); // 'Instance No. 1'
    }

  // a 2 label domain name, eg: 'Machine.Name.local.'
  } else if (fullname.match(/local$|local\.$/)) {
    obj.instance = fullname.split('.local').shift(); // Machine.Name
    obj.domain = 'local';
  }

  return obj;
};


module.exports.pad = function(value, len, fill = ' ') {
  const str = String(value);
  const needed = len - str.length;
  return (needed > 0) ? str + fill.repeat(needed) : str;
};


module.exports.padStart = function(value, len, fill = ' ') {
  const str = String(value);
  const needed = len - str.length;
  return (needed > 0) ? fill.repeat(needed) + str : str;
};


/**
 * Visually padEnd. Adding colors to strings adds escape sequences that
 * make it a color but also adds characters to str.length that aren't
 * displayed.
 *
 * @param  {string} str
 * @param  {number} num
 * @return {string}
 */
function visualPad(str, num) {
  const needed = num - str.replace(remove_colors_re, '').length;

  return (needed > 0) ? str + ' '.repeat(needed) : str;
}


/**
 * Make a table of records strings that have equal column lengths.
 *
 * Ex, turn groups of records:
 * [
 *   [
 *     Host.local. * QU,
 *   ]
 *   [
 *     Host.local. A 10 169.254.132.42,
 *     Host.local. AAAA 10 fe80::c17c:ec1c:530d:842a,
 *   ]
 * ]
 *
 * into a more readable form that can be printed:
 * [
 *   [
 *     'Host.local. *    QU'
 *   ]
 *   [
 *     'Host.local. A    10 169.254.132.42'
 *     'Host.local. AAAA 10 fe80::c17c:ec1c:530d:842a'
 *   ]
 * ]
 *
 * @param  {...ResourceRecords[]} groups
 * @return {string[][]}
 */
function alignRecords(...groups) {
  const colWidths = [];
  let result;

  // Get max size for each column (have to look at all records)
  result = groups.map((records) => {
    return records.map((record) => {
      // break record into parts
      const parts = record.toParts();

      parts.forEach((part, i) => {
        const len = part.replace(remove_colors_re, '').length;

        if (!colWidths[i])      colWidths[i] = 0;
        if (len > colWidths[i]) colWidths[i] = len;
      });

      return parts;
    });
  });

  // Add padding:
  result = result.map(records =>
    records.map(recordParts =>
      recordParts.map((part, i) => visualPad(part, colWidths[i])).join(' ')));

  return result;
}

module.exports.alignRecords = alignRecords;


/**
 * Makes a "raw" txt obj for TXT records. A "raw" obj will have string values
 * converted to buffers since TXT key values are just opaque binary data. False
 * values are removed since they aren't sent (missing key = implied false).
 *
 * {key: 'value'} => {'key': <Buffer 76 61 6c 75 65>}
 * {key: true}    => {key: true}
 * {key: null}    => {key: null}
 * {key: false}   => {}
 *
 * @param  {object} obj
 * @return {object} - a new object, original not modified
 */
module.exports.makeRawTXT = function(obj) {
  const result = {};

  Object.keys(obj)
    .filter(key => obj[key] !== false)
    .forEach((key) => {
      const value = obj[key];

      result[key] = (typeof value === 'string')
        ? Buffer.alloc(value.length, value)
        : value;
    });

  return result;
};


/**
 * Makes a more readable txt obj for TXT records. Buffers are converted to
 * utf8 strings, which is likely what you want anyway.
 *
 * @param  {object} obj
 * @return {object} - a new object, original not modified
 */
module.exports.makeReadableTXT = function(obj) {
  const result = {};

  Object.keys(obj)
    .filter(key => obj[key] !== false)
    .forEach((key) => {
      const value = obj[key];
      result[key] = (Buffer.isBuffer(value)) ? value.toString() : value;
    });

  return result;
};


module.exports.defaults = function(obj, defaults) {
  Object.keys(defaults).forEach((key) => {
    if (!obj.hasOwnProperty(key)) obj[key] = defaults[key];
  });
};


module.exports.random = function(min, max) {
  return Math.random() * (max - min) + min;
};


module.exports.color = function(str, color = 'white', bright = false) {
  const colors = {
    black:   30,
    red:     31,
    green:   32,
    yellow:  33,
    blue:    34,
    magenta: 35,
    cyan:    36,
    white:   37,
    grey:    90, // bright black
  };

  const code = (colors[color] || 37) + (bright ? 60 : 0);

  return `\x1B[${code}m${str}\x1B[0m`;
};


module.exports.bg = function(str, color = 'white', bright = false) {
  const colors = {
    black:   40,
    red:     41,
    green:   42,
    yellow:  43,
    blue:    44,
    magenta: 45,
    cyan:    46,
    white:   47,
    grey:    100, // bright black
  };

  const code = (colors[color] || 40) + (bright ? 60 : 0);

  return `\x1B[${code}m${str}\x1B[0m`;
};


module.exports.truncate = function(str, len, end = '…') {
  return (str.length < len) ? str : str.slice(0, len) + end;
};


function stringify(arg = '', type = '') {
  if (type === '%s' || type === '%d') {
    return String(arg);
  }

  // check that each item has the .toParts() method that misc.alignRecords uses
  // or else it will throw
  if (type === '%r') {
    if (Array.isArray(arg) && arg.every(record => ('toParts' in record))) {
      return '\n' + alignRecords(arg).map(group => group.join('\n')).join('\n');
    }

    return String(arg);
  }

  // util.inspect has pretty colors for objects
  if (typeof arg === 'object') {
    const str = util.inspect(arg, { colors: true });
    return (str.match('\n')) ? `\n${str}\n` : str;
  }

  return String(arg);
}


module.exports.format = function(msg, ...args) {
  const hasFormatters = (typeof msg === 'string' && msg.match(/%[a-z]/));

  // replace each format marker in message string with the formatted arg
  // (or just add formatted message to output if no args)
  let output = (hasFormatters && args.length)
    ? msg.replace(/%([a-z])/g, type => stringify(args.shift(), type))
    : stringify(msg);

  // add padding for printing surplus args left over
  if (args.length) output += ' ';

  // print args that didn't have a formatter
  output += args.map(arg => stringify(arg)).join(' ');

  // remove hanging newline at end and add indentation
  output = output.replace(/\n$/, '');
  output = output.replace(/\n/g, '\n    ');

  return output;
};


/**
 * Map fn() n times
 */
module.exports.map_n = function(fn, n) {
  const results = [];

  for (let i = 0; i < n; i++) {
    results.push(fn());
  }

  return results;
};


/**
 * Call fn after n calls
 */
module.exports.after_n = function(fn, n) {
  let count = n;

  return (...args) => {
    count--;
    if (count <= 0) return fn(...args);
  };
};


/**
 * Deep equality check
 */
module.exports.equals = function equals(a, b) {
  if (a === b) return true;
  if (typeof a !== 'undefined' && typeof b === 'undefined') return false;
  if (typeof a === 'undefined' && typeof b !== 'undefined') return false;

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (!equals(a[i], b[i])) return false;
    }

    return true;
  }

  if (a instanceof Object && b instanceof Object) {
    const a_keys = Object.keys(a);
    const b_keys = Object.keys(b);

    if (a_keys.length !== b_keys.length) {
      return false;
    }

    return a_keys.every(key => equals(a[key], b[key]));
  }

  return false;
};
