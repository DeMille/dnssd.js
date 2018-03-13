'use strict';

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _set = require('babel-runtime/core-js/set');

var _set2 = _interopRequireDefault(_set);

var _isInteger = require('babel-runtime/core-js/number/is-integer');

var _isInteger2 = _interopRequireDefault(_isInteger);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _isFinite = require('babel-runtime/core-js/number/is-finite');

var _isFinite2 = _interopRequireDefault(_isFinite);

var _isNan = require('babel-runtime/core-js/number/is-nan');

var _isNan2 = _interopRequireDefault(_isNan);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var ValidationError = require('./customError').create('ValidationError');

function isNumeric(value) {
  return !(0, _isNan2.default)(parseFloat(value)) && (0, _isFinite2.default)(value);
}

/**
 * Exported
 */
var validate = module.exports = {};

/**
 * Validates a transport protocol, throws err on invalid input
 * @param {string} str
 */
validate.protocol = function protocol(str) {
  if (typeof str !== 'string') {
    throw new ValidationError('Protocol must be a string, got %s', typeof str === 'undefined' ? 'undefined' : (0, _typeof3.default)(str));
  }

  if (str === '' || str !== '_tcp' && str !== '_udp') {
    throw new ValidationError("Protocol must be _tcp or _udp, got '%s'", str);
  }
};

/**
 * Validates a service name, throws err on invalid input
 * @param {string} str
 */
validate.serviceName = function serviceName(str) {
  if (typeof str !== 'string') {
    throw new ValidationError('Service name must be a string, got %s', typeof str === 'undefined' ? 'undefined' : (0, _typeof3.default)(str));
  }

  if (!str) {
    throw new ValidationError("Service name can't be an empty string");
  }

  if (!/^_/.test(str)) {
    throw new ValidationError("Service '%s' must start with '_'", str);
  }

  // 15 bytes not including the leading underscore
  if (Buffer.byteLength(str) > 16) {
    throw new ValidationError("Service '%s' is > 15 bytes", str);
  }

  if (!/^_[A-Za-z0-9]/.test(str) || !/[A-Za-z0-9]*$/.test(str)) {
    throw new ValidationError("Service '%s' must start and end with a letter or digit", str);
  }

  if (!/^_[A-Za-z0-9-]+$/.test(str)) {
    throw new ValidationError("Service '%s' should be only letters, digits, and hyphens", str);
  }

  if (/--/.test(str)) {
    throw new ValidationError("Service '%s' must not have consecutive hyphens", str);
  }

  if (!/[A-Za-z]/.test(str)) {
    throw new ValidationError("Service '%s' must have at least 1 letter", str);
  }
};

/**
 * Validates a dns label, throws err on invalid input
 *
 * @param {string} str - label to validate
 * @param {string} [name] - name of the label (for better error messages)
 */
validate.label = function label(str) {
  var name = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'label';

  if (typeof str !== 'string') {
    throw new ValidationError('%s name must be a string, got %s', name, typeof str === 'undefined' ? 'undefined' : (0, _typeof3.default)(str));
  }

  if (!str) {
    throw new ValidationError("%s name can't be an empty string", name);
  }

  if (/[\x00-\x1F]|\x7F/.test(str)) {
    throw new ValidationError("%s name '%s' can't contain control chars", name, str);
  }

  if (Buffer.byteLength(str) > 63) {
    throw new ValidationError('%s must be <= 63 bytes. %s is %d', name, str, Buffer.byteLength(str));
  }
};

/**
 * Validates a port, throws err on invalid input
 *
 * @param {integer} num
 */
validate.port = function port(num) {
  if (!(0, _isInteger2.default)(num) || num <= 0 || num > 0xFFFF) {
    throw new ValidationError('Port must be an integer between 0 and 65535, got %s', num);
  }
};

/**
 * Validates rdata for a TXT record, throws err on invalid input
 *
 * Example of a valid txt object:
 * {
 *   key: 'value',
 *   buf: Buffer.alloc(123)
 * }
 *
 * @param {object} obj
 */
validate.txt = function txt(obj) {
  var sizeTotal = 0;
  var keys = new _set2.default();

  if ((typeof obj === 'undefined' ? 'undefined' : (0, _typeof3.default)(obj)) !== 'object') {
    throw new ValidationError('TXT must be an object');
  }

  // validate each key value pair
  (0, _keys2.default)(obj).forEach(function (key) {
    var value = obj[key];
    var size = Buffer.byteLength(key);

    // keys
    if (Buffer.byteLength(key) > 9) {
      throw new ValidationError("Key '%s' in TXT is > 9 chars", key);
    }

    if (!!~key.indexOf('=')) {
      throw new ValidationError("Key '%s' in TXT contains a '='", key);
    }

    if (!/^[ -~]*$/.test(key)) {
      throw new ValidationError("Key '%s' in TXT is not printable ascii", key);
    }

    if (keys.has(key.toLowerCase())) {
      throw new ValidationError("Key '%s' in TXT occurs more than once. (case insensitive)", key);
    }

    keys.add(key.toLowerCase());

    // value type
    if (typeof value !== 'string' && typeof value !== 'boolean' && !isNumeric(value) && !Buffer.isBuffer(value)) {
      throw new ValidationError('TXT values must be a string, buffer, number, or boolean. got %s', typeof value === 'undefined' ? 'undefined' : (0, _typeof3.default)(value));
    }

    // size limits
    if (typeof value !== 'boolean') {
      size += Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value.toString());

      // add 1 for the '=' in 'key=value'
      // add 1 for the length byte to be written before 'key=value'
      size += 2;
    }

    sizeTotal += size;

    if (size > 255) {
      throw new ValidationError('Each key/value in TXT must be < 255 bytes');
    }

    if (sizeTotal > 1300) {
      throw new ValidationError('TXT record is > 1300 bytes.');
    }
  });
};