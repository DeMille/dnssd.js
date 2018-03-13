'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var hash = require('./hash');
var misc = require('./misc');
var BufferWrapper = require('./BufferWrapper');

var filename = require('path').basename(__filename);
var debug = require('./debug')('dnssd:' + filename);

var RClass = require('./constants').RClass;
var RType = require('./constants').RType;
var RNums = require('./constants').RNums;

/**
 * Create/parse resource records
 * @class
 *
 * Create a specific ResourceRecord (AAAA):
 * > const record = new ResourceRecord.AAAA({name: 'Target.local.', address: '::1'});
 *
 * Parse a ResourceRecord from a buffer (a wrapped buffer):
 * > const record = ResourceRecord.fromBuffer(wrapper);
 *
 */

var ResourceRecord = function () {
  function ResourceRecord(fields) {
    _classCallCheck(this, ResourceRecord);

    if (this.constructor === ResourceRecord) throw new Error('Abstract only!');
    if (!fields || !fields.name) throw new Error('Record must have a name');

    this.name = fields.name;
    this.rrtype = fields.rrtype || RType[this.constructor.name];
    this.rrclass = fields.rrclass || RClass.IN;

    if ('ttl' in fields) this.ttl = fields.ttl;
    if ('isUnique' in fields) this.isUnique = fields.isUnique;

    this.additionals = fields.additionals || [];
  }

  /**
   * Parse a record from a buffer. Starts reading the wrapped buffer at w/e
   * position its at when fromBuffer is called.
   *
   * @param  {BufferWrapper} wrapper
   * @return {ResourceRecord}
   */


  _createClass(ResourceRecord, [{
    key: '_makehashes',


    /**
     * Makes a couple hashes of record properties so records can get compared
     * easier.
     */
    value: function _makehashes() {
      // a hash for name/rrtype/rrclass (records like PTRs might share name/type
      // but have different rdata)
      this.namehash = hash(this.name, this.rrtype, this.rrclass);
      // hash for comparing rdata
      this.rdatahash = this._hashRData();
      // a unique hash for a given name/type/class *AND* rdata
      this.hash = hash(this.namehash, this.rdatahash);
    }

    /**
     * Writes the record to a wrapped buffer at the wrapper's current position.
     * @param {BufferWrapper} wrapper
     */

  }, {
    key: 'writeTo',
    value: function writeTo(wrapper) {
      var classField = this.isUnique ? this.rrclass | 0x8000 : this.rrclass;

      // record info
      wrapper.writeFQDN(this.name);
      wrapper.writeUInt16BE(this.rrtype);
      wrapper.writeUInt16BE(classField);
      wrapper.writeUInt32BE(this.ttl);

      // leave UInt16BE gap to write rdataLen
      var rdataLenPos = wrapper.tell();
      wrapper.skip(2);

      // record specific rdata
      this._writeRData(wrapper);

      // go back and add rdata length
      var rdataLen = wrapper.tell() - rdataLenPos - 2;
      wrapper.buffer.writeUInt16BE(rdataLen, rdataLenPos);
    }

    /**
     * Checks if this record conflicts with another. Records conflict if they
     * 1) are both unique (shared record sets can't conflict)
     * 2) have the same name/type/class
     * 3) but have different rdata
     *
     * @param  {ResourceRecord} record
     * @return {boolean}
     */

  }, {
    key: 'conflictsWith',
    value: function conflictsWith(record) {
      var hasConflict = this.isUnique && record.isUnique && this.namehash === record.namehash && this.rdatahash !== record.rdatahash;

      if (hasConflict) {
        debug('Found conflict: \nRecord: %s\nIncoming: %s', this, record);
      }

      return hasConflict;
    }

    /**
     * Checks if this record can answer the question. Record names are compared
     * case insensitively.
     *
     * @param  {QueryRecord} question
     * @return {boolean}
     */

  }, {
    key: 'canAnswer',
    value: function canAnswer(question) {
      return (this.rrclass === question.qclass || question.qclass === RClass.ANY) && (this.rrtype === question.qtype || question.qtype === RType.ANY) && this.name.toUpperCase() === question.name.toUpperCase();
    }

    /**
     * Records are equal if name/type/class and rdata are the same
     */

  }, {
    key: 'equals',
    value: function equals(record) {
      return this.hash === record.hash;
    }

    /**
     * Determines which record is lexicographically later. Used to determine
     * which probe wins when two competing probes are sent at the same time.
     * (see https://tools.ietf.org/html/rfc6762#section-8.2)
     *
     * means comparing, in order,
     * - rrclass
     * - rrtype
     * - rdata, byte by byte
     *
     * Rdata has to be written to a buffer first and then compared.
     * The cache flush bit has to be excluded as well when comparing
     * rrclass.
     *
     *  1 = this record comes later than the other record
     * -1 = this record comes earlier than the other record
     *  0 = records are equal
     *
     * @param  {ResourceRecord} record
     * @return {number}
     */

  }, {
    key: 'compare',
    value: function compare(record) {
      if (this.equals(record)) return 0;

      if (this.rrclass > record.rrclass) return 1;
      if (this.rrclass < record.rrclass) return -1;

      if (this.rrtype > record.rrtype) return 1;
      if (this.rrtype < record.rrtype) return -1;

      // make buffers out of em so we can compare byte by byte
      // this also prevents data from being name compressed, since
      // we are only writing a single rdata, and nothing else
      var rdata_1 = new BufferWrapper();
      var rdata_2 = new BufferWrapper();

      this._writeRData(rdata_1);
      record._writeRData(rdata_2);

      return rdata_1.unwrap().compare(rdata_2.unwrap());
    }

    /**
     * Test if a record matches some properties. String values are compared
     * case insensitively.
     *
     * Ex:
     * > const isMatch = record.matches({name: 'test.', priority: 12})
     *
     * @param  {object} properties
     * @return {boolean}
     */

  }, {
    key: 'matches',
    value: function matches(properties) {
      var _this = this;

      return Object.keys(properties).map(function (key) {
        return [key, properties[key]];
      }).every(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 2),
            key = _ref2[0],
            value = _ref2[1];

        return typeof _this[key] === 'string' && typeof value === 'string' ? _this[key].toUpperCase() === value.toUpperCase() : misc.equals(_this[key], value);
      });
    }

    /**
     * Returns a clone of the record, making a new object
     */

  }, {
    key: 'clone',
    value: function clone() {
      var type = this.constructor.name;
      var fields = this;

      return new ResourceRecord[type](fields);
    }

    /**
     * If anything changes on a record it needs to be re-hashed. Otherwise
     * all the comparisons won't work with the new changes.
     *
     * Bad:  record.target = 'new.local.';
     * Good: record.updateWith(() => {record.target = 'new.local.'});
     *
     */

  }, {
    key: 'updateWith',
    value: function updateWith(fn) {
      // give record to updater function to modify
      fn(this);
      // rehash in case name/rdata changed
      this._makehashes();
    }

    /**
     * Records with reserved names shouldn't be goodbye'd
     *
     * _services._dns-sd._udp.<domain>.
     *         b._dns-sd._udp.<domain>.
     *        db._dns-sd._udp.<domain>.
     *         r._dns-sd._udp.<domain>.
     *        dr._dns-sd._udp.<domain>.
     *        lb._dns-sd._udp.<domain>.
     */

  }, {
    key: 'canGoodbye',
    value: function canGoodbye() {
      var name = this.name.toLowerCase();
      return name.indexOf('._dns-sd._udp.') === -1;
    }

    /**
     * Breaks up the record into an array of parts. Used in misc.alignRecords
     * so stuff can get printed nicely in columns. Only ever used in debugging.
     */

  }, {
    key: 'toParts',
    value: function toParts() {
      var parts = [];

      var type = this.constructor.name === 'Unknown' ? this.rrtype : this.constructor.name;

      var ttl = this.ttl === 0 ? misc.color(this.ttl, 'red') : String(this.ttl);

      parts.push(this.name);
      parts.push(this.ttl === 0 ? misc.color(type, 'red') : misc.color(type, 'blue'));

      parts.push(ttl);
      parts.push(String(this._getRDataStr()));

      if (this.isUnique) parts.push(misc.color('(flush)', 'grey'));

      return parts;
    }
  }, {
    key: 'toString',
    value: function toString() {
      return this.toParts().join(' ');
    }
  }], [{
    key: 'fromBuffer',
    value: function fromBuffer(wrapper) {
      var name = wrapper.readFQDN();
      var rrtype = wrapper.readUInt16BE();
      var rrclass = wrapper.readUInt16BE();
      var ttl = wrapper.readUInt32BE();

      // top-bit in rrclass is reused as the cache-flush bit
      var fields = {
        name: name,
        rrtype: rrtype,
        rrclass: rrclass & ~0x8000,
        isUnique: !!(rrclass & 0x8000),
        ttl: ttl
      };

      if (rrtype === RType.A) return new ResourceRecord.A(fields, wrapper);
      if (rrtype === RType.PTR) return new ResourceRecord.PTR(fields, wrapper);
      if (rrtype === RType.TXT) return new ResourceRecord.TXT(fields, wrapper);
      if (rrtype === RType.AAAA) return new ResourceRecord.AAAA(fields, wrapper);
      if (rrtype === RType.SRV) return new ResourceRecord.SRV(fields, wrapper);
      if (rrtype === RType.NSEC) return new ResourceRecord.NSEC(fields, wrapper);

      return new ResourceRecord.Unknown(fields, wrapper);
    }
  }]);

  return ResourceRecord;
}();

/**
 * A record (IPv4 address)
 */


var A = function (_ResourceRecord) {
  _inherits(A, _ResourceRecord);

  /**
   * @param  {object} fields
   * @param  {BufferWrapper} [wrapper] - only used by the .fromBuffer method
   */
  function A(fields, wrapper) {
    _classCallCheck(this, A);

    // defaults:
    var _this2 = _possibleConstructorReturn(this, (A.__proto__ || Object.getPrototypeOf(A)).call(this, fields));

    misc.defaults(_this2, { ttl: 120, isUnique: true });

    // rdata:
    _this2.address = fields.address || '';

    if (wrapper) _this2._readRData(wrapper);
    _this2._makehashes();
    return _this2;
  }

  _createClass(A, [{
    key: '_readRData',
    value: function _readRData(wrapper) {
      var _len = wrapper.readUInt16BE();
      var n1 = wrapper.readUInt8();
      var n2 = wrapper.readUInt8();
      var n3 = wrapper.readUInt8();
      var n4 = wrapper.readUInt8();

      this.address = n1 + '.' + n2 + '.' + n3 + '.' + n4;
    }
  }, {
    key: '_writeRData',
    value: function _writeRData(wrapper) {
      this.address.split('.').forEach(function (str) {
        var n = parseInt(str, 10);
        wrapper.writeUInt8(n);
      });
    }
  }, {
    key: '_hashRData',
    value: function _hashRData() {
      return hash(this.address);
    }
  }, {
    key: '_getRDataStr',
    value: function _getRDataStr() {
      return this.address;
    }
  }]);

  return A;
}(ResourceRecord);

ResourceRecord.A = A;

/**
 * PTR record
 */

var PTR = function (_ResourceRecord2) {
  _inherits(PTR, _ResourceRecord2);

  function PTR(fields, wrapper) {
    _classCallCheck(this, PTR);

    // defaults:
    var _this3 = _possibleConstructorReturn(this, (PTR.__proto__ || Object.getPrototypeOf(PTR)).call(this, fields));

    misc.defaults(_this3, { ttl: 4500, isUnique: false });

    // rdata:
    _this3.PTRDName = fields.PTRDName || '';

    if (wrapper) _this3._readRData(wrapper);
    _this3._makehashes();
    return _this3;
  }

  _createClass(PTR, [{
    key: '_readRData',
    value: function _readRData(wrapper) {
      var _len = wrapper.readUInt16BE();
      this.PTRDName = wrapper.readFQDN();
    }
  }, {
    key: '_writeRData',
    value: function _writeRData(wrapper) {
      wrapper.writeFQDN(this.PTRDName);
    }
  }, {
    key: '_hashRData',
    value: function _hashRData() {
      return hash(this.PTRDName);
    }
  }, {
    key: '_getRDataStr',
    value: function _getRDataStr() {
      return this.PTRDName;
    }
  }]);

  return PTR;
}(ResourceRecord);

ResourceRecord.PTR = PTR;

/**
 * TXT record
 *
 * key/value conventions:
 * - Key present with value
 *   'key=value' -> {key: value}
 *
 * - Key present, _empty_ value:
 *   'key=' -> {key: null}
 *
 * - Key present, but no value:
 *   'key' -> {key: true}
 *
 * Important note: keys are case insensitive
 */

var TXT = function (_ResourceRecord3) {
  _inherits(TXT, _ResourceRecord3);

  function TXT(fields, wrapper) {
    _classCallCheck(this, TXT);

    // defaults:
    var _this4 = _possibleConstructorReturn(this, (TXT.__proto__ || Object.getPrototypeOf(TXT)).call(this, fields));

    misc.defaults(_this4, { ttl: 4500, isUnique: true });

    // rdata:
    _this4.txtRaw = misc.makeRawTXT(fields.txt || {});
    _this4.txt = misc.makeReadableTXT(fields.txt || {});

    if (wrapper) _this4._readRData(wrapper);
    _this4._makehashes();
    return _this4;
  }

  _createClass(TXT, [{
    key: '_readRData',
    value: function _readRData(wrapper) {
      var rdataLength = wrapper.readUInt16BE();
      var end = wrapper.tell() + rdataLength;
      var len = void 0;

      // read each key: value pair
      while (wrapper.tell() < end && (len = wrapper.readUInt8())) {
        var key = '';
        var chr = void 0,
            value = void 0;

        while (len-- > 0 && (chr = wrapper.readString(1)) !== '=') {
          key += chr;
        }

        if (len > 0) value = wrapper.read(len);else if (chr === '=') value = null;else value = true;

        this.txtRaw[key] = value;
        this.txt[key] = Buffer.isBuffer(value) ? value.toString() : value;
      }
    }
  }, {
    key: '_writeRData',
    value: function _writeRData(wrapper) {
      var _this5 = this;

      // need to at least put a 0 byte if no txt data
      if (!Object.keys(this.txtRaw).length) {
        return wrapper.writeUInt8(0);
      }

      // value is either true, null, or a buffer
      Object.keys(this.txtRaw).forEach(function (key) {
        var value = _this5.txtRaw[key];
        var str = value === true ? key : key + '=';
        var len = Buffer.byteLength(str);

        if (Buffer.isBuffer(value)) len += value.length;

        wrapper.writeUInt8(len);
        wrapper.writeString(str);

        if (Buffer.isBuffer(value)) wrapper.add(value);
      });
    }
  }, {
    key: '_hashRData',
    value: function _hashRData() {
      return hash(this.txtRaw);
    }
  }, {
    key: '_getRDataStr',
    value: function _getRDataStr() {
      return misc.truncate(JSON.stringify(this.txt), 30);
    }
  }]);

  return TXT;
}(ResourceRecord);

ResourceRecord.TXT = TXT;

/**
 * AAAA record (IPv6 address)
 */

var AAAA = function (_ResourceRecord4) {
  _inherits(AAAA, _ResourceRecord4);

  function AAAA(fields, wrapper) {
    _classCallCheck(this, AAAA);

    // defaults:
    var _this6 = _possibleConstructorReturn(this, (AAAA.__proto__ || Object.getPrototypeOf(AAAA)).call(this, fields));

    misc.defaults(_this6, { ttl: 120, isUnique: true });

    // rdata:
    _this6.address = fields.address || '';

    if (wrapper) _this6._readRData(wrapper);
    _this6._makehashes();
    return _this6;
  }

  _createClass(AAAA, [{
    key: '_readRData',
    value: function _readRData(wrapper) {
      var _len = wrapper.readUInt16BE();
      var raw = wrapper.read(16);
      var parts = [];

      for (var i = 0; i < raw.length; i += 2) {
        parts.push(raw.readUInt16BE(i).toString(16));
      }

      this.address = parts.join(':').replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3').replace(/:{3,4}/, '::');
    }
  }, {
    key: '_writeRData',
    value: function _writeRData(wrapper) {

      function expandIPv6(str) {
        var ip = str;

        // replace ipv4 address if any
        var ipv4_match = ip.match(/(.*:)([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$)/);

        if (ipv4_match) {
          ip = ipv4_match[1];
          var ipv4 = ipv4_match[2].match(/[0-9]+/g);

          for (var i = 0; i < 4; i++) {
            ipv4[i] = parseInt(ipv4[i], 10).toString(16);
          }

          ip += ipv4[0] + ipv4[1] + ':' + ipv4[2] + ipv4[3];
        }

        // take care of leading and trailing ::
        ip = ip.replace(/^:|:$/g, '');

        var ipv6 = ip.split(':');

        for (var _i2 = 0; _i2 < ipv6.length; _i2++) {
          // normalize grouped zeros ::
          if (ipv6[_i2] === '') {
            ipv6[_i2] = new Array(9 - ipv6.length).fill(0).join(':');
          }
        }

        return ipv6.join(':');
      }

      expandIPv6(this.address).split(':').forEach(function (str) {
        var u16 = parseInt(str, 16);
        wrapper.writeUInt16BE(u16);
      });
    }
  }, {
    key: '_hashRData',
    value: function _hashRData() {
      return hash(this.address);
    }
  }, {
    key: '_getRDataStr',
    value: function _getRDataStr() {
      return this.address;
    }
  }]);

  return AAAA;
}(ResourceRecord);

ResourceRecord.AAAA = AAAA;

/**
 * SRV record
 */

var SRV = function (_ResourceRecord5) {
  _inherits(SRV, _ResourceRecord5);

  function SRV(fields, wrapper) {
    _classCallCheck(this, SRV);

    // defaults:
    var _this7 = _possibleConstructorReturn(this, (SRV.__proto__ || Object.getPrototypeOf(SRV)).call(this, fields));

    misc.defaults(_this7, { ttl: 120, isUnique: true });

    // rdata:
    _this7.target = fields.target || '';
    _this7.port = fields.port || 0;
    _this7.priority = fields.priority || 0;
    _this7.weight = fields.weight || 0;

    if (wrapper) _this7._readRData(wrapper);
    _this7._makehashes();
    return _this7;
  }

  _createClass(SRV, [{
    key: '_readRData',
    value: function _readRData(wrapper) {
      var _len = wrapper.readUInt16BE();
      this.priority = wrapper.readUInt16BE();
      this.weight = wrapper.readUInt16BE();
      this.port = wrapper.readUInt16BE();
      this.target = wrapper.readFQDN();
    }
  }, {
    key: '_writeRData',
    value: function _writeRData(wrapper) {
      wrapper.writeUInt16BE(this.priority);
      wrapper.writeUInt16BE(this.weight);
      wrapper.writeUInt16BE(this.port);
      wrapper.writeFQDN(this.target);
    }
  }, {
    key: '_hashRData',
    value: function _hashRData() {
      return hash(this.priority, this.weight, this.port, this.target);
    }
  }, {
    key: '_getRDataStr',
    value: function _getRDataStr() {
      return this.target + ' ' + this.port + ' P:' + this.priority + ' W:' + this.weight;
    }
  }]);

  return SRV;
}(ResourceRecord);

ResourceRecord.SRV = SRV;

/**
 * NSEC record
 * Only handles the limited 'restricted' form (record rrtypes < 255)
 */

var NSEC = function (_ResourceRecord6) {
  _inherits(NSEC, _ResourceRecord6);

  function NSEC(fields, wrapper) {
    _classCallCheck(this, NSEC);

    // defaults:
    var _this8 = _possibleConstructorReturn(this, (NSEC.__proto__ || Object.getPrototypeOf(NSEC)).call(this, fields));

    misc.defaults(_this8, { ttl: 120, isUnique: true });

    // rdata:
    _this8.existing = (fields.existing || []).sort(function (a, b) {
      return a - b;
    });

    if (wrapper) _this8._readRData(wrapper);
    _this8._makehashes();
    return _this8;
  }

  _createClass(NSEC, [{
    key: '_readRData',
    value: function _readRData(wrapper) {
      var rdataLength = wrapper.readUInt16BE();
      var rdataEnd = wrapper.tell() + rdataLength;

      var _name = wrapper.readFQDN(); // doesn't matter, ignored
      var block = wrapper.readUInt8(); // window block for rrtype bitfield
      var len = wrapper.readUInt8(); // number of octets in bitfield

      // Ignore rrtypes over 255 (only implementing the restricted form)
      // Bitfield length must always be < 32, otherwise skip parsing
      if (block !== 0 || len > 32) return wrapper.seek(rdataEnd);

      // NSEC rrtype bitfields can be up to 256 bits (32 bytes), BUT
      // - js bitwise operators are only do 32 bits
      // - node's buffer.readIntBE() can only read up to 6 bytes
      //
      // So here we're doing 1 byte of the field at a time
      //
      for (var maskNum = 0; maskNum < len; maskNum++) {
        var mask = wrapper.readUInt8(1);
        if (mask === 0) continue;

        for (var bit = 0; bit < 8; bit++) {
          if (mask & 1 << bit) {
            // rrtypes in bitfields are in network bit order
            // 01000000 => 1 === RType.A (bit 6)
            // 00000000 00000000 00000000 00001000 => 28 === RType.AAAA (bit 3)
            var rrtype = 8 * maskNum + (7 - bit);
            this.existing.push(rrtype);
          }
        }
      }
    }
  }, {
    key: '_writeRData',
    value: function _writeRData(wrapper) {
      // restricted form, only rrtypes up to 255
      var rrtypes = [].concat(_toConsumableArray(new Set(this.existing))).filter(function (x) {
        return x <= 255;
      });

      // Same problems as _readRData, 32 bit operators and can't write big ints,
      // so bitfields are broken up into 1 byte segments and handled one at a time
      var len = !rrtypes.length ? 0 : Math.ceil(Math.max.apply(Math, _toConsumableArray(rrtypes)) / 8);
      var masks = Array(len).fill(0);

      rrtypes.forEach(function (rrtype) {
        var index = ~~(rrtype / 8); // which mask this rrtype is on
        var bit = 7 - rrtype % 8; // convert to network bit order

        masks[index] |= 1 << bit;
      });

      wrapper.writeFQDN(this.name); // "next domain name", ignored for mdns
      wrapper.writeUInt8(0); // block number, always 0 for restricted form
      wrapper.writeUInt8(len); // bitfield length in octets

      // write masks byte by byte since node buffers can only write 42 bit numbers
      masks.forEach(function (mask) {
        return wrapper.writeUInt8(mask);
      });
    }
  }, {
    key: '_hashRData',
    value: function _hashRData() {
      return hash(this.existing);
    }
  }, {
    key: '_getRDataStr',
    value: function _getRDataStr() {
      return this.existing.map(function (rrtype) {
        return RNums[rrtype] || rrtype;
      }).join(', ');
    }
  }]);

  return NSEC;
}(ResourceRecord);

ResourceRecord.NSEC = NSEC;

/**
 * Unknown record, anything not describe above. Could be OPT records, etc.
 */

var Unknown = function (_ResourceRecord7) {
  _inherits(Unknown, _ResourceRecord7);

  function Unknown(fields, wrapper) {
    _classCallCheck(this, Unknown);

    // defaults:
    var _this9 = _possibleConstructorReturn(this, (Unknown.__proto__ || Object.getPrototypeOf(Unknown)).call(this, fields));

    misc.defaults(_this9, { ttl: 120, isUnique: true });

    // rdata:
    _this9.rdata = fields.rdata || Buffer.alloc(0);

    if (wrapper) _this9._readRData(wrapper);
    _this9._makehashes();
    return _this9;
  }

  _createClass(Unknown, [{
    key: '_readRData',
    value: function _readRData(wrapper) {
      var rdataLength = wrapper.readUInt16BE();
      this.RData = wrapper.read(rdataLength);
    }
  }, {
    key: '_writeRData',
    value: function _writeRData(wrapper) {
      wrapper.add(this.RData);
    }
  }, {
    key: '_hashRData',
    value: function _hashRData() {
      return hash(this.RData);
    }
  }, {
    key: '_getRDataStr',
    value: function _getRDataStr() {
      // replace non-ascii characters w/ gray dots
      function ascii(chr) {
        return (/[ -~]/.test(chr) ? chr : misc.color('.', 'grey')
        );
      }

      var chars = this.RData.toString().split('');
      var str = chars.slice(0, 30).map(ascii).join('');

      return chars.length <= 30 ? str : str + '…';
    }
  }]);

  return Unknown;
}(ResourceRecord);

ResourceRecord.Unknown = Unknown;

module.exports = ResourceRecord;