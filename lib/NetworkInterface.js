'use strict';

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

var os = require('os');
var dgram = require('dgram');

var Packet = require('./Packet');

var EventEmitter = require('./EventEmitter');
var ExpiringRecordCollection = require('./ExpiringRecordCollection');
var Mutex = require('./Mutex');
var misc = require('./misc');
var hex = require('./hex');

var filename = require('path').basename(__filename);
var debug = require('./debug')('dnssd:' + filename);

var MDNS_PORT = 5353;
var MDNS_ADDRESS = { IPv4: '224.0.0.251', IPv6: 'FF02::FB' };

/**
 * IP should be considered as internal when:
 * ::1 - IPv6  loopback
 * fc00::/8
 * fd00::/8
 * fe80::/8
 * 10.0.0.0    -> 10.255.255.255  (10/8 prefix)
 * 127.0.0.0   -> 127.255.255.255 (127/8 prefix)
 * 172.16.0.0  -> 172.31.255.255  (172.16/12 prefix)
 * 192.168.0.0 -> 192.168.255.255 (192.168/16 prefix)
 *
 */
function isLocal(ip) {
  // IPv6
  if (!!~ip.indexOf(':')) {
    return (/^::1$/.test(ip) || /^fe80/i.test(ip) || /^fc[0-9a-f]{2}/i.test(ip) || /^fd[0-9a-f]{2}/i.test(ip)
    );
  }

  // IPv4
  var parts = ip.split('.').map(function (n) {
    return parseInt(n, 10);
  });

  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function isIPv4(ip) {
  return (/(?:[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$)/.test(ip)
  );
}

function findInterfaceName(address) {
  var interfaces = os.networkInterfaces();

  return Object.keys(interfaces).find(function (name) {
    return interfaces[name].some(function (addr) {
      return addr.address === address;
    });
  });
}

/**
 * Maps interface names to a previously created NetworkInterfaces
 */
var activeInterfaces = {};

/**
 * Creates a new NetworkInterface
 * @class
 * @extends EventEmitter
 *
 * @param {string} name
 */
function NetworkInterface(name, address) {
  this._id = name || 'INADDR_ANY';
  this._multicastAddr = address;

  debug('Creating new NetworkInterface on `%s`', this._id);
  EventEmitter.call(this);

  // socket binding
  this._usingMe = 0;
  this._isBound = false;
  this._sockets = [];
  this._mutex = new Mutex();

  // incoming / outgoing records
  this.cache = new ExpiringRecordCollection([], this._id + '\'s cache');
  this._history = new ExpiringRecordCollection([], this._id + '\'s history');

  // outgoing packet buffers (debugging)
  this._buffers = [];
}

NetworkInterface.prototype = Object.create(EventEmitter.prototype);
NetworkInterface.prototype.constructor = NetworkInterface;

/**
 * Creates/returns NetworkInterfaces from a name or address of interface.
 * Active interfaces get reused.
 *
 * @static
 *
 * Ex:
 * > const interfaces = NetworkInterface.get('eth0');
 * > const interfaces = NetworkInterface.get('111.222.333.444');
 *
 * @param  {string} arg
 * @return {NetworkInterface}
 */
NetworkInterface.get = function get() {
  var specific = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';

  // doesn't set a specific multicast send address
  if (!specific) {
    if (!activeInterfaces.any) {
      activeInterfaces.any = new NetworkInterface();
    }

    return activeInterfaces.any;
  }

  // sets multicast send address
  var name = void 0;
  var address = void 0;

  // arg is an IP address
  if (isIPv4(specific)) {
    name = findInterfaceName(specific);
    address = specific;
    // arg is the name of an interface
  } else {
    if (!os.networkInterfaces()[specific]) {
      throw new Error('Can\'t find an interface named \'' + specific + '\'');
    }

    name = specific;
    address = os.networkInterfaces()[name].find(function (a) {
      return a.family === 'IPv4';
    }).address;
  }

  if (!name || !address) {
    throw new Error('Interface matching \'' + specific + '\' not found');
  }

  if (!activeInterfaces[name]) {
    activeInterfaces[name] = new NetworkInterface(name, address);
  }

  return activeInterfaces[name];
};

/**
 * Returns the name of the loopback interface (if there is one)
 * @static
 */
NetworkInterface.getLoopback = function getLoopback() {
  var interfaces = os.networkInterfaces();

  return Object.keys(interfaces).find(function (name) {
    var addresses = interfaces[name];
    return addresses.every(function (address) {
      return address.internal;
    });
  });
};

/**
 * Binds each address the interface uses to the multicast address/port
 * Increments `this._usingMe` to keep track of how many browsers/advertisements
 * are using it.
 */
NetworkInterface.prototype.bind = function () {
  var _this = this;

  return new Promise(function (resolve, reject) {
    _this._usingMe++;

    // prevent concurrent binds:
    _this._mutex.lock(function (unlock) {
      if (_this._isBound) {
        unlock();
        resolve();
        return;
      }

      // create & bind socket
      _this._bindSocket().then(function () {
        debug('Interface ' + _this._id + ' now bound');
        _this._isBound = true;
        unlock();
        resolve();
      }).catch(function (err) {
        _this._usingMe--;
        reject(err);
        unlock();
      });
    });
  });
};

NetworkInterface.prototype._bindSocket = function () {
  var _this2 = this;

  var isPending = true;

  var promise = new Promise(function (resolve, reject) {
    var socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', function (err) {
      if (isPending) reject(err);else _this2._onError(err);
    });

    socket.on('close', function () {
      _this2._onError(new Error('Socket closed unexpectedly'));
    });

    socket.on('message', function (msg, rinfo) {
      _this2._onMessage(msg, rinfo);
    });

    socket.on('listening', function () {
      var _ref;

      var sinfo = socket.address();
      debug(_this2._id + ' listening on ' + sinfo.address + ':' + sinfo.port);

      // Make sure loopback is set to ensure we can communicate with any other
      // responders on the same machine. IP_MULTICAST_LOOP might default to
      // true so this may be redundant on some platforms.
      socket.setMulticastLoopback(true);
      socket.setTTL(255);

      // set a specific multicast interface to use for outgoing packets
      if (_this2._multicastAddr) socket.setMulticastInterface(_this2._multicastAddr);

      // add membership on each unique IPv4 interface address
      var addresses = (_ref = []).concat.apply(_ref, _toConsumableArray(Object.values(os.networkInterfaces()))).filter(function (addr) {
        return addr.family === 'IPv4';
      }).map(function (addr) {
        return addr.address;
      });

      [].concat(_toConsumableArray(new Set(addresses))).forEach(function (address) {
        try {
          socket.addMembership(MDNS_ADDRESS.IPv4, address);
        } catch (e) {
          console.log('OUCH! - could not add membership to interface ' + address, e);
        }
      });

      _this2._sockets.push(socket);
      resolve();
    });

    socket.bind({ address: '0.0.0.0', port: MDNS_PORT });
  });

  return promise.then(function () {
    isPending = false;
  });
};

/**
 * Handles incoming messages.
 *
 * @emtis 'answer' w/ answer packet
 * @emtis 'probe' w/ probe packet
 * @emtis 'query' w/ query packet
 *
 * @param  {Buffer} msg
 * @param  {object} origin
 */
NetworkInterface.prototype._onMessage = function (msg, origin) {
  if (debug.verbose.isEnabled) {
    debug.verbose('Incoming message on interface %s from %s:%s \n\n%s\n\n', this._id, origin.address, origin.port, hex.view(msg));
  }

  var packet = new Packet(msg, origin);

  if (debug.isEnabled) {
    var index = this._buffers.findIndex(function (buf) {
      return msg.equals(buf);
    });
    var address = origin.address,
        port = origin.port;


    if (index !== -1) {
      this._buffers.splice(index, 1); // remove buf @index
      debug(address + ':' + port + ' -> ' + this._id + ' *** Ours: \n\n<-- ' + packet + '\n\n');
    } else {
      debug(address + ':' + port + ' -> ' + this._id + ' \n\n<-- ' + packet + '\n\n');
    }
  }

  if (!packet.isValid()) return debug('Bad packet, ignoring');

  // must silently ignore responses where source UDP port is not 5353
  if (packet.isAnswer() && origin.port === 5353) {
    this._addToCache(packet);
    this.emit('answer', packet);
  }

  if (packet.isProbe() && origin.port === 5353) {
    this.emit('probe', packet);
  }

  if (packet.isQuery()) {
    this.emit('query', packet);
  }
};

/**
 * Adds records from incoming packet to interface cache. Also flushes records
 * (sets them to expire in 1s) if the cache flush bit is set.
 */
NetworkInterface.prototype._addToCache = function (packet) {
  var _this3 = this;

  debug('Adding records to interface (%s) cache', this._id);

  var incomingRecords = [].concat(_toConsumableArray(packet.answers), _toConsumableArray(packet.additionals));

  incomingRecords.forEach(function (record) {
    if (record.isUnique) _this3.cache.flushRelated(record);
    _this3.cache.add(record);
  });
};

NetworkInterface.prototype.hasRecentlySent = function (record) {
  var range = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1;

  return this._history.hasAddedWithin(record, range);
};

/**
 * Send the packet on each socket for this interface.
 * If no unicast destination address/port is given the packet is sent to the
 * multicast address/port.
 */
NetworkInterface.prototype.send = function (packet, destination, callback) {
  var _this4 = this;

  if (!this._isBound) {
    debug('Interface not bound yet, can\'t send');
    return callback && callback();
  }

  if (packet.isEmpty()) {
    debug('Packet is empty, not sending');
    return callback && callback();
  }

  if (destination && !isLocal(destination.address)) {
    debug('Destination ' + destination.address + ' not link-local, not sending');
    return callback && callback();
  }

  if (packet.isAnswer() && !destination) {
    debug.verbose('Adding outgoing multicast records to history');
    this._history.addEach([].concat(_toConsumableArray(packet.answers), _toConsumableArray(packet.additionals)));
  }

  var done = callback && misc.after_n(callback, this._sockets.length);
  var buf = packet.toBuffer();

  // send packet on each socket
  this._sockets.forEach(function (socket) {
    var family = socket.address().family;
    var port = destination ? destination.port : MDNS_PORT;
    var address = destination ? destination.address : MDNS_ADDRESS[family];

    // don't try to send to IPv4 on an IPv6 & vice versa
    if (destination && family === 'IPv4' && !isIPv4(address) || destination && family === 'IPv6' && isIPv4(address)) {
      debug('Mismatched sockets, (' + family + ' to ' + destination.address + '), skipping');
      return;
    }

    // the outgoing list _should_ only have a few at any given time
    // but just in case, make sure it doesn't grow indefinitely
    if (debug.isEnabled && _this4._buffers.length < 10) _this4._buffers.push(buf);

    debug('%s (%s) -> %s:%s\n\n--> %s\n\n', _this4._id, family, address, port, packet);

    socket.send(buf, 0, buf.length, port, address, function (err) {
      if (!err) return done && done();

      // any other error goes to the handler:
      if (err.code !== 'EMSGSIZE') return _this4._onError(err);

      // split big packets up and resend:
      debug('Packet too big to send, splitting');

      packet.split().forEach(function (half) {
        _this4.send(half, destination, callback);
      });
    });
  });
};

/**
 * Browsers/Advertisements use this instead of using stop()
 */
NetworkInterface.prototype.stopUsing = function () {
  this._usingMe--;
  if (this._usingMe <= 0) this.stop();
};

NetworkInterface.prototype.stop = function () {
  debug('Shutting down ' + this._id + '...');

  this._sockets.forEach(function (socket) {
    socket.removeAllListeners(); // do first to prevent close events
    try {
      socket.close();
    } catch (e) {/**/}
  });

  this.cache.clear();
  this._history.clear();

  this._usingMe = 0;
  this._isBound = false;
  this._sockets = [];
  this._buffers = [];

  debug('Done.');
};

NetworkInterface.prototype._onError = function (err) {
  debug(this._id + ' had an error: ' + err + '\n' + err.stack);

  if (this._usingMe > 0) {
    this.emit('error', err);
  }
  this.stop();
};

module.exports = NetworkInterface;