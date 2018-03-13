'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var os = require('os');
var util = require('util');

var misc = require('./misc');
var QueryRecord = require('./QueryRecord');
var ResourceRecord = require('./ResourceRecord');
var BufferWrapper = require('./BufferWrapper');
var RecordCollection = require('./RecordCollection');

var filename = require('path').basename(__filename);
var debug = require('./debug')('dnssd:' + filename);

/**
 * mDNS Packet
 * @class
 *
 * Make new empty packets with `new Packet()`
 * or parse a packet from a buffer with `new Packet(buffer)`
 *
 * Check if there were problems parsing a buffer by checking `packet.isValid()`
 * isValid() will return false if buffer parsing failed or if something is wrong
 * with the packet's header.
 *
 */

var Packet = function () {
  /**
   * @param  {Buffer} [buffer] - optional buffer to parse
   * @param  {Object} [origin] - optional msg info
   */
  function Packet(buffer) {
    var origin = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, Packet);

    this.header = {
      ID: 0,
      QR: 0,
      OPCODE: 0,
      AA: 0,
      TC: 0,
      RD: 0,
      RA: 0,
      Z: 0,
      AD: 0,
      CD: 0,
      RCODE: 0,
      QDCount: 0,
      ANCount: 0,
      NSCount: 0,
      ARCount: 0
    };

    this.questions = [];
    this.answers = [];
    this.authorities = [];
    this.additionals = [];

    this.origin = {
      address: origin.address,
      port: origin.port
    };

    // wrap parse in try/catch because it could throw
    // if it does, make packet.isValid() always return false
    if (buffer) {
      try {
        this.parseBuffer(buffer);
      } catch (err) {
        debug('Packet parse error: ' + err + ' \n' + err.stack);
        this.isValid = function () {
          return false;
        };
      }
    }
  }

  _createClass(Packet, [{
    key: 'parseBuffer',
    value: function parseBuffer(buffer) {
      var wrapper = new BufferWrapper(buffer);

      var readQuestion = function readQuestion() {
        return QueryRecord.fromBuffer(wrapper);
      };
      var readRecord = function readRecord() {
        return ResourceRecord.fromBuffer(wrapper);
      };

      this.header = this.parseHeader(wrapper);

      this.questions = misc.map_n(readQuestion, this.header.QDCount);
      this.answers = misc.map_n(readRecord, this.header.ANCount);
      this.authorities = misc.map_n(readRecord, this.header.NSCount);
      this.additionals = misc.map_n(readRecord, this.header.ARCount);
    }

    /**
     * Header:
     * +----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
     * | 1  | 2  | 3  | 4  | 5  | 6  | 7  | 8  | 9  | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
     * +----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
     * |                                 Identifier                                    |
     * +----+-------------------+----+----+----+----+----+----+----+-------------------+
     * | QR |      OPCODE       | AA | TC | RD | RA | Z  | AD | CD |       RCODE       |
     * +----+-------------------+----+----+----+----+----+----+----+-------------------+
     * |                        QDCount (Number of questions)                          |
     * +-------------------------------------------------------------------------------+
     * |                      ANCount (Number of answer records)                       |
     * +-------------------------------------------------------------------------------+
     * |                     NSCount (Number of authority records)                     |
     * +-------------------------------------------------------------------------------+
     * |                    ARCount (Number of additional records)                     |
     * +-------------------------------------------------------------------------------+
     *
     * For mDNS, RD, RA, Z, AD and CD MUST be zero on transmission, and MUST be ignored
     * on reception. Responses with OPCODEs or RCODEs =/= 0 should be silently ignored.
     */

  }, {
    key: 'parseHeader',
    value: function parseHeader(wrapper) {
      var header = {};

      header.ID = wrapper.readUInt16BE();
      var flags = wrapper.readUInt16BE();

      header.QR = (flags & 1 << 15) >> 15;
      header.OPCODE = (flags & 0xF << 11) >> 11;
      header.AA = (flags & 1 << 10) >> 10;
      header.TC = (flags & 1 << 9) >> 9;
      header.RD = 0;
      header.RA = 0;
      header.Z = 0;
      header.AD = 0;
      header.CD = 0;
      header.RCODE = flags & 0xF;

      header.QDCount = wrapper.readUInt16BE();
      header.ANCount = wrapper.readUInt16BE();
      header.NSCount = wrapper.readUInt16BE();
      header.ARCount = wrapper.readUInt16BE();

      return header;
    }
  }, {
    key: 'toBuffer',
    value: function toBuffer() {
      var wrapper = new BufferWrapper();
      var writeRecord = function writeRecord(record) {
        return record.writeTo(wrapper);
      };

      this.writeHeader(wrapper);

      this.questions.forEach(writeRecord);
      this.answers.forEach(writeRecord);
      this.authorities.forEach(writeRecord);
      this.additionals.forEach(writeRecord);

      return wrapper.unwrap();
    }
  }, {
    key: 'writeHeader',
    value: function writeHeader(wrapper) {
      var flags = 0 + (this.header.QR << 15) + (this.header.OPCODE << 11) + (this.header.AA << 10) + (this.header.TC << 9) + (this.header.RD << 8) + (this.header.RA << 7) + (this.header.Z << 6) + (this.header.AD << 5) + (this.header.CD << 4) + this.header.RCODE;

      wrapper.writeUInt16BE(this.header.ID);
      wrapper.writeUInt16BE(flags);

      wrapper.writeUInt16BE(this.questions.length); // QDCount
      wrapper.writeUInt16BE(this.answers.length); // ANCount
      wrapper.writeUInt16BE(this.authorities.length); // NSCount
      wrapper.writeUInt16BE(this.additionals.length); // ARCount
    }
  }, {
    key: 'setQuestions',
    value: function setQuestions(questions) {
      this.questions = questions;
      this.header.QDCount = this.questions.length;
    }
  }, {
    key: 'setAnswers',
    value: function setAnswers(answers) {
      this.answers = answers;
      this.header.ANCount = this.answers.length;
    }
  }, {
    key: 'setAuthorities',
    value: function setAuthorities(authorities) {
      this.authorities = authorities;
      this.header.NSCount = this.authorities.length;
    }
  }, {
    key: 'setAdditionals',
    value: function setAdditionals(additionals) {
      this.additionals = additionals;
      this.header.ARCount = this.additionals.length;
    }
  }, {
    key: 'setResponseBit',
    value: function setResponseBit() {
      this.header.QR = 1; // response
      this.header.AA = 1; // authoritative (all responses must be)
    }
  }, {
    key: 'isValid',
    value: function isValid() {
      return this.header.OPCODE === 0 && this.header.RCODE === 0 && (!this.isAnswer() || this.header.AA === 1); // must be authoritative
    }
  }, {
    key: 'isEmpty',
    value: function isEmpty() {
      return this.isAnswer() ? !this.answers.length // responses have to have answers
      : !this.questions.length; // queries/probes have to have questions
    }
  }, {
    key: 'isLegacy',
    value: function isLegacy() {
      return !!this.origin.port && this.origin.port !== 5353;
    }
  }, {
    key: 'isLocal',
    value: function isLocal() {
      var _ref,
          _this = this;

      return !!this.origin.address && (_ref = []).concat.apply(_ref, _toConsumableArray(Object.values(os.networkInterfaces()))).some(function (_ref2) {
        var address = _ref2.address;
        return address === _this.origin.address;
      });
    }
  }, {
    key: 'isProbe',
    value: function isProbe() {
      return !!(!this.header.QR && this.authorities.length);
    }
  }, {
    key: 'isQuery',
    value: function isQuery() {
      return !!(!this.header.QR && !this.authorities.length);
    }
  }, {
    key: 'isAnswer',
    value: function isAnswer() {
      return !!this.header.QR;
    }
  }, {
    key: 'equals',
    value: function equals(other) {
      return misc.equals(this.header, other.header) && new RecordCollection(this.questions).equals(other.questions) && new RecordCollection(this.answers).equals(other.answers) && new RecordCollection(this.additionals).equals(other.additionals) && new RecordCollection(this.authorities).equals(other.authorities);
    }
  }, {
    key: 'split',
    value: function split() {
      var one = new Packet();
      var two = new Packet();

      one.header = Object.assign({}, this.header);
      two.header = Object.assign({}, this.header);

      if (this.isQuery()) {
        one.header.TC = 1;

        one.setQuestions(this.questions);
        two.setQuestions([]);

        one.setAnswers(this.answers.slice(0, Math.ceil(this.answers.length / 2)));
        two.setAnswers(this.answers.slice(Math.ceil(this.answers.length / 2)));
      }

      if (this.isAnswer()) {
        var _ref3, _ref4;

        one.setAnswers(this.answers.slice(0, Math.ceil(this.answers.length / 2)));
        two.setAnswers(this.answers.slice(Math.ceil(this.answers.length / 2)));

        one.setAdditionals((_ref3 = []).concat.apply(_ref3, _toConsumableArray(one.answers.map(function (a) {
          return a.additionals;
        }))));
        two.setAdditionals((_ref4 = []).concat.apply(_ref4, _toConsumableArray(two.answers.map(function (a) {
          return a.additionals;
        }))));
      }

      // if it can't split packet, just return empties and hope for the best...
      return [one, two];
    }

    /**
     * Makes a nice string for looking at packets. Makes something like:
     *
     * ANSWER
     * ├─┬ Questions[2]
     * │ └── record.local. ANY  QM
     * ├─┬ Answer RRs[1]
     * │ └── record.local. A ...
     * ├─┬ Authority RRs[1]
     * │ └── record.local. A ...
     * └─┬ Additional RRs[1]
     *   └── record.local. A ...
     */

  }, {
    key: 'toString',
    value: function toString() {
      var str = '';

      if (this.isAnswer()) str += misc.bg(' ANSWER ', 'blue', true) + '\n';
      if (this.isProbe()) str += misc.bg(' PROBE ', 'magenta', true) + '\n';
      if (this.isQuery()) str += misc.bg(' QUERY ', 'yellow', true) + '\n';

      var recordGroups = [];
      var aligned = misc.alignRecords(this.questions, this.answers, this.authorities, this.additionals);

      if (this.questions.length) recordGroups.push(['Questions', aligned[0]]);
      if (this.answers.length) recordGroups.push(['Answer RRs', aligned[1]]);
      if (this.authorities.length) recordGroups.push(['Authority RRs', aligned[2]]);
      if (this.additionals.length) recordGroups.push(['Additional RRs', aligned[3]]);

      recordGroups.forEach(function (_ref5, i) {
        var _ref6 = _slicedToArray(_ref5, 2),
            name = _ref6[0],
            records = _ref6[1];

        var isLastSection = i === recordGroups.length - 1;

        // add record group header
        str += util.format('    %s─┬ %s [%s]\n', isLastSection ? '└' : '├', name, records.length);

        // add record strings
        records.forEach(function (record, j) {
          var isLastRecord = j === records.length - 1;

          str += util.format('    %s %s── %s\n', isLastSection ? ' ' : '│', isLastRecord ? '└' : '├', record);
        });
      });

      return str;
    }
  }]);

  return Packet;
}();

module.exports = Packet;