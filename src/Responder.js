const misc = require('./misc');
const EventEmitter = require('./EventEmitter');
const RecordCollection = require('./RecordCollection');
const TimerContainer = require('./TimerContainer');
const StateMachine = require('./StateMachine');

let Probe = require('./Probe');
let Response = require('./Response');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const RType = require('./constants').RType;
const ONE_SECOND = 1000;


/**
 * Make ids, just to keep track of which responder is which in debug messages
 */
let counter = 0;
const uniqueId = () => `id#${++counter}`;


/**
 * Responders need to keep track of repeated conflicts to save the network. If
 * a responder has more than 15 conflicts in a small window then the responder
 * should be throttled to prevent it from spamming everyone. Conflict count
 * gets cleared after 15s w/o any conflicts
 */
class ConflictCounter {
  constructor() {
    this._count = 0;
    this._timer = null;
  }

  count() {
    return this._count;
  }

  increment() {
    this._count++;
    clearTimeout(this._timer);

    // reset conflict counter after 15 seconds
    this._timer = setTimeout(() => {
      this._count = 0;
    }, 15 * ONE_SECOND);

    // prevent timer from holding the process
    this._timer.unref();
  }

  clear() {
    this._count = 0;
    clearTimeout(this._timer);
  }
}


/**
 * Responder
 * @class
 *
 * A responder object takes a record set and:
 * - probes to see if anyone else on the network is using that name
 * - responds to queries (and other probes) about the record set
 * - renames the records whenever there is a conflict (from probes/answers)
 * - sends goodbye messages when stopped
 *
 * A record set will be something like A/AAAA address records for interfaces or
 * PTR/SRV/TXT records for a service. Each set will only have one unique name.
 *
 * Responders keeps record set names in sync across any number of interfaces,
 * so if the set has a conflict on any one interface it will cause it to be
 * renamed on all interfaces.
 *
 * Functions as a state machine with these main states:
 * probing -> conflict (rename) -> responding -> goodbying -> stopped (final)
 *
 * Listens to interface probe, answer, and query events. Any errors from
 * interfaces are bad and stops to whole thing.
 *
 * @emits 'probingComplete' when probing has completed successfully
 * @emits 'rename' w/ new name whenever a conflict forces a rename
 * @emits 'error'
 */


const responderStates = {
  probing: {
    enter() {
      debug(`Now probing for: ${this._fullname}`);

      const onSuccess = (early) => { this.transition('responding', early); };
      const onFail = () => { this.transition('conflict'); };

      // If the probing process takes longer than 1 minute something is wrong
      // and it should abort. This gets cleared when entering responding state
      if (!this._timers.has('timeout')) {
        this._timers.set('timeout', () => {
          this.transition('stopped', new Error('Could not probe within 1 min'));
        }, 60 * ONE_SECOND);
      }

      // If there are too many sequential conflicts, take a break before probing
      if (this._conflicts.count() >= 15) {
        debug(`Too many conflicts, slowing probe down. (${this._id})`);

        this._timers.set('delayed-probe', () => {
          this._sendProbe(onSuccess, onFail);
        }, 5 * ONE_SECOND);

        return;
      }

      this._sendProbe(onSuccess, onFail);
    },

    // If records get updated mid-probe we need to restart the probing process
    update() {
      this.states.probing.exit.call(this);
      this.states.probing.enter.call(this);
    },

    // Stop any active probes, not needed anymore
    // Stop probes that were being throttled due to repeated conflicts
    exit() {
      this._stopActives();
      this._timers.clear('delayed-probe');
    },
  },

  responding: {
    enter(skipAnnounce) {
      debug(`Done probing, now responding for "${this._fullname}" (${this._id})`);

      // clear probing timeout since probing was successful
      this._timers.clear('timeout');

      // announce verified records to the network (or not)
      if (!skipAnnounce) this._sendAnnouncement(3);
      else debug(`Skipping announcement. (${this._id})`);

      // emit last
      this.emit('probingComplete');
    },

    // Only listen to these interface events in the responding state:
    probe(packet) {
      this._onProbe(packet);
    },

    query(packet) {
      this._onQuery(packet);
    },

    answer(packet) {
      this._onAnswer(packet);
    },

    // stop any active announcements / responses before announcing changes
    update() {
      this._stopActives();
      this._sendAnnouncement();
    },

    // stop any active announcements / responses before changing state
    exit() {
      this._stopActives();
    },
  },

  // Records get renamed on conflict, nothing else happens, no events fire.
  // Mostly is its own state for the convenience of having other exit &
  // enter handlers called.
  conflict: {
    enter() {
      debug(`Had a conflict with "${this._instance}", renaming. (${this._id})`);

      // Instance -> Instance (2)
      const oldName = this._instance;
      const newName = this._rename(oldName);

      // Instance._http._tcp.local. -> Instance (2)._http._tcp.local.
      const oldFull = this._fullname;
      const newFull = this._fullname.replace(oldName, newName);

      this._instance = newName;
      this._fullname = newFull;

      // apply rename to records (using updateWith() so records get rehashed)
      // (note, has to change PTR fields too)
      function rename(record) {
        record.updateWith(() => {
          if (record.name === oldFull) record.name = newFull;
          if (record.PTRDName === oldFull) record.PTRDName = newFull;
        });
      }

      this._records.forEach(rename);
      this._bridgeable.forEach(rename);

      // rebuild bridge set since renames alters record hashes
      this._bridgeable.rebuild();

      this._conflicts.increment();
      this.transition('probing');

      // emits the new (not yet verified) name
      this.emit('rename', newName);
    },
  },

  // Sends TTL=0 goodbyes for all records. Uses a callback that fires once all
  // goodbyes have been sent. Transitions to stopped when done.
  goodbying: {
    enter(callback) {
      const finish = () => {
        this.transition('stopped');
        callback();
      };

      // Only send goodbyes if records were valid/probed, otherwise just stop
      if (this.prevState !== 'responding') finish();
      else this._sendGoodbye(finish);
    },

    exit() {
      this._stopActives();
    },
  },

  // Terminal state. Cleans up any existing timers and stops listening to
  // interfaces. Emits any errors, like from probing timeouts.
  stopped: {
    enter(err) {
      debug(`Responder stopping (${this._id})`);

      this._timers.clear();
      this._conflicts.clear();
      this._stopActives();
      this._removeListeners();

      if (err) this.emit('error', err);

      // override this.transition, because responder is stopped now
      // (shouldn't ever be a problem anyway, mostly for debugging)
      this.transition = () => debug("Responder is stopped! Can't transition.");
    },
  },
};


/**
 * @constructor
 *
 * Records is an array of all records, some may be on one interface, some may
 * be on another interface. (Each record has an .interfaceID field that
 * indicates what interface it should be used on. We need this because some
 * record, like A/AAAA which have different rdata (addresses) for each
 * interface they get used on.) So the records param might look like this:
 * [
 *   'Target.local.' A    192.168.1.10 ethernet,  <-- different rdata
 *   'Target.local.' AAAA FF::CC::1    ethernet,
 *   'Target.local.' NSEC A, AAAA      ethernet,
 *   'Target.local.' A    192.168.1.25 wifi,      <-- different rdata
 *   'Target.local.' AAAA AA::BB::7    wifi,
 *   'Target.local.' NSEC A, AAAA      wifi,      <-- same as ethernet ok
 * ]
 *
 * @param  {NetworkInterfaces} interface
 * @param  {ResourceRecords[]} records
 * @param  {ResourceRecords[]} bridgeable
 */
class Responder extends StateMachine {
  constructor(intf, records, bridgeable) {
    super(responderStates);

    this._id = uniqueId();
    debug('Creating new responder (%s) using: %r', this._id, records);

    const uniques = [...new Set(records.filter(r => r.isUnique).map(r => r.name))];

    if (!uniques.length) throw Error('No unique names in record set');
    if (uniques.length > 1) throw Error('Too many unique names in record set');

    this._interface = intf;
    this._records = records;
    this._bridgeable = new RecordCollection(bridgeable);

    // the unique name that this record set revolves around
    // eg: "Instance._http._tcp.local."
    this._fullname = uniques[0];

    // the part of the name that needs to be renamed on conflicts
    // eg: "Instance"
    this._instance = misc.parse(this._fullname).instance;
    if (!this._instance) throw Error('No instance name found in records');

    this._timers = new TimerContainer(this);
    this._conflicts = new ConflictCounter();

    // emitter used to stop child probes & responses without having to hold
    // onto a reference for each one
    this._offswitch = new EventEmitter();
  }

  start() {
    debug(`Starting responder (${this._id})`);
    this._addListeners();
    this.transition('probing');
  }


  // Immediately stops the responder (no goodbyes)
  stop() {
    debug(`Stopping responder (${this._id})`);
    this.transition('stopped');
  }


  // Sends goodbyes before stopping
  goodbye(onComplete) {
    if (this.state === 'stopped') {
      debug('Responder already stopped!');
      return onComplete();
    }

    debug(`Goodbying on responder (${this._id})`);
    this.transition('goodbying', onComplete);
  }


  /**
   * Updates all records that match the rrtype.
   *
    // updates should only consist of updated rdata, no name changes
    // (which means no shared records will be changed, and no goodbyes)

   * @param {integer}  rrtype - rrtype to be updated
   * @param {function} fn     - function to call that does the updating
   */
  updateEach(rrtype, fn) {
    debug(`Updating rtype ${rrtype} records. (${this._id})`);

    // modify properties of each record with given update fn
    this._records
      .filter(record => record.rrtype === rrtype)
      .forEach(record => record.updateWith(fn));

    // (update bridge list too)
    this._bridgeable
      .filter(record => record.rrtype === rrtype)
      .forEach(record => record.updateWith(fn));

    // rebuild bridge set since updates may have altered record hashes
    this._bridgeable.rebuild();

    // may need to announce changes or re-probe depending on current state
    this.handle('update');
  }


  /**
   * Get all records being used on an interface
   * (important because records could change with renaming)
   * @return {ResourceRecords[]}
   */
  getRecords() {
    return this._records;
  }


  _addListeners() {
    this._interface.using(this)
      .on('probe',   packet => this.handle('probe',  packet))
      .on('query',   packet => this.handle('query',  packet))
      .on('answer',  packet => this.handle('answer', packet))
      .once('error', err => this.transition('stopped', err));
  }


  _removeListeners() {
    this._interface.removeListenersCreatedBy(this);
  }


  /**
   * Stop any active probes, announcements, or goodbyes (all outgoing stuff uses
   * the same offswitch)
   */
  _stopActives() {
    debug(`Sending stop signal to actives. (${this._id})`);
    this._offswitch.emit('stop');
  }


  /**
   * Probes records on each interface, call onSuccess when all probes have
   * completed successfully or calls onFail as soon as one probes fails. Probes
   * may finish early in some situations. If they do, onSuccess is called with
   * `true` to indicate that.
   */
  _sendProbe(onSuccess, onFail) {
    debug(`Sending probes for "${this._fullname}". (${this._id})`);
    if (this.state === 'stopped') return debug('... already stopped!');

    // only unique records need to be probed
    const records = this._records.filter(record => record.isUnique);

    // finish early if exact copies are found in the cache
    if (records.every(record => this._interface.cache.has(record))) {
      debug('All records found in cache, skipping probe...');
      return onSuccess(true);
    }

    // skip network trip if any conflicting records are found in cache
    if (records.some(record => this._interface.cache.hasConflictWith(record))) {
      debug('Conflict found in cache, renaming...');
      return onFail();
    }

    new Probe(this._interface, this._offswitch)
      .add(records)
      .bridgeable(this._bridgeable)
      .once('conflict', onFail)
      .once('complete', onSuccess)
      .start();
  }


  /**
   * Send unsolicited announcements out when
   * - done probing
   * - changing rdata on a verified records (like TXTs)
   * - defensively correcting issues (TTL=0's, bridged records)
   */
  _sendAnnouncement(num = 1) {
    debug(`Sending ${num} announcements for "${this._fullname}". (${this._id})`);
    if (this.state === 'stopped') return debug('... already stopped!');

    new Response.Multicast(this._interface, this._offswitch)
      .add(this._records)
      .repeat(num)
      .start();
  }


  _sendGoodbye(onComplete) {
    debug(`Sending goodbyes for "${this._fullname}". (${this._id})`);
    if (this.state === 'stopped') return debug('... already stopped!');

    // skip goodbyes for special record types, like the enumerator PTR
    const records = this._records.filter(record => record.canGoodbye());

    new Response.Goodbye(this._interface, this._offswitch)
      .add(records)
      .once('stopped', onComplete)
      .start();
  }


  /**
   * "Instance" -> "Instance (2)"
   * "Instance (2)" -> "Instance (3)", etc.
   */
  _rename(label) {
    const re = /\((\d+)\)$/; // match ' (#)'

    function nextSuffix(match, n) {
      const next = parseInt(n, 10) + 1;
      return `(${next})`;
    }

    return (re.test(label))
      ? label.replace(re, nextSuffix)
      : label + ' (2)';
  }


  /**
   * Handles incoming probes from an interface. Only ever gets used in the
   * `responding` state. Sends out multicast and/or unicast responses if any of
   * the probe records conflict with what this responder is currently using.
   */
  _onProbe(packet) {
    const intf = this._interface;
    const name = this._fullname;
    const records = this._records;

    const multicast = [];
    const unicast   = [];

    packet.questions.forEach((question) => {
      // check if negative responses are needed for this question, ie responder
      // controls the name but doesn't have rrtype XYZ record. send NSEC instead.
      const shouldAnswer = (question.name.toUpperCase() === name.toUpperCase());
      let answered = false;

      records.forEach((record) => {
        if (!record.canAnswer(question)) return;

        // send as unicast if requested BUT only if the interface has not
        // multicast this record recently (withing 1/4 of the record's TTL)
        if (question.QU && intf.hasRecentlySent(record, record.ttl / 4)) {
          unicast.push(record);
          answered = true;
        } else {
          multicast.push(record);
          answered = true;
        }
      });

      if (shouldAnswer && !answered) {
        multicast.push(records.find(r => r.rrtype === RType.NSEC && r.name === name));
      }
    });

    if (multicast.length) {
      debug(`Defending name with a multicast response. (${this._id})`);

      new Response.Multicast(intf, this._offswitch)
        .defensive(true)
        .add(multicast)
        .start();
    }

    if (unicast.length) {
      debug(`Defending name with a unicast response. (${this._id})`);

      new Response.Unicast(intf, this._offswitch)
        .respondTo(packet)
        .defensive(true)
        .add(unicast)
        .start();
    }
  }


  /**
   * Handles incoming queries from an interface. Only ever gets used in the
   * `responding` state. Sends out multicast and/or unicast responses if any of
   * the responders records match the questions.
   */
  _onQuery(packet) {
    const intf = this._interface;
    const name = this._fullname;
    const records = this._records;
    const knownAnswers = new RecordCollection(packet.answers);

    const multicast  = [];
    const unicast    = [];
    const suppressed = [];

    packet.questions.forEach((question) => {
      // Check if negative responses are needed for this question, ie responder
      // controls the name but doesn't have rrtype XYZ record. send NSEC instead.
      const shouldAnswer = (question.name.toUpperCase() === name.toUpperCase());
      let answered = false;

      records.forEach((record) => {
        if (!record.canAnswer(question)) return;
        const knownAnswer = knownAnswers.get(record);

        // suppress known answers if the answer's TTL is still above 50%
        if (knownAnswer && (knownAnswer.ttl > (record.ttl / 2))) {
          suppressed.push(record);
          answered = true;

        // always respond via unicast to legacy queries (not from port 5353)
        } else if (packet.isLegacy()) {
          unicast.push(record);
          answered = true;

        // send as unicast if requested BUT only if the interface has not
        // multicast this record recently (withing 1/4 of the record's TTL)
        } else if (question.QU && intf.hasRecentlySent(record, record.ttl / 4)) {
          unicast.push(record);
          answered = true;

        // otherwise send a multicast response
        } else {
          multicast.push(record);
          answered = true;
        }
      });

      if (shouldAnswer && !answered) {
        multicast.push(records.find(r => r.rrtype === RType.NSEC && r.name === name));
      }
    });

    if (suppressed.length) {
      debug('Suppressing known answers (%s): %r', this._id, suppressed);
    }

    if (multicast.length) {
      debug(`Answering question with a multicast response. (${this._id})`);

      new Response.Multicast(intf, this._offswitch)
        .add(multicast)
        .start();
    }

    if (unicast.length) {
      debug(`Answering question with a unicast response. (${this._id})`);

      new Response.Unicast(intf, this._offswitch)
        .respondTo(packet)
        .add(unicast)
        .start();
    }
  }


  /**
   * Handles incoming answer packets from an interface. Only ever gets used in
   * the `responding` state, meaning it will also have to handle packets that
   * originated from the responder itself as they get looped back through the
   * interfaces.
   *
   * The handler watches for:
   * - Conflicting answers, which would force the responder to re-probe
   * - Bad goodbyes that need to be fixed / re-announced
   * - Bridged packets that make the responder re-announce
   *
   * Bridged packets need special attention here because they cause problems.
   * (See: https://tools.ietf.org/html/rfc6762#section-14)
   *
   * Scenario: both wifi and ethernet are connected on a machine. This responder
   * uses A/AAAA records for each interface, but they have different addresses.
   * Because the interfaces are bridged, wifi packets get heard on ethernet and
   * vice versa. The responder would normally freak out because the wifi A/AAAA
   * records conflict with the ethernet A/AAAA records, causing a never ending
   * spiral of conflicts/probes/death. The solution is to check if records got
   * bridged before freaking out. The second problem is that the wifi records
   * will then clobber anything on the ethernet, flushing the ethernet records
   * from their caches (flush records get deleted in 1s, remember). To correct
   * this, when we detect our packets getting bridged back to us we need to
   * re-announce our records. This will restore the records in everyone's caches
   * and prevent them from getting deleted (that 1s thing). In response to the
   * re-announced (and bridged) ethernet records, the responder will try to
   * re-announce the wifi records, but this cycle will be stopped because
   * records are limited to being sent once ever 1 second. Its kind of a mess.
   *
   * Note, we don't need to worry about handling our own goodbye records
   * because there is no _onAnswer handler in the `goodbying` state.
   */
  _onAnswer(packet) {
    const records = new RecordCollection(this._records);
    const incoming = new RecordCollection([...packet.answers, ...packet.additionals]);

    // Defensively re-announce records getting TTL=0'd by other responders.
    const shouldFix = incoming.filter(record => record.ttl === 0).hasAny(records);

    if (shouldFix) {
      debug(`Fixing goodbyes, re-announcing records. (${this._id})`);
      return this._sendAnnouncement();
    }

    const conflicts = records.getConflicts(incoming);

    if (conflicts.length) {
      // if the conflicts are just due to a bridged packet, re-announce instead
      if (this._bridgeable.hasEach(conflicts)) {
        debug(`Bridged packet detected, re-announcing records. (${this._id})`);
        return this._sendAnnouncement();
      }

      // re-probe needed to verify uniqueness (doesn't rename until probing fails)
      debug(`Found conflict on incoming records, re-probing. (${this._id})`);
      return this.transition('probing');
    }
  }
}


module.exports = Responder;
