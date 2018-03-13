'use strict';

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Deterministic JSON.stringify for resource record stuff
 *
 * Object keys are sorted so strings are always the same independent of
 * what order properties were added in. Strings are lowercased because
 * record names, TXT keys, SRV target names, etc. need to be compared
 * case-insensitively.
 *
 * @param  {*} val
 * @return {string}
 */
function stringify(val) {
  if (typeof val === 'string') return (0, _stringify2.default)(val.toLowerCase());

  if (Array.isArray(val)) return '[' + val.map(stringify) + ']';

  if ((typeof val === 'undefined' ? 'undefined' : (0, _typeof3.default)(val)) === 'object' && '' + val === '[object Object]') {
    var str = (0, _keys2.default)(val).sort().map(function (key) {
      return stringify(key) + ':' + stringify(val[key]);
    }).join(',');

    return '{' + str + '}';
  }

  return (0, _stringify2.default)(val);
}

/**
 * djb2 string hashing function
 *
 * @param  {string} str
 * @return {string} - 32b unsigned hex
 */
function djb2(str) {
  var hash = 5381;
  var i = str.length;

  // hash stays signed 32b with XOR operator
  while (i) {
    hash = hash * 33 ^ str.charCodeAt(--i);
  } // coerce to unsigned to get strings without -'s
  return (hash >>> 0).toString(16);
}

/**
 * Takes any number of parameters and makes a string hash of them.
 * @return {...*} arguments
 */
module.exports = function hash() {
  for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  return djb2(stringify(args));
};