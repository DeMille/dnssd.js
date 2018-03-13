const EventEmitter = require('./EventEmitter');
const RecordCollection = require('./RecordCollection');
const ExpiringRecordCollection = require('./ExpiringRecordCollection');
const TimerContainer = require('./TimerContainer');
const Packet = require('./Packet');
const QueryRecord = require('./QueryRecord');
const sleep = require('./sleep');
const misc = require('./misc');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const ONE_SECOND = 1000;
const ONE_HOUR = 60 * 60 * 1000;

let counter = 0;
const uniqueId = () => `id#${++counter}`;


/**
 * Creates a new Query
 * @class
 * @extends EventEmitter
 *
 * A query asks for records on a given interface. Queries can be continuous
 * or non-continuous. Continuous queries will keep asking for records until it
 * gets them all. Non-continuous queries will stop after the first answer packet
 * it receives, whether or not that packet has answers to its questions.
 *
 * @emits 'answer'
 * @emits 'timeout'
 *
 * @param {NetworkInterface} intf - the interface the query will work on
 * @param {EventEmitter}     offswitch - emitter used to shut this query down
 */
function Query(intf, offswitch) {
  EventEmitter.call(this);

  // id only used for figuring out logs
  this._id = uniqueId();
  debug(`Creating a new query (${this._id})`);

  this._intf = intf;
  this._offswitch = offswitch;
  this._originals = [];
  this._questions = new RecordCollection();
  this._knownAnswers = new ExpiringRecordCollection([], `Query ${this._id}`);
  this._isStopped = false;

  // defaults
  this._delay = misc.random(20, 120);
  this._ignoreCache = false;
  this._isContinuous = true;
  this._timeoutDelay = null;

  // repeated queries increasing by a factor of 2, starting at 1s apart
  this._next = ONE_SECOND;
  this._queuedPacket = null;
  this._timers = new TimerContainer(this);

  // stop on either the offswitch or an interface error
  intf.using(this).once('error', this.stop);
  offswitch.using(this).once('stop', this.stop);

  // remove expired records from known answer list
  intf.cache.using(this).on('expired', this._removeKnownAnswer);

  // restart query (reset delay, etc) after waking from sleep
  sleep.using(this).on('wake', this._restart);
}

Query.prototype = Object.create(EventEmitter.prototype);
Query.prototype.constructor = Query;


Query.prototype.setTimeout = function(timeout) {
  this._timeoutDelay = timeout;
  return this;
};


Query.prototype.continuous = function(bool) {
  this._isContinuous = !!bool;
  return this;
};


Query.prototype.ignoreCache = function(bool) {
  this._ignoreCache = !!bool;
  return this;
};


/**
 * Adds questions to the query, record names/types that need an answer
 *
 * {
 *   name: 'Record Name.whatever.local.',
 *   qtype: 33
 * }
 *
 * If qtype isn't given, the QueryRecord that gets made will default to 255/ANY
 * Accepts one question object or many
 *
 * @param {object|object[]} args
 */
Query.prototype.add = function(args) {
  const questions = Array.isArray(args) ? args : [args];
  this._originals = [...questions];

  questions.forEach((question) => {
    this._questions.add(new QueryRecord(question));
  });

  return this;
};


/**
 * Starts querying for stuff on the interface. Only should be started
 * after all questions have been added.
 */
Query.prototype.start = function() {
  // Check the interface's cache for answers before making a network trip
  if (!this._ignoreCache) this._checkCache();

  // If all of the query's questions have been answered via the cache, and no
  // subsequent answers are needed, stop early.
  if (!this._questions.size) {
    debug(`All answers found in cache, ending early (${this._id})`);
    this.stop();

    return this;
  }

  // Only attach interface listeners now that all questions have been added and
  // the query has been started. Answers shouldn't be processed before the
  // query has been fully set up and started.
  this._intf.using(this)
    .on('answer', this._onAnswer)
    .on('query', this._onQuery);

  // Prepare packet early to allow for duplicate question suppression
  this._queuedPacket = this._makePacket();

  // Only start timeout check AFTER initial delay. Otherwise it could possibly
  // timeout before the query has even been sent.
  this._timers.setLazy('next-query', () => {
    if (this._timeoutDelay) this._startTimer();
    this._send();
  }, this._delay);

  return this;
};


/**
 * Stops the query. Has to remove any timers that might exist because of this
 * query, like this query's timeout, next queued timers, and also any timers
 * inside knownAnswers (ExpiringRecordCollections have timers too).
 */
Query.prototype.stop = function() {
  if (this._isStopped) return;

  debug(`Query stopped (${this._id})`);
  this._isStopped = true;

  this._timers.clear();
  this._knownAnswers.clear();

  this._intf.removeListenersCreatedBy(this);
  this._offswitch.removeListenersCreatedBy(this);
  this._intf.cache.removeListenersCreatedBy(this);
  sleep.removeListenersCreatedBy(this);
};


/**
 * Resets the query. When waking from sleep the query should clear any known
 * answers and start asking for things again.
 */
Query.prototype._restart = function() {
  if (this._isStopped) return;

  debug(`Just woke up, restarting query (${this._id})`);

  this._timers.clear();
  this._questions.clear();
  this._knownAnswers.clear();

  this._originals.forEach((question) => {
    this._questions.add(new QueryRecord(question));
  });

  this._next = ONE_SECOND;
  this._send();
};


/**
 * Sends the query packet. Gets called repeatedly.
 *
 * Each packet is prepared in advance for the next scheduled sending. This way
 * if another query comes in from another mDNS responder with some of the same
 * questions as this query, those questions can be removed from this packet
 * before it gets sent to reduce network chatter.
 *
 * Right before the packet actually gets sent here, any known answers learned
 * from other responders (including those since the last outgoing query) are
 * added to the packet.
 */
Query.prototype._send = function() {
  debug(`Sending query (${this._id})`);

  // add known answers (with adjusted TTLs) to the outgoing packet
  const packet = this._addKnownAnswers(this._queuedPacket);

  if (!packet.isEmpty()) this._intf.send(packet);
  else debug(`No questions to send, suppressing empty packet (${this._id})`);

  // queue next. the packet is prepared in advance for duplicate question checks
  if (this._isContinuous) {
    this._queuedPacket = this._makePacket();
    this._timers.setLazy('next-query', this._send, this._next);

    // each successive query doubles the delay up to one hour
    this._next = Math.min(this._next * 2, ONE_HOUR);
  }
};


/**
 * Create query packet
 *
 * Note this doesn't add known answers. Those need to be added later as they
 * can change in the time between creating the packet and sending it.
 */
Query.prototype._makePacket = function() {
  const packet = new Packet();
  packet.setQuestions(this._questions.toArray());

  return packet;
};


/**
 * Adds current known answers to the packet
 *
 * Known answers are shared records from other responders. They expire from
 * the known answer list as they get too old. Known answers are usually
 * (always?) shared records for questions that have multiple possible answers,
 * like PTRs.
 */
Query.prototype._addKnownAnswers = function(packet) {
  // only known answers whose TTL is >50% of the original should be included
  const knownAnswers = this._knownAnswers.getAboveTTL(0.50);

  // the cache-flush bit should not be set on records in known answer lists
  knownAnswers.forEach((answer) => {
    answer.isUnique = false;
  });

  packet.setAnswers(knownAnswers);

  return packet;
};


/**
 * Old records should be removed from the known answer list as they expire
 */
Query.prototype._removeKnownAnswer = function(record) {
  if (this._knownAnswers.has(record)) {
    debug(`Removing expired record from query's known answer list (%s): \n%s`,
      this._id, record);

    this._knownAnswers.delete(record);
  }
};


/**
 * Handles incoming answer packets from other mDNS responders
 *
 * If the incoming packet answers all remaining questions or if this query is
 * a 'non-continuous' query, the handler will stop the query and shut it down.
 *
 * @emits 'answer' event with
 *   - each answer record found, and
 *   - all the other records in the packet
 *
 * @param {packet} packet - the incoming packet
 */
Query.prototype._onAnswer = function(packet) {
  if (this._isStopped) return;

  const incomingRecords = [...packet.answers, ...packet.additionals];

  incomingRecords.forEach((record) => {
    this._questions.forEach((question) => {
      if (!record.canAnswer(question)) return;
      debug('Answer found in response (Query %s): \n%s', this._id, record);

      // If the answer is unique (meaning there is only one answer), don't need
      // to keep asking for it and the question can be removed from the pool.
      // If answer is a shared record (meaning there are possibly more than one
      // answer, like with PTR records), add it to the known answer list.
      if (record.isUnique) this._questions.delete(question);
      else this._knownAnswers.add(record);

      // emit answer record along with the other record that came with it
      this.emit('answer', record, incomingRecords.filter(r => r !== record));

    });
  });

  // Non-continuous queries get shut down after first response, answers or not.
  // Queries that have had all questions answered get shut down now too.
  if (!this._isContinuous || !this._questions.size) this.stop();
};


/**
 * Handles incoming queries from other responders
 *
 * This is solely used to do duplicate question suppression (7.3). If another
 * responder has asked the same question as one this query is about to send,
 * this query can suppress that question since someone already asked for it.
 *
 * Only modifies the next scheduled query packet (this._queuedPacket).
 *
 * @param {Packet} packet - the incoming query packet
 */
Query.prototype._onQuery = function(packet) {
  if (this._isStopped) return;

  // Make sure we don't suppress ourselves by acting on our own
  // packets getting fed back to us. (this handler will receive this query's
  // outgoing packets too as they come back in on the interface.)
  if (packet.isLocal()) return;

  // can only suppress if the known answer section is empty (see 7.3)
  if (packet.answers.length) return;

  // ignore suppression check on QU questions, only applies to QM questions
  const incoming = packet.questions.filter(q => q.QU === false);
  const outgoing = this._queuedPacket.questions.filter(q => q.QU === false);

  // suppress outgoing questions that also appear in incoming records
  const questions = (new RecordCollection(outgoing)).difference(incoming).toArray();
  const suppressed = outgoing.filter(out => !~questions.indexOf(out));

  if (suppressed.length) {
    debug('Suppressing duplicate questions (%s): %r', this._id, suppressed);
    this._queuedPacket.setQuestions(questions);
  }
};


/**
 * Check the interface's cache for valid answers to query's questions
 */
Query.prototype._checkCache = function() {
  this._questions.forEach((question) => {
    const answers = this._intf.cache.find(question);

    answers.forEach((record) => {
      debug('Answer found in cache (Query %s): \n%s', this._id, record);

      if (record.isUnique) this._questions.delete(question);
      else this._knownAnswers.add(record);

      this.emit('answer', record, answers.filter(a => a !== record));
    });
  });
};


/**
 * Starts the optional timeout timer
 * @emits `timeout` if answers don't arrive in time
 */
Query.prototype._startTimer = function() {
  this._timers.set('timeout', () => {
    debug(`Query timeout (${this._id})`);

    this.emit('timeout');
    this.stop();
  }, this._timeoutDelay);
};


module.exports = Query;
