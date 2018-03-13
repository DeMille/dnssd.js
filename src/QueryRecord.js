const misc = require('./misc');
const hash = require('./hash');

const RClass = require('./constants').RClass;
const RType = require('./constants').RType;
const RNums = require('./constants').RNums;


/**
 * Create/parse query records
 * @class
 *
 * Create a new QueryRecord:
 * > const record = new QueryRecord({name: 'Target.local.'});
 *
 * Parse a QueryRecord from a buffer (a wrapped buffer):
 * > const record = QueryRecord.fromBuffer(wrapper);
 *
 */
class QueryRecord {
  constructor(fields) {
    this.name   = fields.name;
    this.qtype  = fields.qtype  || RType.ANY;
    this.qclass = fields.qclass || RClass.IN;
    this.QU     = fields.QU     || false;

    // for comparing queries and answers:
    this.hash = hash(this.name, this.qtype, this.qclass);
    this.namehash = this.hash;
  }

  /**
   * @param  {BufferWrapper} wrapper
   * @return {QueryRecord}
   */
  static fromBuffer(wrapper) {
    const fields = {};
    fields.name   = wrapper.readFQDN();
    fields.qtype  = wrapper.readUInt16BE();

    // top bit of rrclass field reused as QU/QM bit
    const classBit  = wrapper.readUInt16BE();
    fields.qclass = classBit & ~0x8000;
    fields.QU     = !!(classBit & 0x8000);

    return new QueryRecord(fields);
  }

  /**
   * @param {BufferWrapper} wrapper
   */
  writeTo(wrapper) {
    // flip top bit of qclass to indicate a QU question
    const classField = (this.QU)
      ? this.qclass | 0x8000
      : this.qclass;

    wrapper.writeFQDN(this.name);
    wrapper.writeUInt16BE(this.qtype);
    wrapper.writeUInt16BE(classField);
  }

  /**
   * Check if a query recrod is the exact same as this one (ANY doesn't count)
   */
  equals(queryRecord) {
    return (this.hash === queryRecord.hash);
  }

  /**
   * Breaks up the record into an array of parts. Used in misc.alignRecords
   * so stuff can get printed nicely in columns. Only ever used in debugging.
   */
  toParts() {
    const type = RNums[this.qtype] || this.qtype;

    return [
      this.name,
      misc.color(type, 'blue'),
      (this.QU) ? misc.color('QU', 'yellow') : 'QM',
    ];
  }

  toString() {
    return this.toParts().join(' ');
  }
}


module.exports = QueryRecord;
