const hash = require('./hash');
const misc = require('./misc');
const BufferWrapper = require('./BufferWrapper');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const RClass = require('./constants').RClass;
const RType = require('./constants').RType;
const RNums = require('./constants').RNums;


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
class ResourceRecord {
  constructor(fields) {
    if (this.constructor === ResourceRecord) throw new Error('Abstract only!');
    if (!fields || !fields.name) throw new Error('Record must have a name');

    this.name    = fields.name;
    this.rrtype  = fields.rrtype  || RType[this.constructor.name];
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
  static fromBuffer(wrapper) {
    const name    = wrapper.readFQDN();
    const rrtype  = wrapper.readUInt16BE();
    const rrclass = wrapper.readUInt16BE();
    const ttl     = wrapper.readUInt32BE();

    // top-bit in rrclass is reused as the cache-flush bit
    const fields = {
      name,
      rrtype,
      rrclass : rrclass & ~0x8000,
      isUnique: !!(rrclass & 0x8000),
      ttl,
    };

    if (rrtype === RType.A)    return new ResourceRecord.A(fields, wrapper);
    if (rrtype === RType.PTR)  return new ResourceRecord.PTR(fields, wrapper);
    if (rrtype === RType.TXT)  return new ResourceRecord.TXT(fields, wrapper);
    if (rrtype === RType.AAAA) return new ResourceRecord.AAAA(fields, wrapper);
    if (rrtype === RType.SRV)  return new ResourceRecord.SRV(fields, wrapper);
    if (rrtype === RType.NSEC) return new ResourceRecord.NSEC(fields, wrapper);

    return new ResourceRecord.Unknown(fields, wrapper);
  }


  /**
   * Makes a couple hashes of record properties so records can get compared
   * easier.
   */
  _makehashes() {
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
  writeTo(wrapper) {
    const classField = (this.isUnique)
      ? this.rrclass | 0x8000
      : this.rrclass;

    // record info
    wrapper.writeFQDN(this.name);
    wrapper.writeUInt16BE(this.rrtype);
    wrapper.writeUInt16BE(classField);
    wrapper.writeUInt32BE(this.ttl);

    // leave UInt16BE gap to write rdataLen
    const rdataLenPos = wrapper.tell();
    wrapper.skip(2);

    // record specific rdata
    this._writeRData(wrapper);

    // go back and add rdata length
    const rdataLen = wrapper.tell() - rdataLenPos - 2;
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
  conflictsWith(record) {
    const hasConflict = (this.isUnique && record.isUnique) &&
                        (this.namehash === record.namehash) &&
                        (this.rdatahash !== record.rdatahash);

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
  canAnswer(question) {
    return (this.rrclass === question.qclass || question.qclass === RClass.ANY) &&
           (this.rrtype === question.qtype || question.qtype === RType.ANY) &&
           (this.name.toUpperCase() === question.name.toUpperCase());
  }


  /**
   * Records are equal if name/type/class and rdata are the same
   */
  equals(record) {
    return (this.hash === record.hash);
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
  compare(record) {
    if (this.equals(record)) return 0;

    if (this.rrclass > record.rrclass) return 1;
    if (this.rrclass < record.rrclass) return -1;

    if (this.rrtype > record.rrtype) return 1;
    if (this.rrtype < record.rrtype) return -1;

    // make buffers out of em so we can compare byte by byte
    // this also prevents data from being name compressed, since
    // we are only writing a single rdata, and nothing else
    const rdata_1 = new BufferWrapper();
    const rdata_2 = new BufferWrapper();

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
  matches(properties) {
    return Object.keys(properties)
      .map(key => [key, properties[key]])
      .every(([key, value]) => {
        return (typeof this[key] === 'string' && typeof value === 'string')
          ? this[key].toUpperCase() === value.toUpperCase()
          : misc.equals(this[key], value);
      });
  }


  /**
   * Returns a clone of the record, making a new object
   */
  clone() {
    const type = this.constructor.name;
    const fields = this;

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
  updateWith(fn) {
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
  canGoodbye() {
    const name = this.name.toLowerCase();
    return (name.indexOf('._dns-sd._udp.') === -1);
  }


  /**
   * Breaks up the record into an array of parts. Used in misc.alignRecords
   * so stuff can get printed nicely in columns. Only ever used in debugging.
   */
  toParts() {
    const parts = [];

    const type = (this.constructor.name === 'Unknown')
      ? this.rrtype
      : this.constructor.name;


    const ttl = (this.ttl === 0) ? misc.color(this.ttl, 'red') : String(this.ttl);

    parts.push(this.name);
    parts.push((this.ttl === 0) ? misc.color(type, 'red') : misc.color(type, 'blue'));

    parts.push(ttl);
    parts.push(String(this._getRDataStr()));

    if (this.isUnique) parts.push(misc.color('(flush)', 'grey'));

    return parts;
  }


  toString() {
    return this.toParts().join(' ');
  }
}


/**
 * A record (IPv4 address)
 */
class A extends ResourceRecord {
  /**
   * @param  {object} fields
   * @param  {BufferWrapper} [wrapper] - only used by the .fromBuffer method
   */
  constructor(fields, wrapper) {
    super(fields);

    // defaults:
    misc.defaults(this, { ttl: 120, isUnique: true });

    // rdata:
    this.address = fields.address || '';

    if (wrapper) this._readRData(wrapper);
    this._makehashes();
  }

  _readRData(wrapper) {
    const _len = wrapper.readUInt16BE();
    const n1 = wrapper.readUInt8();
    const n2 = wrapper.readUInt8();
    const n3 = wrapper.readUInt8();
    const n4 = wrapper.readUInt8();

    this.address = `${n1}.${n2}.${n3}.${n4}`;
  }

  _writeRData(wrapper) {
    this.address.split('.').forEach((str) => {
      const n = parseInt(str, 10);
      wrapper.writeUInt8(n);
    });
  }

  _hashRData() {
    return hash(this.address);
  }

  _getRDataStr() {
    return this.address;
  }
}

ResourceRecord.A = A;


/**
 * PTR record
 */
class PTR extends ResourceRecord {
  constructor(fields, wrapper) {
    super(fields);

    // defaults:
    misc.defaults(this, { ttl: 4500, isUnique: false });

    // rdata:
    this.PTRDName = fields.PTRDName || '';

    if (wrapper) this._readRData(wrapper);
    this._makehashes();
  }

  _readRData(wrapper) {
    const _len = wrapper.readUInt16BE();
    this.PTRDName = wrapper.readFQDN();
  }

  _writeRData(wrapper) {
    wrapper.writeFQDN(this.PTRDName);
  }

  _hashRData() {
    return hash(this.PTRDName);
  }

  _getRDataStr() {
    return this.PTRDName;
  }

}

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
class TXT extends ResourceRecord {
  constructor(fields, wrapper) {
    super(fields);

    // defaults:
    misc.defaults(this, { ttl: 4500, isUnique: true });

    // rdata:
    this.txtRaw = misc.makeRawTXT(fields.txt || {});
    this.txt = misc.makeReadableTXT(fields.txt || {});

    if (wrapper) this._readRData(wrapper);
    this._makehashes();
  }

  _readRData(wrapper) {
    const rdataLength = wrapper.readUInt16BE();
    const end = wrapper.tell() + rdataLength;
    let len;

    // read each key: value pair
    while (wrapper.tell() < end && (len = wrapper.readUInt8())) {
      let key = '';
      let chr, value;

      while (len-- > 0 && (chr = wrapper.readString(1)) !== '=') {
        key += chr;
      }

      if (len > 0)          value = wrapper.read(len);
      else if (chr === '=') value = null;
      else                  value = true;

      this.txtRaw[key] = value;
      this.txt[key] = (Buffer.isBuffer(value)) ? value.toString() : value;
    }
  }

  _writeRData(wrapper) {
    // need to at least put a 0 byte if no txt data
    if (!Object.keys(this.txtRaw).length) {
      return wrapper.writeUInt8(0);
    }

    // value is either true, null, or a buffer
    Object.keys(this.txtRaw).forEach((key) => {
      const value = this.txtRaw[key];
      const str = (value === true) ? key : key + '=';
      let len = Buffer.byteLength(str);

      if (Buffer.isBuffer(value)) len += value.length;

      wrapper.writeUInt8(len);
      wrapper.writeString(str);

      if (Buffer.isBuffer(value)) wrapper.add(value);
    });
  }

  _hashRData() {
    return hash(this.txtRaw);
  }

  _getRDataStr() {
    return misc.truncate(JSON.stringify(this.txt), 30);
  }
}

ResourceRecord.TXT = TXT;


/**
 * AAAA record (IPv6 address)
 */
class AAAA extends ResourceRecord {
  constructor(fields, wrapper) {
    super(fields);

    // defaults:
    misc.defaults(this, { ttl: 120, isUnique: true });

    // rdata:
    this.address = fields.address || '';

    if (wrapper) this._readRData(wrapper);
    this._makehashes();
  }

  _readRData(wrapper) {
    const _len = wrapper.readUInt16BE();
    const raw = wrapper.read(16);
    const parts = [];

    for (let i = 0; i < raw.length; i += 2) {
      parts.push(raw.readUInt16BE(i).toString(16));
    }

    this.address = parts.join(':')
      .replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3')
      .replace(/:{3,4}/, '::');
  }

  _writeRData(wrapper) {

    function expandIPv6(str) {
      let ip = str;

      // replace ipv4 address if any
      const ipv4_match = ip.match(/(.*:)([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$)/);

      if (ipv4_match) {
        ip = ipv4_match[1];
        const ipv4 = ipv4_match[2].match(/[0-9]+/g);

        for (let i = 0; i < 4; i++) {
          ipv4[i] = parseInt(ipv4[i], 10).toString(16);
        }

        ip += ipv4[0] + ipv4[1] + ':' + ipv4[2] + ipv4[3];
      }

      // take care of leading and trailing ::
      ip = ip.replace(/^:|:$/g, '');

      const ipv6 = ip.split(':');

      for (let i = 0; i < ipv6.length; i++) {
        // normalize grouped zeros ::
        if (ipv6[i] === '') {
          ipv6[i] = new Array(9 - ipv6.length).fill(0).join(':');
        }
      }

      return ipv6.join(':');
    }

    expandIPv6(this.address).split(':').forEach((str) => {
      const u16 = parseInt(str, 16);
      wrapper.writeUInt16BE(u16);
    });
  }

  _hashRData() {
    return hash(this.address);
  }

  _getRDataStr() {
    return this.address;
  }
}

ResourceRecord.AAAA = AAAA;


/**
 * SRV record
 */
class SRV extends ResourceRecord {
  constructor(fields, wrapper) {
    super(fields);

    // defaults:
    misc.defaults(this, { ttl: 120, isUnique: true });

    // rdata:
    this.target   = fields.target   || '';
    this.port     = fields.port     || 0;
    this.priority = fields.priority || 0;
    this.weight   = fields.weight   || 0;

    if (wrapper) this._readRData(wrapper);
    this._makehashes();
  }

  _readRData(wrapper) {
    const _len    = wrapper.readUInt16BE();
    this.priority = wrapper.readUInt16BE();
    this.weight   = wrapper.readUInt16BE();
    this.port     = wrapper.readUInt16BE();
    this.target   = wrapper.readFQDN();
  }

  _writeRData(wrapper) {
    wrapper.writeUInt16BE(this.priority);
    wrapper.writeUInt16BE(this.weight);
    wrapper.writeUInt16BE(this.port);
    wrapper.writeFQDN(this.target);
  }

  _hashRData() {
    return hash(this.priority, this.weight, this.port, this.target);
  }

  _getRDataStr() {
    return `${this.target} ${this.port} P:${this.priority} W:${this.weight}`;
  }
}

ResourceRecord.SRV = SRV;


/**
 * NSEC record
 * Only handles the limited 'restricted' form (record rrtypes < 255)
 */
class NSEC extends ResourceRecord {
  constructor(fields, wrapper) {
    super(fields);

    // defaults:
    misc.defaults(this, { ttl: 120, isUnique: true });

    // rdata:
    this.existing = (fields.existing || []).sort((a, b) => a - b);

    if (wrapper) this._readRData(wrapper);
    this._makehashes();
  }

  _readRData(wrapper) {
    const rdataLength = wrapper.readUInt16BE();
    const rdataEnd = wrapper.tell() + rdataLength;

    const _name = wrapper.readFQDN();  // doesn't matter, ignored
    const block = wrapper.readUInt8(); // window block for rrtype bitfield
    const len   = wrapper.readUInt8(); // number of octets in bitfield

    // Ignore rrtypes over 255 (only implementing the restricted form)
    // Bitfield length must always be < 32, otherwise skip parsing
    if (block !== 0 || len > 32) return wrapper.seek(rdataEnd);

    // NSEC rrtype bitfields can be up to 256 bits (32 bytes), BUT
    // - js bitwise operators are only do 32 bits
    // - node's buffer.readIntBE() can only read up to 6 bytes
    //
    // So here we're doing 1 byte of the field at a time
    //
    for (let maskNum = 0; maskNum < len; maskNum++) {
      const mask = wrapper.readUInt8(1);
      if (mask === 0) continue;

      for (let bit = 0; bit < 8; bit++) {
        if (mask & (1 << bit)) {
          // rrtypes in bitfields are in network bit order
          // 01000000 => 1 === RType.A (bit 6)
          // 00000000 00000000 00000000 00001000 => 28 === RType.AAAA (bit 3)
          const rrtype = (8 * maskNum) + (7 - bit);
          this.existing.push(rrtype);
        }
      }
    }
  }

  _writeRData(wrapper) {
    // restricted form, only rrtypes up to 255
    const rrtypes = [...new Set(this.existing)].filter(x => x <= 255);

    // Same problems as _readRData, 32 bit operators and can't write big ints,
    // so bitfields are broken up into 1 byte segments and handled one at a time
    const len = (!rrtypes.length) ? 0 : (Math.ceil(Math.max(...rrtypes) / 8));
    const masks = Array(len).fill(0);

    rrtypes.forEach((rrtype) => {
      const index = ~~(rrtype / 8); // which mask this rrtype is on
      const bit = 7 - (rrtype % 8); // convert to network bit order

      masks[index] |= (1 << bit);
    });

    wrapper.writeFQDN(this.name); // "next domain name", ignored for mdns
    wrapper.writeUInt8(0);        // block number, always 0 for restricted form
    wrapper.writeUInt8(len);      // bitfield length in octets

    // write masks byte by byte since node buffers can only write 42 bit numbers
    masks.forEach(mask => wrapper.writeUInt8(mask));
  }

  _hashRData() {
    return hash(this.existing);
  }

  _getRDataStr() {
    return this.existing.map(rrtype => RNums[rrtype] || rrtype).join(', ');
  }
}

ResourceRecord.NSEC = NSEC;


/**
 * Unknown record, anything not describe above. Could be OPT records, etc.
 */
class Unknown extends ResourceRecord {
  constructor(fields, wrapper) {
    super(fields);

    // defaults:
    misc.defaults(this, { ttl: 120, isUnique: true });

    // rdata:
    this.rdata = fields.rdata || Buffer.alloc(0);

    if (wrapper) this._readRData(wrapper);
    this._makehashes();
  }

  _readRData(wrapper) {
    const rdataLength = wrapper.readUInt16BE();
    this.RData = wrapper.read(rdataLength);
  }

  _writeRData(wrapper) {
    wrapper.add(this.RData);
  }

  _hashRData() {
    return hash(this.RData);
  }

  _getRDataStr() {
    // replace non-ascii characters w/ gray dots
    function ascii(chr) {
      return (/[ -~]/.test(chr)) ? chr : misc.color('.', 'grey');
    }

    const chars = this.RData.toString().split('');
    const str = chars.slice(0, 30).map(ascii).join('');

    return (chars.length <= 30) ? str : str + '…';
  }
}

ResourceRecord.Unknown = Unknown;


module.exports = ResourceRecord;
