'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var misc = require('./misc');
var hash = require('./hash');

var RClass = require('./constants').RClass;
var RType = require('./constants').RType;
var RNums = require('./constants').RNums;

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

var QueryRecord = function () {
  function QueryRecord(fields) {
    _classCallCheck(this, QueryRecord);

    this.name = fields.name;
    this.qtype = fields.qtype || RType.ANY;
    this.qclass = fields.qclass || RClass.IN;
    this.QU = fields.QU || false;

    // for comparing queries and answers:
    this.hash = hash(this.name, this.qtype, this.qclass);
    this.namehash = this.hash;
  }

  /**
   * @param  {BufferWrapper} wrapper
   * @return {QueryRecord}
   */


  _createClass(QueryRecord, [{
    key: 'writeTo',


    /**
     * @param {BufferWrapper} wrapper
     */
    value: function writeTo(wrapper) {
      // flip top bit of qclass to indicate a QU question
      var classField = this.QU ? this.qclass | 0x8000 : this.qclass;

      wrapper.writeFQDN(this.name);
      wrapper.writeUInt16BE(this.qtype);
      wrapper.writeUInt16BE(classField);
    }

    /**
     * Check if a query recrod is the exact same as this one (ANY doesn't count)
     */

  }, {
    key: 'equals',
    value: function equals(queryRecord) {
      return this.hash === queryRecord.hash;
    }

    /**
     * Breaks up the record into an array of parts. Used in misc.alignRecords
     * so stuff can get printed nicely in columns. Only ever used in debugging.
     */

  }, {
    key: 'toParts',
    value: function toParts() {
      var type = RNums[this.qtype] || this.qtype;

      return [this.name, misc.color(type, 'blue'), this.QU ? misc.color('QU', 'yellow') : 'QM'];
    }
  }, {
    key: 'toString',
    value: function toString() {
      return this.toParts().join(' ');
    }
  }], [{
    key: 'fromBuffer',
    value: function fromBuffer(wrapper) {
      var fields = {};
      fields.name = wrapper.readFQDN();
      fields.qtype = wrapper.readUInt16BE();

      // top bit of rrclass field reused as QU/QM bit
      var classBit = wrapper.readUInt16BE();
      fields.qclass = classBit & ~0x8000;
      fields.QU = !!(classBit & 0x8000);

      return new QueryRecord(fields);
    }
  }]);

  return QueryRecord;
}();

module.exports = QueryRecord;