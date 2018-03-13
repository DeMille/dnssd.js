'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var Query = require('./Query');
var ServiceResolver = require('./ServiceResolver');
var DisposableInterface = require('./DisposableInterface');

var EventEmitter = require('./EventEmitter');
var ValidationError = require('./customError').create('ValidationError');

var filename = require('path').basename(__filename);
var debug = require('./debug')('dnssd:' + filename);

var RType = require('./constants').RType;

function runQuery(name, qtype) {
  var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

  debug('Resolving ' + name + ', type: ' + qtype);

  var timeout = options.timeout || 2000;
  var question = { name: name, qtype: qtype };

  var intf = DisposableInterface.create(options.interface);
  var killswitch = new EventEmitter();

  return new Promise(function (resolve, reject) {
    function stop() {
      killswitch.emit('stop');
      intf.stop();
    }

    function sendQuery() {
      new Query(intf, killswitch).continuous(false).setTimeout(timeout).add(question).once('answer', function (answer, related) {
        stop();
        resolve({ answer: answer, related: related });
      }).once('timeout', function () {
        stop();
        reject(new Error('Resolve query timed out'));
      }).start();
    }

    intf.bind().then(sendQuery).catch(reject);
  });
}

function resolveAny(name, type) {
  var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

  var qtype = void 0;

  if (typeof name !== 'string') {
    throw new ValidationError('Name must be a string, got %s', typeof name === 'undefined' ? 'undefined' : _typeof(name));
  }

  if (!name.length) {
    throw new ValidationError("Name can't be empty");
  }

  if (typeof type === 'string') qtype = RType[type.toUpperCase()];
  if (Number.isInteger(type)) qtype = type;

  if (!qtype || qtype <= 0 || qtype > 0xFFFF) {
    throw new ValidationError('Unknown query type, got "%s"', type);
  }

  if ((typeof options === 'undefined' ? 'undefined' : _typeof(options)) !== 'object') {
    throw new ValidationError('Options must be an object, got %s', typeof options === 'undefined' ? 'undefined' : _typeof(options));
  }

  if (options.interface && !DisposableInterface.isValidName(options.interface)) {
    throw new ValidationError('Interface "' + options.interface + '" doesn\'t exist');
  }

  if (name.substr(-1) !== '.') name += '.'; // make sure root label exists

  return runQuery(name, qtype, options);
}

function resolve4(name, opts) {
  return resolveAny(name, 'A', opts).then(function (result) {
    return result.answer.address;
  });
}

function resolve6(name, opts) {
  return resolveAny(name, 'AAAA', opts).then(function (result) {
    return result.answer.address;
  });
}

function resolveSRV(name, opts) {
  return resolveAny(name, 'SRV', opts).then(function (result) {
    return { target: result.answer.target, port: result.answer.port };
  });
}

function resolveTXT(name, opts) {
  return resolveAny(name, 'TXT', opts).then(function (result) {
    return { txt: result.answer.txt, txtRaw: result.answer.txtRaw };
  });
}

function resolveService(name) {
  var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

  debug('Resolving service: ' + name);

  var timeout = options.timeout || 2000;

  if (typeof name !== 'string') {
    throw new ValidationError('Name must be a string, got %s', typeof name === 'undefined' ? 'undefined' : _typeof(name));
  }

  if (!name.length) {
    throw new ValidationError("Name can't be empty");
  }

  if ((typeof options === 'undefined' ? 'undefined' : _typeof(options)) !== 'object') {
    throw new ValidationError('Options must be an object, got %s', typeof options === 'undefined' ? 'undefined' : _typeof(options));
  }

  if (options.interface && !DisposableInterface.isValidName(options.interface)) {
    throw new ValidationError('Interface "' + options.interface + '" doesn\'t exist');
  }

  if (name.substr(-1) !== '.') name += '.'; // make sure root label exists

  var intf = DisposableInterface.create(options.interface);
  var resolver = new ServiceResolver(name, intf);

  function stop() {
    resolver.stop();
    intf.stop();
  }

  function startResolver() {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('Resolve service timed out'));
        stop();
      }, timeout);

      resolver.once('resolved', function () {
        resolve(resolver.service());
        stop();
        clearTimeout(timer);
      });

      resolver.start();
    });
  }

  return intf.bind().then(startResolver);
}

module.exports = {
  resolve: resolveAny,
  resolve4: resolve4,
  resolve6: resolve6,
  resolveSRV: resolveSRV,
  resolveTXT: resolveTXT,
  resolveService: resolveService
};