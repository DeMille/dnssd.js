const Packet = require('./Packet');
const QueryRecord = require('./QueryRecord');
const EventEmitter = require('./EventEmitter');
const RecordCollection = require('./RecordCollection');
const TimerContainer = require('./TimerContainer');
const sleep = require('./sleep');
const misc = require('./misc');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

let counter = 0;
const uniqueId = () => `id#${++counter}`;


/**
 * Creates a new Probe
 * @class
 * @extends EventEmitter
 *
 * A probe will check if records are unique on a given interface. If they are
 * unique, the probe succeeds and the record name can be used. If any records
 * are found to be not unique, the probe fails and the records need to be
 * renamed.
 *
 * Probes send 3 probe packets out, 250ms apart. If no conflicting answers are
 * received after all 3 have been sent the probe is considered successful.
 *
 * @emits 'complete'
 * @emits 'conflict'
 *
 * @param {NetworkInterface} intf - the interface the probe will work on
 * @param {EventEmitter}     offswitch - emitter used to shut this probe down
 */
function Probe(intf, offswitch) {
  EventEmitter.call(this);

  // id only used for figuring out logs
  this._id = uniqueId();
  debug(`Creating new probe (${this._id})`);

  this._interface = intf;
  this._offswitch = offswitch;
  this._questions = new RecordCollection();
  this._authorities = new RecordCollection();
  this._bridgeable = new RecordCollection();

  this._isStopped = false;
  this._numProbesSent = 0;
  this._timers = new TimerContainer(this);

  // listen on answers/probes to check for conflicts
  // stop on either the offswitch or an interface error
  intf.using(this)
    .on('answer', this._onAnswer)
    .on('probe', this._onProbe)
    .on('error', this.stop);

  offswitch.using(this).once('stop', this.stop);

  // restart probing process if it was interrupted by sleep
  sleep.using(this).on('wake', this.stop);
}

Probe.prototype = Object.create(EventEmitter.prototype);
Probe.prototype.constructor = Probe;


/**
 * Add unique records to be probed
 * @param {ResourceRecords|ResourceRecords[]} args
 */
Probe.prototype.add = function(args) {
  const records = Array.isArray(args) ? args : [args];

  records.forEach((record) => {
    this._authorities.add(record);
    this._questions.add(new QueryRecord({name: record.name}));
  });

  return this;
};


/**
 * Sets the record set getting probed across all interfaces, not just this one.
 * Membership in the set helps let us know if a record is getting bridged from
 * one interface to another.
 */
Probe.prototype.bridgeable = function(bridgeable) {
  this._bridgeable = new RecordCollection(bridgeable);
  return this;
};


/**
 * Starts probing records.
 * The first probe should be delayed 0-250ms to prevent collisions.
 */
Probe.prototype.start = function() {
  if (this._isStopped) return;

  this._timers.setLazy('next-probe', this._send, misc.random(0, 250));
  return this;
};


/**
 * Stops the probe. Has to remove any timers that might exist because of this
 * probe, like the next queued timer.
 */
Probe.prototype.stop = function() {
  if (this._isStopped) return;

  debug(`Probe stopped (${this._id})`);
  this._isStopped = true;
  this._timers.clear();

  this._interface.removeListenersCreatedBy(this);
  this._offswitch.removeListenersCreatedBy(this);
  sleep.removeListenersCreatedBy(this);
};


/**
 * Restarts the probing process
 */
Probe.prototype._restart = function() {
  this._numProbesSent = 0;
  this._timers.clear();
  this._send();
};


/**
 * Sends the probe packets. Gets called repeatedly.
 */
Probe.prototype._send = function() {
  const packet = this._makePacket();

  this._numProbesSent++;
  debug(`Sending probe #${this._numProbesSent}/3 (${this._id})`);

  this._interface.send(packet);

  // Queue next action
  // - if 3 probes have been sent, 750ms with no conflicts, probing is complete
  // - otherwise queue next outgoing probe
  this._timers.setLazy('next-probe', () => {
    (this._numProbesSent === 3) ? this._complete() : this._send();
  }, 250);
};


/**
 * Gets called when the probe completes successfully. If the probe finished
 * early without having to send all 3 probes, completeEarly is set to true.
 *
 * @emits 'complete' with true/false
 *
 * @param {boolean} [completedEarly]
 */
Probe.prototype._complete = function(completedEarly) {
  debug(`Probe (${this._id}) complete, early: ${!!completedEarly}`);

  this.stop();
  this.emit('complete', completedEarly);
};


/**
 * Create probe packets. Probe packets are the same as query packets but they
 * have records in the authority section.
 */
Probe.prototype._makePacket = function() {
  const packet = new Packet();

  packet.setQuestions(this._questions.toArray());
  packet.setAuthorities(this._authorities.toArray());

  return packet;
};


/**
 * Handles incoming answer packets from other mDNS responders
 *
 * Any answer that conflicts with one of the proposed records causes a conflict
 * and stops the probe. If the answer packet matches all proposed records exactly,
 * it means someone else has already probed the record set and the probe can
 * finish early.
 *
 * Biggest issue here is A/AAAA answer records from bonjour getting bridged.
 *
 * Note: don't need to worry about *our* bridged interface answers here. Probes
 * within a single responder are synchronized and the responder will not
 * transition into a 'responding' state until all the probes are done.
 *
 * @emits 'conflict' when there is a conflict
 *
 * @param {Packet} packet - the incoming answer packet
 */
Probe.prototype._onAnswer = function(packet) {
  if (this._isStopped) return;

  const incoming = new RecordCollection([...packet.answers, ...packet.additionals]);

  // if incoming records match the probes records exactly, including rdata,
  // then the record set has already been probed and verified by someone else
  if (incoming.hasEach(this._authorities)) {
    debug(`All probe records found in answer, completing early (${this._id})`);
    return this._complete(true);
  }

  // check each of our proposed records
  // check if any of the incoming records conflict with the current record
  // check each for a conflict but ignore if we think the record was
  // bridged from another interface (if the record set has the record on
  // some other interface, the packet was probably bridged)

  const conflicts = this._authorities.getConflicts(incoming);
  const hasConflict = conflicts.length && !this._bridgeable.hasEach(conflicts);

  // a conflicting response from an authoritative responder is fatal and means
  // the record set needs to be renamed
  if (hasConflict) {
    debug(`Found conflict on incoming records (${this._id})`);
    this.stop();
    this.emit('conflict');
  }
};


/**
 * Handles incoming probe packets
 *
 * Checks for conflicts with simultaneous probes (a rare race condition). If
 * the two probes have conflicting data for the same record set, they are
 * compared and the losing probe has to wait 1 second and try again.
 * (See: 8.2.1. Simultaneous Probe Tiebreaking for Multiple Records)
 *
 * Note: this handle will receive this probe's packets too
 *
 * @param {Packet} packet - the incoming probe packet
 */
Probe.prototype._onProbe = function(packet) {
  if (this._isStopped) return;
  debug(`Checking probe for conflicts (${this._id})`);

  // Prevent probe from choking on cooperating probe packets in the event that
  // they get bridged over another interface. (Eg: AAAA record from interface 1
  // shouldn't conflict with a bridged AAAA record from interface 2, even though
  // the interfaces have different addresses.) Just ignore simultaneous probes
  // from the same machine and not deal with it.
  if (packet.isLocal()) {
    return debug(`Local probe, ignoring (${this._id})`);
  }

  // Prep records:
  // - split into groups by record name
  // - uppercase name so they can be compared case-insensitively
  // - sort record array by ascending rrtype
  //
  // {
  //  'NAME1': [records],
  //  'NAME2': [records]
  // }
  const local = {};
  const incoming = {};

  const has = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

  this._authorities.toArray().forEach((r) => {
    const key = r.name.toUpperCase();

    if (has(local, key)) local[key].push(r);
    else local[key] = [r];
  });

  packet.authorities.forEach((r) => {
    const key = r.name.toUpperCase();

    // only include those that appear in the other group
    if (has(local, key)) {
      if (has(incoming, key)) incoming[key].push(r);
      else incoming[key] = [r];
    }
  });

  Object.keys(local).forEach((key) => {
    local[key] = local[key].sort((a, b) => a.rrtype - b.rrtype);
  });

  Object.keys(incoming).forEach((key) => {
    incoming[key] = incoming[key].sort((a, b) => a.rrtype - b.rrtype);
  });

  // Look for conflicts in each group of records. IE, if there are records
  // named 'A' and records named 'B', look at each set.  'A' records first,
  // and then 'B' records. Stops at the first conflict.
  const hasConflict = Object.keys(local).some((name) => {
    if (!incoming[name]) return false;

    return this._recordsHaveConflict(local[name], incoming[name]);
  });

  // If this probe is found to be in conflict it has to pause for 1 second
  // before trying again. A legitimate competing probe should have completed
  // by then and can then authoritatively respond to this probe, causing this
  // one to fail.
  if (hasConflict) {
    this._timers.clear();
    this._timers.setLazy('restart', this._restart, 1000);
  }
};


/**
 * Compares two records sets lexicographically
 *
 * Records are compared, pairwise, in their sorted order, until a difference
 * is found or until one of the lists runs out. If no differences are found,
 * and record lists are the same length, then there is no conflict.
 *
 * Returns true if there was a conflict with this probe's records and false
 * if this probe is ok.
 *
 * @param  {ResourceRecords[]} records
 * @param  {ResourceRecords[]} incomingRecords
 * @return {Boolean}
 */
Probe.prototype._recordsHaveConflict = function(records, incomingRecords) {
  debug('Checking for lexicographic conflicts with other probe:');

  let hasConflict = false;
  const pairs = [];

  for (let i = 0; i < Math.max(records.length, incomingRecords.length); i++) {
    pairs.push([records[i], incomingRecords[i]]);
  }

  pairs.forEach(([record, incoming]) => {
    debug('Comparing: %s', record);
    debug('     with: %s', incoming);

    // this probe has LESS records than other probe, this probe LOST
    if (typeof record === 'undefined') {
      hasConflict = true;
      return false; // stop comparing
    }

    // this probe has MORE records than other probe, this probe WON
    if (typeof incoming === 'undefined') {
      hasConflict = false;
      return false; // stop comparing
    }

    const comparison = record.compare(incoming);

    // record is lexicographically earlier than incoming, this probe LOST
    if (comparison === -1) {
      hasConflict = true;
      return false; // stop comparing
    }

    // record is lexicographically later than incoming, this probe WON
    if (comparison === 1) {
      hasConflict = false;
      return false; // stop comparing
    }

    // otherwise, if records are lexicographically equal, continue and
    // check the next record pair
  });

  debug('Lexicographic conflict %s', (hasConflict) ? 'found' : 'not found');

  return hasConflict;
};


module.exports = Probe;
