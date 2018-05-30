let os = require('os');

const misc = require('./misc');
const validate = require('./validate');
const ServiceType = require('./ServiceType');
const EventEmitter = require('./EventEmitter');
const ResourceRecord = require('./ResourceRecord');
const QueryRecord = require('./QueryRecord');
const Packet = require('./Packet');
const sleep = require('./sleep');

let Responder = require('./Responder');
let NetworkInterface = require('./NetworkInterface');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const RType = require('./constants').RType;
const STATE = {STOPPED: 'stopped', STARTED: 'started'};


/**
 * Creates a new Advertisement
 *
 * @emits 'error'
 * @emits 'stopped' when the advertisement is stopped
 * @emits 'instanceRenamed' when the service instance is renamed
 * @emits 'hostRenamed' when the hostname has to be renamed
 *
 * @param {ServiceType|Object|String|Array} type - type of service to advertise
 * @param {Number}                          port - port to advertise
 *
 * @param {Object}   [options]
 * @param {Object}   options.name       - instance name
 * @param {Object}   options.host       - hostname to use
 * @param {Object}   options.txt        - TXT record
 * @param {Object}   options.subtypes   - subtypes to register
 * @param {Object}   options.interface  - interface name or address to use
 */
function Advertisement(type, port, options = {}) {
  if (!(this instanceof Advertisement)) {
    return new Advertisement(type, port, options);
  }

  EventEmitter.call(this);

  // convert argument ServiceType to validate it (might throw)
  const serviceType = (!(type instanceof ServiceType))
    ? new ServiceType(type)
    : type;

  // validate other inputs (throws on invalid)
  validate.port(port);

  if (options.txt)  validate.txt(options.txt);
  if (options.name) validate.label(options.name, 'Instance');
  if (options.host) validate.label(options.host, 'Hostname');

  this.serviceName  = serviceType.name;
  this.protocol     = serviceType.protocol;
  this.subtypes     = (options.subtypes) ? options.subtypes : serviceType.subtypes;
  this.port         = port;
  this.instanceName = options.name || misc.hostname();
  this.hostname     = options.host || misc.hostname();
  this.txt          = options.txt  || {};

  // Domain notes:
  // 1- link-local only, so this is the only possible value
  // 2- "_domain" used instead of "domain" because "domain" is an instance var
  //    in older versions of EventEmitter. Using "domain" messes up `this.emit()`
  this._domain = 'local';

  this._id = misc.fqdn(this.instanceName, this.serviceName, this.protocol, 'local');
  debug(`Creating new advertisement for "${this._id}" on ${port}`);

  this.state              = STATE.STOPPED;
  this._interface         = NetworkInterface.get(options.interface);
  this._defaultAddresses  = null;
  this._hostnameResponder = null;
  this._serviceResponder  = null;
}

Advertisement.prototype = Object.create(EventEmitter.prototype);
Advertisement.prototype.constructor = Advertisement;


/**
 * Starts advertisement
 *
 * In order:
 *   - bind interface to multicast port
 *   - make records and advertise this.hostname
 *   - make records and advertise service
 *
 * If the given hostname is already taken by someone else (not including
 * bonjour/avahi on the same machine), the hostname is automatically renamed
 * following the pattern:
 * Name -> Name (2)
 *
 * Services aren't advertised until the hostname has been properly advertised
 * because a service needs a host. Service instance names (this.instanceName)
 * have to be unique and get renamed automatically the same way.
 *
 * @return {this}
 */
Advertisement.prototype.start = function() {
  if (this.state === STATE.STARTED) {
    debug('Advertisement already started!');
    return this;
  }

  debug(`Starting advertisement "${this._id}"`);
  this.state = STATE.STARTED;

  // restart probing process when waking from sleep
  sleep.using(this).on('wake', this._restart);

  // treat interface errors as fatal
  this._interface.using(this).once('error', this._onError);

  this._interface.bind()
    .then(() => this._getDefaultID())
    .then(() => this._advertiseHostname())
    .then(() => this._advertiseService())
    .catch(err => this._onError(err));

  return this;
};


/**
 * Stops advertisement
 *
 * Advertisement can do either a clean stop or a forced stop. A clean stop will
 * send goodbye records out so others will know the service is going down. This
 * takes ~1s. Forced goodbyes shut everything down immediately w/o goodbyes.
 *
 * `this._shutdown()` will deregister the advertisement. If the advertisement was
 * the only thing using the interface it will shut down too.
 *
 * @emits 'stopped'
 *
 * @param {Boolean} [forceImmediate]
 */
Advertisement.prototype.stop = function(forceImmediate, callback) {
  debug(`Stopping advertisement "${this._id}"...`);
  this.state = STATE.STOPPED;

  const shutdown = () => {
    this._hostnameResponder = null;
    this._serviceResponder = null;

    this._interface.removeListenersCreatedBy(this);
    this._interface.stopUsing();
    sleep.removeListenersCreatedBy(this);

    debug('Stopped.');

    callback && callback();
    this.emit('stopped');
  };

  // If doing a clean stop, responders need to send goodbyes before turning off
  // the interface. Depending on when the advertisment was stopped, it could
  // have one, two, or no active responders that need to send goodbyes
  let numResponders = 0;
  if (this._serviceResponder)  numResponders++;
  if (this._hostnameResponder) numResponders++;

  const done = misc.after_n(shutdown, numResponders);

  // immediate shutdown (forced or if there aren't any active responders)
  // or wait for goodbyes on a clean shutdown
  if (forceImmediate || !numResponders) {
    this._serviceResponder  && this._serviceResponder.stop();
    this._hostnameResponder && this._hostnameResponder.stop();
    shutdown();
  } else {
    this._serviceResponder  && this._serviceResponder.goodbye(done);
    this._hostnameResponder && this._hostnameResponder.goodbye(done);
  }
};


/**
 * Updates the adverts TXT record
 * @param {object} txtObj
 */
Advertisement.prototype.updateTXT = function(txtObj) {
  // validates txt first, will throw validation errors on bad input
  validate.txt(txtObj);

  // make sure responder handles network requests in event loop before updating
  // (otherwise could have unintended record conflicts)
  setImmediate(() => {
    this._serviceResponder.updateEach(RType.TXT, (record) => {
      record.txtRaw = misc.makeRawTXT(txtObj);
      record.txt = misc.makeReadableTXT(txtObj);
    });
  });
};


/**
 * Error handler. Does immediate shutdown
 * @emits 'error'
 */
Advertisement.prototype._onError = function(err) {
  debug(`Error on "${this._id}", shutting down. Got: \n${err}`);

  this.stop(true); // stop immediately
  this.emit('error', err);
};


Advertisement.prototype._restart = function() {
  if (this.state !== STATE.STARTED) return debug('Not yet started, skipping');
  debug(`Waking from sleep, restarting "${this._id}"`);

  // stop responders if they exist
  this._serviceResponder  && this._serviceResponder.stop();
  this._hostnameResponder && this._hostnameResponder.stop();

  this._hostnameResponder = null;
  this._serviceResponder = null;

  // need to check if active interface has changed
  this._getDefaultID()
    .then(() => this._advertiseHostname())
    .then(() => this._advertiseService())
    .catch(err => this._onError(err));
};


Advertisement.prototype._getDefaultID = function() {
  debug(`Trying to find the default route (${this._id})`);

  return new Promise((resolve, reject) => {
    const self = this;

    const question = new QueryRecord({name: misc.fqdn(this.hostname, this._domain)});
    const queryPacket = new Packet();
    queryPacket.setQuestions([question]);

    // try to listen for our own query
    this._interface.on('query', function handler(packet) {
      if (packet.isLocal() && packet.equals(queryPacket)) {
        self._defaultAddresses = Object.values(os.networkInterfaces()).find(intf =>
          intf.some(({ address }) => address === packet.origin.address));

        if (self._defaultAddresses) {
          self._interface.off('query', handler);
          resolve();
        }
      }
    });

    this._interface.send(queryPacket);
    setTimeout(() => reject(new Error('Timed out getting default route')), 500);
  });
};


/**
 * Advertise the same hostname
 *
 * A new responder is created for this task. A responder is a state machine
 * that will talk to the network to do advertising. Its responsible for a
 * single record set from `_makeAddressRecords` and automatically renames
 * them if conflicts are found.
 *
 * Returns a promise that resolves when a hostname has been authoritatively
 * advertised. Rejects on fatal errors only.
 *
 * @return {Promise}
 */
Advertisement.prototype._advertiseHostname = function() {
  const interfaces = Object.values(os.networkInterfaces());

  const records = this._makeAddressRecords(this._defaultAddresses);
  const bridgeable = [].concat(...interfaces.map(i => this._makeAddressRecords(i)));

  return new Promise((resolve, reject) => {
    const responder = new Responder(this._interface, records, bridgeable);
    this._hostnameResponder = responder;

    responder.on('rename', this._onHostRename.bind(this));
    responder.once('probingComplete', resolve);
    responder.once('error', reject);

    responder.start();
  });
};


/**
 * Handles rename events from the interface hostname responder.
 *
 * If a conflict was been found with a proposed hostname, the responder will
 * rename and probe again. This event fires *after* the rename but *before*
 * probing, so the name here isn't guaranteed yet.
 *
 * The hostname responder will update its A/AAAA record set with the new name
 * when it does the renaming. The service responder will need to update the
 * hostname in its SRV record.
 *
 * @emits 'hostRenamed'
 *
 * @param {String} hostname - the new current hostname
 */
Advertisement.prototype._onHostRename = function(hostname) {
  debug(`Hostname renamed to "${hostname}" on interface records`);

  const target = misc.fqdn(hostname, this._domain);
  this.hostname = hostname;

  if (this._serviceResponder) {
    this._serviceResponder.updateEach(RType.SRV, (record) => {
      record.target = target;
    });
  }

  this.emit('hostRenamed', target);
};


/**
 * Advertises the service
 *
 * A new responder is created for this task also. The responder will manage
 * the record set from `_makeServiceRecords` and automatically rename them
 * if conflicts are found.
 *
 * The responder will keeps advertising/responding until `advertisement.stop()`
 * tells it to stop.
 *
 * @emits 'instanceRenamed' when the service instance is renamed
 */
Advertisement.prototype._advertiseService = function() {
  const records = this._makeServiceRecords();

  const responder = new Responder(this._interface, records);
  this._serviceResponder = responder;

  responder.on('rename', (instance) => {
    debug(`Service instance had to be renamed to "${instance}"`);
    this._id = misc.fqdn(instance, this.serviceName, this.protocol, 'local');
    this.instanceName = instance;
    this.emit('instanceRenamed', instance);
  });

  responder.once('probingComplete', () => {
    debug(`Probed successfully, "${this._id}" now active`);
    this.emit('active');
  });

  responder.once('error', this._onError.bind(this));
  responder.start();
};


/**
 * Make the A/AAAA records that will be used on an interface.
 *
 * Each interface will have its own A/AAAA records generated because the
 * IPv4/IPv6 addresses will be different on each interface.
 *
 * NSEC records are created to show which records are available with this name.
 * This lets others know if an AAAA doesn't exist, for example.
 * (See 8.2.4 Negative Responses or whatever)
 *
 * @param  {NetworkInterface} intf
 * @return {ResourceRecords[]}
 */
Advertisement.prototype._makeAddressRecords = function(addresses) {
  const name = misc.fqdn(this.hostname, this._domain);

  const As = addresses
    .filter(({ family }) => family === 'IPv4')
    .map(({ address }) => new ResourceRecord.A({ name, address }));

  const AAAAs = addresses
    .filter(({ family }) => family === 'IPv6')
    .filter(({ address }) => address.substr(0, 6).toLowerCase() === 'fe80::')
    .map(({ address }) => new ResourceRecord.AAAA({ name, address }));

  const types = [];
  if (As.length) types.push(RType.A);
  if (AAAAs.length) types.push(RType.AAAA);

  const NSEC = new ResourceRecord.NSEC({
    name    : name,
    ttl     : 120,
    existing: types,
  });

  As.forEach((A) => {
    A.additionals = (AAAAs.length) ? [...AAAAs, NSEC] : [NSEC];
  });

  AAAAs.forEach((AAAA) => {
    AAAA.additionals = (As.length) ? [...As, NSEC] : [NSEC];
  });

  return [...As, ...AAAAs, NSEC];
};


/**
 * Make the SRV/TXT/PTR records that will be used on an interface.
 *
 * Each interface will have its own SRV/TXT/PTR records generated because
 * these records are dependent on the A/AAAA hostname records, which are
 * different for each hostname.
 *
 * NSEC records are created to show which records are available with this name.
 *
 * @return {ResourceRecords[]}
 */
Advertisement.prototype._makeServiceRecords = function() {
  const records = [];
  const interfaceRecords = this._hostnameResponder.getRecords();

  // enumerator  : "_services._dns-sd._udp.local."
  // registration: "_http._tcp.local."
  // serviceName : "A web page._http._tcp.local."
  const enumerator   = misc.fqdn('_services._dns-sd._udp', this._domain);
  const registration = misc.fqdn(this.serviceName, this.protocol, this._domain);
  const serviceName  = misc.fqdn(this.instanceName, registration);

  const NSEC = new ResourceRecord.NSEC({
    name    : serviceName,
    existing: [RType.SRV, RType.TXT],
  });

  const SRV = new ResourceRecord.SRV({
    name       : serviceName,
    target     : misc.fqdn(this.hostname, this._domain),
    port       : this.port,
    additionals: [NSEC, ...interfaceRecords],
  });

  const TXT = new ResourceRecord.TXT({
    name       : serviceName,
    additionals: [NSEC],
    txt        : this.txt,
  });

  records.push(SRV);
  records.push(TXT);
  records.push(NSEC);

  records.push(new ResourceRecord.PTR({
    name       : registration,
    PTRDName   : serviceName,
    additionals: [SRV, TXT, NSEC, ...interfaceRecords],
  }));

  records.push(new ResourceRecord.PTR({
    name    : enumerator,
    PTRDName: registration,
  }));

  // ex: "_printer.sub._http._tcp.local."
  this.subtypes.forEach((subType) => {
    records.push(new ResourceRecord.PTR({
      name       : misc.fqdn(subType, '_sub', registration),
      PTRDName   : serviceName,
      additionals: [SRV, TXT, NSEC, ...interfaceRecords],
    }));
  });

  return records;
};


module.exports = Advertisement;
