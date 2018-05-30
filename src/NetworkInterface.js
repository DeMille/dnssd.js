let os = require('os');
let dgram = require('dgram');

let Packet = require('./Packet');

const EventEmitter = require('./EventEmitter');
const ExpiringRecordCollection = require('./ExpiringRecordCollection');
const Mutex = require('./Mutex');
const misc = require('./misc');
const hex = require('./hex');

const filename = require('path').basename(__filename);
let debug = require('./debug')(`dnssd:${filename}`);

const MDNS_PORT = 5353;
const MDNS_ADDRESS = {IPv4: '224.0.0.251', IPv6: 'FF02::FB'};


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
    return /^::1$/.test(ip) ||
           /^fe80/i.test(ip) ||
           /^fc[0-9a-f]{2}/i.test(ip) ||
           /^fd[0-9a-f]{2}/i.test(ip);
  }

  // IPv4
  const parts = ip.split('.').map(n => parseInt(n, 10));

  return (parts[0] === 10 ||
         (parts[0] === 192 && parts[1] === 168) ||
         (parts[0] === 172 && (parts[1] >= 16 && parts[1] <= 31)));
}


function isIPv4(ip) {
  return /(?:[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$)/.test(ip);
}


function findInterfaceName(address) {
  const interfaces = os.networkInterfaces();

  return Object.keys(interfaces).find(name =>
    interfaces[name].some(addr => addr.address === address));
}


/**
 * Maps interface names to a previously created NetworkInterfaces
 */
let activeInterfaces = {};


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
  this.cache = new ExpiringRecordCollection([], `${this._id}'s cache`);
  this._history = new ExpiringRecordCollection([], `${this._id}'s history`);

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
NetworkInterface.get = function get(specific = '') {
  // doesn't set a specific multicast send address
  if (!specific) {
    if (!activeInterfaces.any) {
      activeInterfaces.any = new NetworkInterface();
    }

    return activeInterfaces.any;
  }

  // sets multicast send address
  let name;
  let address;

  // arg is an IP address
  if (isIPv4(specific)) {
    name = findInterfaceName(specific);
    address = specific;
  // arg is the name of an interface
  } else {
    if (!os.networkInterfaces()[specific]) {
      throw new Error(`Can't find an interface named '${specific}'`);
    }

    name = specific;
    address = os.networkInterfaces()[name].find(a => a.family === 'IPv4').address;
  }

  if (!name || !address) {
    throw new Error(`Interface matching '${specific}' not found`);
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
  const interfaces = os.networkInterfaces();

  return Object.keys(interfaces).find((name) => {
    const addresses = interfaces[name];
    return addresses.every(address => address.internal);
  });
};


/**
 * Binds each address the interface uses to the multicast address/port
 * Increments `this._usingMe` to keep track of how many browsers/advertisements
 * are using it.
 */
NetworkInterface.prototype.bind = function() {
  return new Promise((resolve, reject) => {
    this._usingMe++;

    // prevent concurrent binds:
    this._mutex.lock((unlock) => {
      if (this._isBound) {
        unlock();
        resolve();
        return;
      }

      // create & bind socket
      this._bindSocket()
        .then(() => {
          debug(`Interface ${this._id} now bound`);
          this._isBound = true;
          unlock();
          resolve();
        })
        .catch((err) => {
          this._usingMe--;
          reject(err);
          unlock();
        });
    });
  });
};


NetworkInterface.prototype._bindSocket = function() {
  let isPending = true;

  const promise = new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      if (isPending) reject(err);
      else this._onError(err);
    });

    socket.on('close', () => {
      this._onError(new Error('Socket closed unexpectedly'));
    });

    socket.on('message', (msg, rinfo) => {
      this._onMessage(msg, rinfo);
    });

    socket.on('listening', () => {
      const sinfo = socket.address();
      debug(`${this._id} listening on ${sinfo.address}:${sinfo.port}`);

      // Make sure loopback is set to ensure we can communicate with any other
      // responders on the same machine. IP_MULTICAST_LOOP might default to
      // true so this may be redundant on some platforms.
      socket.setMulticastLoopback(true);
      socket.setTTL(255);

      // set a specific multicast interface to use for outgoing packets
      if (this._multicastAddr) socket.setMulticastInterface(this._multicastAddr);

      // add membership on each unique IPv4 interface address
      const addresses = [].concat(...Object.values(os.networkInterfaces()))
        .filter(addr => addr.family === 'IPv4')
        .map(addr => addr.address);

      [...new Set(addresses)].forEach((address) => {
        try {
          socket.addMembership(MDNS_ADDRESS.IPv4, address);
        } catch (e) {
          console.log('OUCH! - could not add membership to interface ' + address, e);
        }
      });

      this._sockets.push(socket);
      resolve();
    });

    socket.bind({ address: '0.0.0.0', port: MDNS_PORT });
  });

  return promise.then(() => {
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
NetworkInterface.prototype._onMessage = function(msg, origin) {
  if (debug.verbose.isEnabled) {
    debug.verbose('Incoming message on interface %s from %s:%s \n\n%s\n\n',
      this._id, origin.address, origin.port, hex.view(msg));
  }

  const packet = new Packet(msg, origin);

  if (debug.isEnabled) {
    const index = this._buffers.findIndex(buf => msg.equals(buf));
    const {address, port} = origin;

    if (index !== -1) {
      this._buffers.splice(index, 1); // remove buf @index
      debug(`${address}:${port} -> ${this._id} *** Ours: \n\n<-- ${packet}\n\n`);
    } else {
      debug(`${address}:${port} -> ${this._id} \n\n<-- ${packet}\n\n`);
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
NetworkInterface.prototype._addToCache = function(packet) {
  debug('Adding records to interface (%s) cache', this._id);

  const incomingRecords = [...packet.answers, ...packet.additionals];

  incomingRecords.forEach((record) => {
    if (record.isUnique) this.cache.flushRelated(record);
    this.cache.add(record);
  });
};


NetworkInterface.prototype.hasRecentlySent = function(record, range = 1) {
  return this._history.hasAddedWithin(record, range);
};


/**
 * Send the packet on each socket for this interface.
 * If no unicast destination address/port is given the packet is sent to the
 * multicast address/port.
 */
NetworkInterface.prototype.send = function(packet, destination, callback) {
  if (!this._isBound) {
    debug('Interface not bound yet, can\'t send');
    return callback && callback();
  }

  if (packet.isEmpty()) {
    debug('Packet is empty, not sending');
    return callback && callback();
  }

  if (destination && !isLocal(destination.address)) {
    debug(`Destination ${destination.address} not link-local, not sending`);
    return callback && callback();
  }

  if (packet.isAnswer() && !destination) {
    debug.verbose('Adding outgoing multicast records to history');
    this._history.addEach([...packet.answers, ...packet.additionals]);
  }

  const done = callback && misc.after_n(callback, this._sockets.length);
  const buf = packet.toBuffer();

  // send packet on each socket
  this._sockets.forEach((socket) => {
    const family = socket.address().family;
    const port    = (destination) ? destination.port    : MDNS_PORT;
    const address = (destination) ? destination.address : MDNS_ADDRESS[family];

    // don't try to send to IPv4 on an IPv6 & vice versa
    if (
      (destination && family === 'IPv4' && !isIPv4(address)) ||
      (destination && family === 'IPv6' && isIPv4(address))
    ) {
      debug(`Mismatched sockets, (${family} to ${destination.address}), skipping`);
      return;
    }

    // the outgoing list _should_ only have a few at any given time
    // but just in case, make sure it doesn't grow indefinitely
    if (debug.isEnabled && this._buffers.length < 10) this._buffers.push(buf);

    debug('%s (%s) -> %s:%s\n\n--> %s\n\n',
      this._id, family, address, port, packet);

    socket.send(buf, 0, buf.length, port, address, (err) => {
      if (!err) return done && done();

      // any other error goes to the handler:
      if (err.code !== 'EMSGSIZE') return this._onError(err);

      // split big packets up and resend:
      debug('Packet too big to send, splitting');

      packet.split().forEach((half) => {
        this.send(half, destination, callback);
      });
    });
  });
};


/**
 * Browsers/Advertisements use this instead of using stop()
 */
NetworkInterface.prototype.stopUsing = function() {
  this._usingMe--;
  if (this._usingMe <= 0) this.stop();
};


NetworkInterface.prototype.stop = function() {
  debug(`Shutting down ${this._id}...`);

  this._sockets.forEach((socket) => {
    socket.removeAllListeners(); // do first to prevent close events
    try {
      socket.close();
    } catch (e) { /**/ }
  });

  this.cache.clear();
  this._history.clear();

  this._usingMe = 0;
  this._isBound = false;
  this._sockets = [];
  this._buffers = [];

  debug('Done.');
};


NetworkInterface.prototype._onError = function(err) {
  debug(`${this._id} had an error: ${err}\n${err.stack}`);

  this.stop();
  this.emit('error', err);
};


module.exports = NetworkInterface;
