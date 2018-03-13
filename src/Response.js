const Packet = require('./Packet');
const EventEmitter = require('./EventEmitter');
const RecordCollection = require('./RecordCollection');
const TimerContainer = require('./TimerContainer');
const sleep = require('./sleep');
const misc = require('./misc');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const RType = require('./constants').RType;
const ONE_SECOND = 1000;

let counter = 0;
const uniqueId = () => `id#${++counter}`;


/**
 * Creates a new MulticastResponse
 * @class
 * @extends EventEmitter
 *
 * Sends out a multicast response of records on a given interface. Responses
 * can be set to repeat multiple times.
 *
 * @emits 'stopped'
 *
 * @param {NetworkInterface} intf - the interface the response will work on
 * @param {EventEmitter}     offswitch - emitter used to shut this response down
 */
function MulticastResponse(intf, offswitch) {
  EventEmitter.call(this);

  // id only used for figuring out logs
  this._id = uniqueId();
  debug(`Creating new response (${this._id})`);

  this._intf = intf;
  this._offswitch = offswitch;
  this._answers = new RecordCollection();
  this._isStopped = false;

  // defaults
  this._repeats = 1;
  this._delay = 0;
  this._isDefensive = false;

  // repeat responses, first at 1s apart, then increasing by a factor of 2
  this._next = ONE_SECOND;
  this._timers = new TimerContainer(this);

  // listen to answers on interface to suppress duplicate answers
  // stop on either the offswitch of an interface error
  intf.using(this)
    .on('answer', this._onAnswer)
    .once('error', this.stop);

  // waking from sleep should cause the response to stop too
  sleep.using(this).on('wake', this.stop);
  offswitch.using(this).once('stop', this.stop);
}

MulticastResponse.prototype = Object.create(EventEmitter.prototype);
MulticastResponse.prototype.constructor = MulticastResponse;


/**
 * Adds records to be sent out.
 * @param {ResourceRecords|ResourceRecords[]} arg
 */
MulticastResponse.prototype.add = function(arg) {
  const records = Array.isArray(arg) ? arg : [arg];

  // In any case where there may be multiple responses, like when all outgoing
  // records are non-unique (like PTRs) response should be delayed 20-120 ms.
  this._delay = records.some(record => !record.isUnique) ? misc.random(20, 120) : 0;
  this._answers.addEach(records);

  return this;
};


MulticastResponse.prototype.repeat = function(num) {
  this._repeats = num;
  return this;
};


/**
 * Some responses are 'defensive' in that they are responding to probes or
 * correcting some problem like an erroneous TTL=0.
 */
MulticastResponse.prototype.defensive = function(bool) {
  this._isDefensive = !!bool;
  return this;
};


/**
 * Starts sending out records.
 */
MulticastResponse.prototype.start = function() {
  // remove delay for defensive responses
  const delay = (this._isDefensive) ? 0 : this._delay;

  // prepare next outgoing packet in advance while listening to other answers
  // on the interface so duplicate answers in this packet can be suppressed.
  this._queuedPacket = this._makePacket();
  this._timers.setLazy('next-response', this._send, delay);

  return this;
};


/**
 * Stops the response & cleans up after itself.
 * @emits 'stopped' event when done
 */
MulticastResponse.prototype.stop = function() {
  if (this._isStopped) return;

  debug(`Response stopped (${this._id})`);
  this._isStopped = true;

  this._timers.clear();

  this._intf.removeListenersCreatedBy(this);
  this._offswitch.removeListenersCreatedBy(this);
  sleep.removeListenersCreatedBy(this);

  this.emit('stopped');
};


/**
 * Sends the response packets.
 *
 * socket.send() has a callback to know when the response was actually sent.
 * Responses shut down after repeats run out.
 */
MulticastResponse.prototype._send = function() {
  this._repeats--;
  debug(`Sending response, ${this._repeats} repeats left (${this._id})`);

  const packet = this._suppressRecents(this._queuedPacket);

  // send packet, stop when all responses have been sent
  this._intf.send(packet, null, () => {
    if (this._repeats <= 0) this.stop();
  });

  // reschedule the next response if needed. the packet is prepared in advance
  // so incoming responses can be checked for duplicate answers.
  if (this._repeats > 0) {
    this._queuedPacket = this._makePacket();
    this._timers.setLazy('next-response', this._send, this._next);

    // each successive response increases delay by a factor of 2
    this._next *= 2;
  }
};


/**
 * Create a response packet.
 * @return {Packet}
 */
MulticastResponse.prototype._makePacket = function() {
  const packet = new Packet();
  const additionals = new RecordCollection();

  this._answers.forEach((answer) => {
    additionals.addEach(answer.additionals);
  });

  packet.setResponseBit();
  packet.setAnswers(this._answers.toArray());
  packet.setAdditionals(additionals.difference(this._answers).toArray());

  return packet;
};


/**
 * Removes recently sent records from the outgoing packet
 *
 * Check the interface to for each outbound record. Records are limited to
 * being sent to the multicast address once every 1s except for probe responses
 * (and other defensive responses) that can be sent every 250ms.
 *
 * @param  {Packet} packet - the outgoing packet
 * @return {Packet}
 */
MulticastResponse.prototype._suppressRecents = function(packet) {
  const range = (this._isDefensive) ? 0.25 : 1.0;

  const answers = packet.answers.filter(record =>
    !this._intf.hasRecentlySent(record, range));

  const suppressed = packet.answers.filter(a => !~answers.indexOf(a));

  if (suppressed.length) {
    debug('Suppressing recently sent (%s): %r', this._id, suppressed);
    packet.setAnswers(answers);
  }

  return packet;
};


/**
 * Handles incoming answer (response) packets
 *
 * This is solely used to do duplicate answer suppression (7.4). If another
 * responder has sent the same answer as one this response is about to send,
 * this response can suppress that answer since someone else already sent it.
 * Modifies the next scheduled response packet only (this._queuedPacket).
 *
 * Note: this handle will receive this response's packets too
 *
 * @param {Packet} packet - the incoming probe packet
 */
MulticastResponse.prototype._onAnswer = function(packet) {
  if (this._isStopped) return;

  // prevent this response from accidentally suppressing itself
  // (ignore packets that came from this interface)
  if (packet.isLocal()) return;

  // ignore goodbyes in suppression check
  const incoming = packet.answers.filter(answer => answer.ttl !== 0);
  const outgoing = this._queuedPacket.answers;

  // suppress outgoing answers that also appear in incoming records
  const answers = (new RecordCollection(outgoing)).difference(incoming).toArray();
  const suppressed = outgoing.filter(out => !~answers.indexOf(out));

  if (suppressed.length) {
    debug('Suppressing duplicate answers (%s): %r', this._id, suppressed);
    this._queuedPacket.setAnswers(answers);
  }
};


/**
 * Creates a new GoodbyeResponse
 * @class
 * @extends MulticastResponse
 *
 * Sends out a multicast response of records that are now dead on an interface.
 * Goodbyes can be set to repeat multiple times.
 *
 * @emits 'stopped'
 *
 * @param {NetworkInterface} intf - the interface the response will work on
 * @param {EventEmitter}     offswitch - emitter used to shut this response down
 */
function GoodbyeResponse(intf, offswitch) {
  MulticastResponse.call(this, intf, offswitch);
  debug('└─ a goodbye response');
}

GoodbyeResponse.prototype = Object.create(MulticastResponse.prototype);
GoodbyeResponse.constructor = GoodbyeResponse;

/**
 * Makes a goodbye packet
 * @return {Packet}
 */
GoodbyeResponse.prototype._makePacket = function() {
  const packet = new Packet();

  // Records getting goodbye'd need a TTL=0
  // Clones are used so original records (held elsewhere) don't get mutated
  const answers = this._answers.map((record) => {
    const clone = record.clone();
    clone.ttl = 0;
    return clone;
  });

  packet.setResponseBit();
  packet.setAnswers(answers);

  return packet;
};

// Don't suppress recents on goodbyes, return provided packet unchanged
GoodbyeResponse.prototype._suppressRecents = p => p;

// Don't do answer suppression on goodbyes
GoodbyeResponse.prototype._onAnswer = () => {};


/**
 * Creates a new UnicastResponse
 * @class
 * @extends EventEmitter
 *
 * Sends out a unicast response to a destination. There are two types of
 * unicast responses here:
 *   - direct responses to QU questions (mDNS rules)
 *   - legacy responses (normal DNS packet rules)
 *
 * @emits 'stopped'
 *
 * @param {NetworkInterface} intf - the interface the response will work on
 * @param {EventEmitter}     offswitch - emitter used to shut this response down
 */
function UnicastResponse(intf, offswitch) {
  EventEmitter.call(this);

  // id only used for figuring out logs
  this._id = uniqueId();
  debug(`Creating a new unicast response (${this._id})`);

  this._intf = intf;
  this._offswitch = offswitch;
  this._answers = new RecordCollection();
  this._timers = new TimerContainer(this);

  // defaults
  this._delay = 0;
  this._isDefensive = false;

  // unicast & legacy specific
  this._destination = {};
  this._isLegacy = false;
  this._headerID = null;
  this._questions = null;

  // stops on offswitch event or interface errors
  intf.using(this).once('error', this.stop);
  offswitch.using(this).once('stop', this.stop);
  sleep.using(this).on('wake', this.stop);
}

UnicastResponse.prototype = Object.create(EventEmitter.prototype);
UnicastResponse.prototype.constructor = UnicastResponse;


/**
 * Adds records to be sent out.
 * @param {ResourceRecords|ResourceRecords[]} arg
 */
UnicastResponse.prototype.add = function(arg) {
  const records = Array.isArray(arg) ? arg : [arg];

  // In any case where there may be multiple responses, like when all outgoing
  // records are non-unique (like PTRs) response should be delayed 20-120 ms.
  this._delay = records.some(record => !record.isUnique) ? misc.random(20, 120) : 0;
  this._answers.addEach(records);

  return this;
};


UnicastResponse.prototype.defensive = function(bool) {
  this._isDefensive = !!bool;
  return this;
};


/**
 * Sets destination info based on the query packet this response is addressing.
 * Legacy responses will have to keep the questions and the packet ID for later.
 *
 * @param {Packet} packet - query packet to respond to
 */
UnicastResponse.prototype.respondTo = function(packet) {
  this._destination.port = packet.origin.port;
  this._destination.address = packet.origin.address;

  if (packet.isLegacy()) {
    debug(`preparing legacy response (${this._id})`);

    this._isLegacy = true;
    this._headerID = packet.header.ID;
    this._questions = packet.questions;

    this._questions.forEach((question) => {
      question.QU = false;
    });
  }

  return this;
};


/**
 * Sends response packet to destination. Stops when packet has been sent.
 * No delay for defensive or legacy responses.
 */
UnicastResponse.prototype.start = function() {
  const packet = this._makePacket();
  const delay = (this._isDefensive || this._isLegacy) ? 0 : this._delay;

  this._timers.setLazy(() => {
    debug(`Sending unicast response (${this._id})`);

    this._intf.send(packet, this._destination, () => this.stop());
  }, delay);

  return this;
};


/**
 * Stops response and cleans up.
 * @emits 'stopped' event when done
 */
UnicastResponse.prototype.stop = function() {
  if (this._isStopped) return;

  debug(`Unicast response stopped (${this._id})`);
  this._isStopped = true;

  this._timers.clear();

  this._intf.removeListenersCreatedBy(this);
  this._offswitch.removeListenersCreatedBy(this);
  sleep.removeListenersCreatedBy(this);

  this.emit('stopped');
};


/**
 * Makes response packet. Legacy response packets need special treatment.
 * @return {Packet}
 */
UnicastResponse.prototype._makePacket = function() {
  const packet = new Packet();

  let answers = this._answers.toArray();
  let additionals = answers
    .reduce((result, answer) => result.concat(answer.additionals), [])
    .filter(add => !~answers.indexOf(add));

  additionals = [...new Set(additionals)];

  // Set TTL=10 on records for legacy responses. Use clones to prevent
  // altering the original record set.
  function legacyify(record) {
    const clone = record.clone();
    clone.isUnique = false;
    clone.ttl = 10;
    return clone;
  }

  if (this._isLegacy) {
    packet.header.ID = this._headerID;
    packet.setQuestions(this._questions);

    answers = answers
      .filter(record => record.rrtype !== RType.NSEC)
      .map(legacyify);

    additionals = additionals
      .filter(record => record.rrtype !== RType.NSEC)
      .map(legacyify);
  }

  packet.setResponseBit();
  packet.setAnswers(answers);
  packet.setAdditionals(additionals);

  return packet;
};


module.exports = {
  Multicast: MulticastResponse,
  Goodbye  : GoodbyeResponse,
  Unicast  : UnicastResponse,
};
