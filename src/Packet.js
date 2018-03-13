const os = require('os');
const util = require('util');

const misc = require('./misc');
const QueryRecord = require('./QueryRecord');
const ResourceRecord = require('./ResourceRecord');
const BufferWrapper = require('./BufferWrapper');
const RecordCollection = require('./RecordCollection');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);


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
class Packet {
  /**
   * @param  {Buffer} [buffer] - optional buffer to parse
   * @param  {Object} [origin] - optional msg info
   */
  constructor(buffer, origin = {}) {
    this.header = {
      ID     : 0,
      QR     : 0,
      OPCODE : 0,
      AA     : 0,
      TC     : 0,
      RD     : 0,
      RA     : 0,
      Z      : 0,
      AD     : 0,
      CD     : 0,
      RCODE  : 0,
      QDCount: 0,
      ANCount: 0,
      NSCount: 0,
      ARCount: 0,
    };

    this.questions   = [];
    this.answers     = [];
    this.authorities = [];
    this.additionals = [];

    this.origin = {
      address: origin.address,
      port   : origin.port,
    };

    // wrap parse in try/catch because it could throw
    // if it does, make packet.isValid() always return false
    if (buffer) {
      try {
        this.parseBuffer(buffer);
      } catch (err) {
        debug(`Packet parse error: ${err} \n${err.stack}`);
        this.isValid = () => false;
      }
    }
  }

  parseBuffer(buffer) {
    const wrapper = new BufferWrapper(buffer);

    const readQuestion = () => QueryRecord.fromBuffer(wrapper);
    const readRecord   = () => ResourceRecord.fromBuffer(wrapper);

    this.header = this.parseHeader(wrapper);

    this.questions   = misc.map_n(readQuestion, this.header.QDCount);
    this.answers     = misc.map_n(readRecord, this.header.ANCount);
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
  parseHeader(wrapper) {
    const header = {};

    header.ID = wrapper.readUInt16BE();
    const flags = wrapper.readUInt16BE();

    header.QR     = (flags & (1   << 15)) >> 15;
    header.OPCODE = (flags & (0xF << 11)) >> 11;
    header.AA     = (flags & (1   << 10)) >> 10;
    header.TC     = (flags & (1   << 9))  >> 9;
    header.RD     = 0;
    header.RA     = 0;
    header.Z      = 0;
    header.AD     = 0;
    header.CD     = 0;
    header.RCODE  = (flags & 0xF);

    header.QDCount = wrapper.readUInt16BE();
    header.ANCount = wrapper.readUInt16BE();
    header.NSCount = wrapper.readUInt16BE();
    header.ARCount = wrapper.readUInt16BE();

    return header;
  }

  toBuffer() {
    const wrapper = new BufferWrapper();
    const writeRecord = record => record.writeTo(wrapper);

    this.writeHeader(wrapper);

    this.questions.forEach(writeRecord);
    this.answers.forEach(writeRecord);
    this.authorities.forEach(writeRecord);
    this.additionals.forEach(writeRecord);

    return wrapper.unwrap();
  }

  writeHeader(wrapper) {
    const flags = 0
      + (this.header.QR     << 15)
      + (this.header.OPCODE << 11)
      + (this.header.AA     << 10)
      + (this.header.TC     << 9)
      + (this.header.RD     << 8)
      + (this.header.RA     << 7)
      + (this.header.Z      << 6)
      + (this.header.AD     << 5)
      + (this.header.CD     << 4)
      + this.header.RCODE;

    wrapper.writeUInt16BE(this.header.ID);
    wrapper.writeUInt16BE(flags);

    wrapper.writeUInt16BE(this.questions.length);   // QDCount
    wrapper.writeUInt16BE(this.answers.length);     // ANCount
    wrapper.writeUInt16BE(this.authorities.length); // NSCount
    wrapper.writeUInt16BE(this.additionals.length); // ARCount
  }

  setQuestions(questions) {
    this.questions = questions;
    this.header.QDCount = this.questions.length;
  }

  setAnswers(answers) {
    this.answers = answers;
    this.header.ANCount = this.answers.length;
  }

  setAuthorities(authorities) {
    this.authorities = authorities;
    this.header.NSCount = this.authorities.length;
  }

  setAdditionals(additionals) {
    this.additionals = additionals;
    this.header.ARCount = this.additionals.length;
  }

  setResponseBit() {
    this.header.QR = 1; // response
    this.header.AA = 1; // authoritative (all responses must be)
  }

  isValid() {
    return this.header.OPCODE === 0 &&
           this.header.RCODE  === 0 &&
           (!this.isAnswer() || this.header.AA === 1); // must be authoritative
  }

  isEmpty() {
    return (this.isAnswer())
      ? !this.answers.length    // responses have to have answers
      : !this.questions.length; // queries/probes have to have questions
  }

  isLegacy() {
    return (!!this.origin.port && this.origin.port !== 5353);
  }

  isLocal() {
    return !!this.origin.address &&
      [].concat(...Object.values(os.networkInterfaces()))
        .some(({ address }) => address === this.origin.address);
  }

  isProbe() {
    return !!(!this.header.QR && this.authorities.length);
  }

  isQuery() {
    return !!(!this.header.QR && !this.authorities.length);
  }

  isAnswer() {
    return !!(this.header.QR);
  }

  equals(other) {
    return misc.equals(this.header, other.header) &&
      (new RecordCollection(this.questions)).equals(other.questions) &&
      (new RecordCollection(this.answers)).equals(other.answers) &&
      (new RecordCollection(this.additionals)).equals(other.additionals) &&
      (new RecordCollection(this.authorities)).equals(other.authorities);
  }

  split() {
    const one = new Packet();
    const two = new Packet();

    one.header = Object.assign({}, this.header);
    two.header = Object.assign({}, this.header);

    if (this.isQuery()) {
      one.header.TC = 1;

      one.setQuestions(this.questions);
      two.setQuestions([]);

      one.setAnswers(this.answers.slice(0, Math.ceil(this.answers.length/2)));
      two.setAnswers(this.answers.slice(Math.ceil(this.answers.length/2)));
    }

    if (this.isAnswer()) {
      one.setAnswers(this.answers.slice(0, Math.ceil(this.answers.length/2)));
      two.setAnswers(this.answers.slice(Math.ceil(this.answers.length/2)));

      one.setAdditionals([].concat(...one.answers.map(a => a.additionals)));
      two.setAdditionals([].concat(...two.answers.map(a => a.additionals)));
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
  toString() {
    let str = '';

    if (this.isAnswer()) str += misc.bg(' ANSWER ', 'blue', true)   + '\n';
    if (this.isProbe())  str += misc.bg(' PROBE ', 'magenta', true) + '\n';
    if (this.isQuery())  str += misc.bg(' QUERY ', 'yellow', true)  + '\n';

    const recordGroups = [];
    const aligned = misc.alignRecords(this.questions, this.answers,
      this.authorities, this.additionals);

    if (this.questions.length)   recordGroups.push(['Questions', aligned[0]]);
    if (this.answers.length)     recordGroups.push(['Answer RRs', aligned[1]]);
    if (this.authorities.length) recordGroups.push(['Authority RRs', aligned[2]]);
    if (this.additionals.length) recordGroups.push(['Additional RRs', aligned[3]]);

    recordGroups.forEach(([name, records], i) => {
      const isLastSection = (i === recordGroups.length-1);

      // add record group header
      str += util.format('    %s─┬ %s [%s]\n',
        (isLastSection) ? '└' : '├',
        name,
        records.length);

      // add record strings
      records.forEach((record, j) => {
        const isLastRecord = (j === records.length-1);

        str += util.format('    %s %s── %s\n',
          (isLastSection) ? ' ' : '│',
          (isLastRecord)  ? '└' : '├',
          record);
      });
    });

    return str;
  }
}


module.exports = Packet;
