const EventEmitter = require('./EventEmitter');
const TimerContainer = require('./TimerContainer');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);

const ONE_SECOND = 1000;


/**
 * @class
 * @extends EventEmitter
 *
 * ExpiringRecordCollection is a set collection for resource records or
 * query records. Uniqueness is determined by a record's hash property,
 * which is a hash of a records name, type, class, and rdata. Records
 * are evicted from the collection as their TTLs expire.
 *
 * Since there may be several records with the same name, type, and class,
 * but different rdata, within a record set (e.g. PTR records for a service
 * type), related records are tracked in this._related.
 *
 * This collection emits 'reissue' and 'expired' events as records TTLs
 * decrease towards expiration. Reissues are emitted at 80%, 85%, 90% and 95%
 * of each records TTL. Re-adding a record refreshes the TTL.
 *
 * @emits 'expired'
 * @emits 'reissue'
 */
class ExpiringRecordCollection extends EventEmitter {
  /**
   * @param {ResourceRecord[]} [records] - optional starting records
   * @param {string} [description]       - optional description for debugging
   */
  constructor(records, description) {
    super();

    // make debugging easier, who owns this / what it is
    this._desc = description;

    this._records = {};         // record.hash: record
    this._related = {};         // record.namehash: Set() of record hashes
    this._insertionTime = {};   // record.hash: Date.now()
    this._timerContainers = {}; // record.hash: new TimerContainer()

    this.size = 0;
    if (records) this.addEach(records);
  }


  /**
   * Adds record. Re-added records refresh TTL expiration timers.
   * @param {ResourceRecord} record
   */
  add(record) {
    const id = record.hash;
    const group = record.namehash;

    // expire TTL=0 goodbye records instead
    if (record.ttl === 0) return this.setToExpire(record);

    debug.v('#add(): %s', record);
    debug.v(`    to: ${this._desc}`);

    // only increment size if the record is new
    if (!this._records[id]) this.size++;

    // keep track of related records (same name, type, and class)
    if (!this._related[group]) this._related[group] = new Set();

    // remove any old timers
    if (this._timerContainers[id]) this._timerContainers[id].clear();

    this._records[id] = record;
    this._related[group].add(id);
    this._insertionTime[id] = Date.now();
    this._timerContainers[id] = new TimerContainer();

    // do reissue/expired timers
    this._schedule(record);
  }


  addEach(records) {
    records.forEach(record => this.add(record));
  }


  has(record) {
    return Object.hasOwnProperty.call(this._records, record.hash);
  }


  /**
   * Checks if a record was added to the collection within a given range
   *
   * @param  {ResourceRecord} record
   * @param  {number}         range - in *seconds*
   * @return {boolean}
   */
  hasAddedWithin(record, range) {
    const then = this._insertionTime[record.hash];

    return Number(parseFloat(then)) === then &&
           (range * ONE_SECOND) >= (Date.now() - then);
  }


  /**
   * Returns a *clone* of originally added record that matches requested record.
   * The clone's TTL is reduced to the current TTL. A clone is used so the
   * original record's TTL isn't modified.
   *
   * @param  {ResourceRecord} record
   * @return {ResourceRecord|undefined}
   */
  get(record) {
    if (!this.has(record)) return undefined;

    const then = this._insertionTime[record.hash];
    const elapsed = ~~((Date.now() - then) / ONE_SECOND);
    const clone = record.clone();

    clone.ttl -= elapsed;

    return clone;
  }


  /**
   * @emits 'expired' w/ the expiring record
   */
  delete(record) {
    if (!this.has(record)) return;

    const id = record.hash;
    const group = record.namehash;

    this.size--;
    this._timerContainers[id].clear();

    delete this._records[id];
    delete this._insertionTime[id];
    delete this._timerContainers[id];

    if (this._related[group]) this._related[group].delete(id);

    debug.v('deleting: %s', record);
    debug.v(`    from: ${this._desc}`);

    this.emit('expired', record);
  }


  /**
   * Deletes all records, clears all timers, resets size to 0
   */
  clear() {
    debug.v('#clear()');

    this.removeAllListeners();
    Object.values(this._timerContainers).forEach(timers => timers.clear());

    this.size = 0;
    this._records = {};
    this._related = {};
    this._insertionTime = {};
    this._timerContainers = {};
  }


  /**
   * Sets record to be deleted in 1s, but doesn't immediately delete it
   */
  setToExpire(record) {
    // can't expire unknown records
    if (!this.has(record)) return;

    // don't reset expire timer if this gets called again, say due to
    // repeated goodbyes. only one timer (expire) would be set in this case
    if (this._timerContainers[record.hash].count() === 1) return;

    debug.v('#setToExpire(): %s', record);
    debug.v(`            on: ${this._desc}`);

    this._timerContainers[record.hash].clear();
    this._timerContainers[record.hash].set(() => this.delete(record), ONE_SECOND);
  }


  /**
   * Flushes any other records that have the same name, class, and type
   * from the collection *if* the records have been in the collection
   * longer than 1s.
   */
  flushRelated(record) {
    // only flush records that have cache-flush bit set
    if (!record.isUnique) return;

    this._getRelatedRecords(record.namehash).forEach((related) => {
      // can't flush itself
      if (related.equals(record)) return;

      // only flush records added more than 1s ago
      if (!this.hasAddedWithin(related, 1)) this.setToExpire(related);
    });
  }


  /**
   * Records with original TTLs (not reduced ttl clones)
   */
  toArray() {
    return Object.values(this._records);
  }


  /**
   * Checks if collection contains any other records with the same name, type,
   * and class but different rdata. Non-unique records always return false & a
   * record can't conflict with itself
   *
   * @param  {ResourceRecord} record
   * @return {boolean}
   */
  hasConflictWith(record) {
    if (!record.isUnique) return false;

    return !!this._getRelatedRecords(record.namehash)
      .filter(related => !related.equals(record))
      .length;
  }


  /**
   * Finds any records in collection that matches name, type, and class of a
   * given query. Rejects any records with a TTL below the cutoff percentage.
   * Returns clones of records to prevent changes to original objects.
   *
   * @param  {QueryRecord} query
   * @param  {number}      [cutoff] - percentage, 0.0 - 1.0
   * @return {ResourceRecords[]}
   */
  find(query, cutoff = 0.25) {
    debug.v(`#find(): "${query.name}" type: ${query.qtype}`);
    debug.v(`     in: ${this._desc}`);


    return this._filterTTL(this._getRelatedRecords(query.namehash), cutoff);
  }


  /**
   * Gets all any records in collection with a TTL above the cutoff percentage.
   * Returns clones of records to prevent changes to original objects.
   *
   * @param  {number} [cutoff] - percentage, 0.0 - 1.0
   * @return {ResouceRecords[]}
   */
  getAboveTTL(cutoff = 0.25) {
    debug.v(`#getAboveTTL(): %${cutoff * 100}`);
    return this._filterTTL(this.toArray(), cutoff);
  }


  /**
   * Gets records that have same name, type, and class.
   */
  _getRelatedRecords(namehash) {
    return (this._related[namehash] && this._related[namehash].size)
      ? [...this._related[namehash]].map(id => this._records[id])
      : [];
  }


  /**
   * Filters given records by their TTL.
   * Returns clones of records to prevent changes to original objects.
   *
   * @param  {ResouceRecords[]} records
   * @param  {number}           cutoff - percentage, 0.0 - 1.0
   * @return {ResouceRecords[]}
   */
  _filterTTL(records, cutoff) {
    return records.reduce((result, record) => {
      const then = this._insertionTime[record.hash];
      const elapsed = ~~((Date.now() - then) / ONE_SECOND);
      const percent = (record.ttl - elapsed) / record.ttl;

      debug.v('└── %s @ %d%', record, ~~(percent*100));

      if (percent >= cutoff) {
        const clone = record.clone();
        clone.ttl -= elapsed;
        result.push(clone);
      }

      return result;
    }, []);
  }


  /**
   * Sets expiration/reissue timers for a record.
   *
   * Sets expiration at end of TTL.
   * Sets reissue events at 80%, 85%, 90%, 95% of records TTL, plus a random
   * extra 0-2%. (see rfc)
   *
   * @emits 'reissue' w/ the record that needs to be refreshed
   *
   * @param {ResouceRecords} record
   */
  _schedule(record) {
    const id = record.hash;
    const ttl = record.ttl * ONE_SECOND;

    const expired = () => this.delete(record);
    const reissue = () => this.emit('reissue', record);
    const random = (min, max) => Math.random() * (max - min) + min;

    this._timerContainers[id].setLazy(reissue, ttl * random(0.80, 0.82));
    this._timerContainers[id].setLazy(reissue, ttl * random(0.85, 0.87));
    this._timerContainers[id].setLazy(reissue, ttl * random(0.90, 0.92));
    this._timerContainers[id].setLazy(reissue, ttl * random(0.95, 0.97));
    this._timerContainers[id].set(expired, ttl);
  }
}


module.exports = ExpiringRecordCollection;
