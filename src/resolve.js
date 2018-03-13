let Query = require('./Query');
let ServiceResolver = require('./ServiceResolver');
let DisposableInterface = require('./DisposableInterface');

const EventEmitter = require('./EventEmitter');
const ValidationError = require('./customError').create('ValidationError');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const RType = require('./constants').RType;


function runQuery(name, qtype, options = {}) {
  debug(`Resolving ${name}, type: ${qtype}`);

  const timeout  = options.timeout || 2000;
  const question = { name, qtype };

  const intf = DisposableInterface.create(options.interface);
  const killswitch = new EventEmitter();

  return new Promise((resolve, reject) => {
    function stop() {
      killswitch.emit('stop');
      intf.stop();
    }

    function sendQuery() {
      new Query(intf, killswitch)
        .continuous(false)
        .setTimeout(timeout)
        .add(question)
        .once('answer', (answer, related) => {
          stop();
          resolve({answer, related});
        })
        .once('timeout', () => {
          stop();
          reject(new Error('Resolve query timed out'));
        })
        .start();
    }

    intf.bind()
      .then(sendQuery)
      .catch(reject);
  });
}


function resolveAny(name, type, options = {}) {
  let qtype;

  if (typeof name !== 'string') {
    throw new ValidationError('Name must be a string, got %s', typeof name);
  }

  if (!name.length) {
    throw new ValidationError("Name can't be empty");
  }

  if (typeof type === 'string')  qtype = RType[type.toUpperCase()];
  if (Number.isInteger(type)) qtype = type;

  if (!qtype || qtype <= 0 || qtype > 0xFFFF) {
    throw new ValidationError('Unknown query type, got "%s"', type);
  }

  if (typeof options !== 'object') {
    throw new ValidationError('Options must be an object, got %s', typeof options);
  }

  if (options.interface && !DisposableInterface.isValidName(options.interface)) {
    throw new ValidationError(`Interface "${options.interface}" doesn't exist`);
  }

  if (name.substr(-1) !== '.') name += '.'; // make sure root label exists

  return runQuery(name, qtype, options);
}


function resolve4(name, opts) {
  return resolveAny(name, 'A', opts)
    .then(result => result.answer.address);
}

function resolve6(name, opts) {
  return resolveAny(name, 'AAAA', opts)
    .then(result => result.answer.address);
}

function resolveSRV(name, opts) {
  return resolveAny(name, 'SRV', opts)
    .then(result => ({ target: result.answer.target, port: result.answer.port }));
}

function resolveTXT(name, opts) {
  return resolveAny(name, 'TXT', opts)
    .then(result => ({ txt: result.answer.txt, txtRaw: result.answer.txtRaw }));
}


function resolveService(name, options = {}) {
  debug(`Resolving service: ${name}`);

  const timeout = options.timeout || 2000;

  if (typeof name !== 'string') {
    throw new ValidationError('Name must be a string, got %s', typeof name);
  }

  if (!name.length) {
    throw new ValidationError("Name can't be empty");
  }

  if (typeof options !== 'object') {
    throw new ValidationError('Options must be an object, got %s', typeof options);
  }

  if (options.interface && !DisposableInterface.isValidName(options.interface)) {
    throw new ValidationError(`Interface "${options.interface}" doesn't exist`);
  }

  if (name.substr(-1) !== '.') name += '.'; // make sure root label exists

  const intf = DisposableInterface.create(options.interface);
  const resolver = new ServiceResolver(name, intf);

  function stop() {
    resolver.stop();
    intf.stop();
  }

  function startResolver() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Resolve service timed out'));
        stop();
      }, timeout);

      resolver.once('resolved', () => {
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
  resolve4,
  resolve6,
  resolveSRV,
  resolveTXT,
  resolveService,
};
