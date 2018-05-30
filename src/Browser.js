const misc = require('./misc');
const ServiceType = require('./ServiceType');
const EventEmitter = require('./EventEmitter');

let ServiceResolver = require('./ServiceResolver');
let NetworkInterface = require('./NetworkInterface');
let Query = require('./Query');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const RType = require('./constants').RType;
const STATE = {STOPPED: 'stopped', STARTED: 'started'};


/**
 * Creates a new Browser
 *
 * @emits 'serviceUp'
 * @emits 'serviceChanged'
 * @emits 'serviceDown'
 * @emits 'error'
 *
 * @param {ServiceType|Object|String|Array} type - the service to browse
 * @param {Object} [options]
 */
function Browser(type, options = {}) {
  if (!(this instanceof Browser)) return new Browser(type, options);
  EventEmitter.call(this);

  // convert argument ServiceType to validate it (might throw)
  const serviceType = (type instanceof ServiceType) ? type : new ServiceType(type);

  // can't search for multiple subtypes at the same time
  if (serviceType.subtypes.length > 1) {
    throw new Error('Too many subtypes. Can only browse one at a time.');
  }

  this._id = serviceType.toString();
  debug(`Creating new browser for "${this._id}"`);

  this._resolvers    = {}; // active service resolvers (when browsing services)
  this._serviceTypes = {}; // active service types (when browsing service types)
  this._protocol     = serviceType.protocol;
  this._serviceName  = serviceType.name;
  this._subtype      = serviceType.subtypes[0];
  this._isWildcard   = serviceType.isEnumerator;
  this._domain       = options.domain || 'local.';
  this._maintain     = ('maintain' in options) ? options.maintain : true;
  this._resolve      = ('resolve' in options) ? options.resolve : true;
  this._interface    = NetworkInterface.get(options.interface);
  this._state        = STATE.STOPPED;

  // emitter used to stop child queries instead of holding onto a reference
  // for each one
  this._offswitch = new EventEmitter();
}

Browser.prototype = Object.create(EventEmitter.prototype);
Browser.prototype.constructor = Browser;


/**
 * Starts browser
 * @return {this}
 */
Browser.prototype.start = function() {
  if (this._state === STATE.STARTED) {
    debug('Browser already started!');
    return this;
  }

  debug(`Starting browser for "${this._id}"`);
  this._state = STATE.STARTED;

  // listen for fatal errors on interface
  this._interface.using(this).once('error', this._onError);

  this._interface.bind()
    .then(() => this._startQuery())
    .catch(err => this._onError(err));

  return this;
};


/**
 * Stops browser.
 *
 * Browser shutdown has to:
 *   - shut down all child service resolvers (they're no longer needed)
 *   - stop the ongoing browsing queries on all interfaces
 *   - remove all listeners since the browser is down
 *   - deregister from the interfaces so they can shut down if needed
 */
Browser.prototype.stop = function() {
  debug(`Stopping browser for "${this._id}"`);

  this._interface.removeListenersCreatedBy(this);
  this._interface.stopUsing();

  debug('Sending stop signal to active queries');
  this._offswitch.emit('stop');

  // because resolver.stop()'s will trigger serviceDown:
  this.removeAllListeners('serviceDown');
  Object.values(this._resolvers).forEach(resolver => resolver.stop());

  this._state = STATE.STOPPED;
  this._resolvers = {};
  this._serviceTypes = {};
};


/**
 * Get a list of currently available services
 * @return {Objects[]}
 */
Browser.prototype.list = function() {
  // if browsing service types
  if ((this._isWildcard)) {
    return Object.values(this._serviceTypes);
  }

  return Object.values(this._resolvers)
    .filter(resolver => resolver.isResolved())
    .map(resolver => resolver.service());
};


/**
 * Error handler
 * @emits 'error'
 */
Browser.prototype._onError = function(err) {
  debug(`Error on "${this._id}", shutting down. Got: \n${err}`);

  this.stop();
  this.emit('error', err);
};


/**
 * Starts the query for either services (like each available printer)
 * or service types using enumerator (listing all mDNS service on a network).
 * Queries are sent out on each network interface the browser uses.
 */
Browser.prototype._startQuery = function() {
  let name = misc.fqdn(this._serviceName, this._protocol, this._domain);

  if (this._subtype) name = misc.fqdn(this._subtype, '_sub', name);

  const question = { name, qtype: RType.PTR };

  const answerHandler = (this._isWildcard)
    ? this._addServiceType.bind(this)
    : this._addService.bind(this);

  // start sending continuous, ongoing queries for services
  new Query(this._interface, this._offswitch)
    .add(question)
    .on('answer', answerHandler)
    .start();
};


/**
 * Answer handler for service types. Adds type and alerts user.
 *
 * @emits 'serviceUp' with new service types
 * @param {ResourceRecord} answer
 */
Browser.prototype._addServiceType = function(answer) {
  const name = answer.PTRDName;

  if (this._state === STATE.STOPPED) return debug.v('Already stopped, ignoring');
  if (answer.ttl === 0)              return debug.v('TTL=0, ignoring');
  if (this._serviceTypes[name])      return debug.v('Already found, ignoring');

  debug(`Found new service type: "${name}"`);

  let { service, protocol } = misc.parse(name);

  // remove any leading underscores for users
  service = service.replace(/^_/, '');
  protocol = protocol.replace(/^_/, '');

  const serviceType = { name: service, protocol };

  this._serviceTypes[name] = serviceType;
  this.emit('serviceUp', serviceType);
};


/**
 * Answer handler for services.
 *
 * New found services cause a ServiceResolve to be created. The resolver
 * parse the additionals and query out for an records needed to fully
 * describe the service (hostname, IP, port, TXT).
 *
 * @emits 'serviceUp'      when a new service is found
 * @emits 'serviceChanged' when a resolved service changes data (IP, etc.)
 * @emits 'serviceDown'    when a resolved service goes down
 *
 * @param {ResourceRecord}   answer        - the record that has service data
 * @param {ResourceRecord[]} [additionals] - other records that might be related
 */
Browser.prototype._addService = function(answer, additionals) {
  const name = answer.PTRDName;

  if (this._state === STATE.STOPPED) return debug.v('Already stopped, ignoring');
  if (answer.ttl === 0)              return debug.v('TTL=0, ignoring');
  if (this._resolvers[name])         return debug.v('Already found, ignoring');

  debug(`Found new service: "${name}"`);

  if (!this._resolve) {
    this.emit('serviceUp', misc.parse(name).instance);
    return;
  }

  const resolver = new ServiceResolver(name, this._interface);
  this._resolvers[name] = resolver;

  resolver.once('resolved', () => {
    debug('Service up');

    // - stop resolvers that dont need to be maintained
    // - only emit 'serviceDown' events once services that have been resolved
    if (!this._maintain) {
      resolver.stop();
      this._resolvers[name] = null;
    } else {
      resolver.once('down', () => this.emit('serviceDown', resolver.service()));
    }

    this.emit('serviceUp', resolver.service());
  });

  resolver.on('updated', () => {
    debug('Service updated');
    this.emit('serviceChanged', resolver.service());
  });

  resolver.once('down', () => {
    debug('Service down');
    delete this._resolvers[name];
  });

  resolver.start(additionals);
};


module.exports = Browser;
