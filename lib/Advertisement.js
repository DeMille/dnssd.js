'use strict';

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

var os = require('os');

var misc = require('./misc');
var validate = require('./validate');
var ServiceType = require('./ServiceType');
var EventEmitter = require('./EventEmitter');
var ResourceRecord = require('./ResourceRecord');
var QueryRecord = require('./QueryRecord');
var Packet = require('./Packet');
var sleep = require('./sleep');

var Responder = require('./Responder');
var NetworkInterface = require('./NetworkInterface');

var filename = require('path').basename(__filename);
var debug = require('./debug')('dnssd:' + filename);

var RType = require('./constants').RType;
var STATE = { STOPPED: 'stopped', STARTED: 'started' };

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
function Advertisement(type, port) {
  var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

  if (!(this instanceof Advertisement)) {
    return new Advertisement(type, port, options);
  }

  EventEmitter.call(this);

  // convert argument ServiceType to validate it (might throw)
  var serviceType = !(type instanceof ServiceType) ? new ServiceType(type) : type;

  // validate other inputs (throws on invalid)
  validate.port(port);

  if (options.txt) validate.txt(options.txt);
  if (options.name) validate.label(options.name, 'Instance');
  if (options.host) validate.label(options.host, 'Hostname');

  this.serviceName = serviceType.name;
  this.protocol = serviceType.protocol;
  this.subtypes = options.subtypes ? options.subtypes : serviceType.subtypes;
  this.port = port;
  this.instanceName = options.name || misc.hostname();
  this.hostname = options.host || misc.hostname();
  this.txt = options.txt || {};

  // Domain notes:
  // 1- link-local only, so this is the only possible value
  // 2- "_domain" used instead of "domain" because "domain" is an instance var
  //    in older versions of EventEmitter. Using "domain" messes up `this.emit()`
  this._domain = 'local';

  this._id = misc.fqdn(this.instanceName, this.serviceName, this.protocol, 'local');
  debug('Creating new advertisement for "' + this._id + '" on ' + port);

  this.state = STATE.STOPPED;
  this._interface = NetworkInterface.get(options.interface);
  this._defaultAddresses = null;
  this._hostnameResponder = null;
  this._serviceResponder = null;
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
Advertisement.prototype.start = function () {
  var _this = this;

  if (this.state === STATE.STARTED) {
    debug('Advertisement already started!');
    return this;
  }

  debug('Starting advertisement "' + this._id + '"');
  this.state = STATE.STARTED;

  // restart probing process when waking from sleep
  sleep.using(this).on('wake', this._restart);

  // treat interface errors as fatal
  this._interface.using(this).once('error', this._onError);

  this._interface.bind().then(function () {
    return _this._getDefaultID();
  }).then(function () {
    return _this._advertiseHostname();
  }).then(function () {
    return _this._advertiseService();
  }).catch(function (err) {
    return _this._onError(err);
  });

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
Advertisement.prototype.stop = function (forceImmediate, callback) {
  var _this2 = this;

  debug('Stopping advertisement "' + this._id + '"...');
  this.state = STATE.STOPPED;

  var shutdown = function shutdown() {
    _this2._hostnameResponder = null;
    _this2._serviceResponder = null;

    _this2._interface.removeListenersCreatedBy(_this2);
    _this2._interface.stopUsing();
    sleep.removeListenersCreatedBy(_this2);

    debug('Stopped.');

    callback && callback();
    _this2.emit('stopped');
  };

  // If doing a clean stop, responders need to send goodbyes before turning off
  // the interface. Depending on when the advertisment was stopped, it could
  // have one, two, or no active responders that need to send goodbyes
  var numResponders = 0;
  if (this._serviceResponder) numResponders++;
  if (this._hostnameResponder) numResponders++;

  var done = misc.after_n(shutdown, numResponders);

  // immediate shutdown (forced or if there aren't any active responders)
  // or wait for goodbyes on a clean shutdown
  if (forceImmediate || !numResponders) {
    this._serviceResponder && this._serviceResponder.stop();
    this._hostnameResponder && this._hostnameResponder.stop();
    shutdown();
  } else {
    this._serviceResponder && this._serviceResponder.goodbye(done);
    this._hostnameResponder && this._hostnameResponder.goodbye(done);
  }
};

/**
 * Updates the adverts TXT record
 * @param {object} txtObj
 */
Advertisement.prototype.updateTXT = function (txtObj) {
  var _this3 = this;

  // validates txt first, will throw validation errors on bad input
  validate.txt(txtObj);

  // make sure responder handles network requests in event loop before updating
  // (otherwise could have unintended record conflicts)
  setImmediate(function () {
    _this3._serviceResponder.updateEach(RType.TXT, function (record) {
      record.txtRaw = misc.makeRawTXT(txtObj);
      record.txt = misc.makeReadableTXT(txtObj);
    });
  });
};

/**
 * Error handler. Does immediate shutdown
 * @emits 'error'
 */
Advertisement.prototype._onError = function (err) {
  debug('Error on "' + this._id + '", shutting down. Got: \n' + err);

  this.stop(true); // stop immediately
  this.emit('error', err);
};

Advertisement.prototype._restart = function () {
  var _this4 = this;

  if (this.state !== STATE.STARTED) return debug('Not yet started, skipping');
  debug('Waking from sleep, restarting "' + this._id + '"');

  // stop responders if they exist
  this._serviceResponder && this._serviceResponder.stop();
  this._hostnameResponder && this._hostnameResponder.stop();

  this._hostnameResponder = null;
  this._serviceResponder = null;

  // need to check if active interface has changed
  this._getDefaultID().then(function () {
    return _this4._advertiseHostname();
  }).then(function () {
    return _this4._advertiseService();
  }).catch(function (err) {
    return _this4._onError(err);
  });
};

Advertisement.prototype._getDefaultID = function () {
  var _this5 = this;

  debug('Trying to find the default route (' + this._id + ')');

  return new Promise(function (resolve, reject) {
    var self = _this5;

    var question = new QueryRecord({ name: misc.fqdn(_this5.hostname, _this5._domain) });
    var queryPacket = new Packet();
    queryPacket.setQuestions([question]);

    // try to listen for our own query
    _this5._interface.on('query', function handler(packet) {
      if (packet.isLocal() && packet.equals(queryPacket)) {
        self._defaultAddresses = Object.values(os.networkInterfaces()).find(function (intf) {
          return intf.some(function (_ref) {
            var address = _ref.address;
            return address === packet.origin.address;
          });
        });

        if (self._defaultAddresses) {
          self._interface.off('query', handler);
          resolve();
        }
      }
    });

    _this5._interface.send(queryPacket);
    setTimeout(function () {
      return reject(new Error('Timed out getting default route'));
    }, 500);
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
Advertisement.prototype._advertiseHostname = function () {
  var _ref2,
      _this6 = this;

  var interfaces = Object.values(os.networkInterfaces());

  var records = this._makeAddressRecords(this._defaultAddresses);
  var bridgeable = (_ref2 = []).concat.apply(_ref2, _toConsumableArray(interfaces.map(function (i) {
    return _this6._makeAddressRecords(i);
  })));

  return new Promise(function (resolve, reject) {
    var responder = new Responder(_this6._interface, records, bridgeable);
    _this6._hostnameResponder = responder;

    responder.on('rename', _this6._onHostRename.bind(_this6));
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
Advertisement.prototype._onHostRename = function (hostname) {
  debug('Hostname renamed to "' + hostname + '" on interface records');

  var target = misc.fqdn(hostname, this._domain);
  this.hostname = hostname;

  if (this._serviceResponder) {
    this._serviceResponder.updateEach(RType.SRV, function (record) {
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
Advertisement.prototype._advertiseService = function () {
  var _this7 = this;

  var records = this._makeServiceRecords();

  var responder = new Responder(this._interface, records);
  this._serviceResponder = responder;

  responder.on('rename', function (instance) {
    debug('Service instance had to be renamed to "' + instance + '"');
    _this7._id = misc.fqdn(instance, _this7.serviceName, _this7.protocol, 'local');
    _this7.instanceName = instance;
    _this7.emit('instanceRenamed', instance);
  });

  responder.once('probingComplete', function () {
    debug('Probed successfully, "' + _this7._id + '" now active');
    _this7.emit('active');
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
Advertisement.prototype._makeAddressRecords = function (addresses) {
  var name = misc.fqdn(this.hostname, this._domain);

  var As = addresses.filter(function (_ref3) {
    var family = _ref3.family;
    return family === 'IPv4';
  }).map(function (_ref4) {
    var address = _ref4.address;
    return new ResourceRecord.A({ name: name, address: address });
  });

  var AAAAs = addresses.filter(function (_ref5) {
    var family = _ref5.family;
    return family === 'IPv6';
  }).filter(function (_ref6) {
    var address = _ref6.address;
    return address.substr(0, 6).toLowerCase() === 'fe80::';
  }).map(function (_ref7) {
    var address = _ref7.address;
    return new ResourceRecord.AAAA({ name: name, address: address });
  });

  var types = [];
  if (As.length) types.push(RType.A);
  if (AAAAs.length) types.push(RType.AAAA);

  var NSEC = new ResourceRecord.NSEC({
    name: name,
    ttl: 120,
    existing: types
  });

  As.forEach(function (A) {
    A.additionals = AAAAs.length ? [].concat(_toConsumableArray(AAAAs), [NSEC]) : [NSEC];
  });

  AAAAs.forEach(function (AAAA) {
    AAAA.additionals = As.length ? [].concat(_toConsumableArray(As), [NSEC]) : [NSEC];
  });

  return [].concat(_toConsumableArray(As), _toConsumableArray(AAAAs), [NSEC]);
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
Advertisement.prototype._makeServiceRecords = function () {
  var records = [];
  var interfaceRecords = this._hostnameResponder.getRecords();

  // enumerator  : "_services._dns-sd._udp.local."
  // registration: "_http._tcp.local."
  // serviceName : "A web page._http._tcp.local."
  var enumerator = misc.fqdn('_services._dns-sd._udp', this._domain);
  var registration = misc.fqdn(this.serviceName, this.protocol, this._domain);
  var serviceName = misc.fqdn(this.instanceName, registration);

  var NSEC = new ResourceRecord.NSEC({
    name: serviceName,
    existing: [RType.SRV, RType.TXT]
  });

  var SRV = new ResourceRecord.SRV({
    name: serviceName,
    target: misc.fqdn(this.hostname, this._domain),
    port: this.port,
    additionals: [NSEC].concat(_toConsumableArray(interfaceRecords))
  });

  var TXT = new ResourceRecord.TXT({
    name: serviceName,
    additionals: [NSEC],
    txt: this.txt
  });

  records.push(SRV);
  records.push(TXT);
  records.push(NSEC);

  records.push(new ResourceRecord.PTR({
    name: registration,
    PTRDName: serviceName,
    additionals: [SRV, TXT, NSEC].concat(_toConsumableArray(interfaceRecords))
  }));

  records.push(new ResourceRecord.PTR({
    name: enumerator,
    PTRDName: registration
  }));

  // ex: "_printer.sub._http._tcp.local."
  this.subtypes.forEach(function (subType) {
    records.push(new ResourceRecord.PTR({
      name: misc.fqdn(subType, '_sub', registration),
      PTRDName: serviceName,
      additionals: [SRV, TXT, NSEC].concat(_toConsumableArray(interfaceRecords))
    }));
  });

  return records;
};

module.exports = Advertisement;