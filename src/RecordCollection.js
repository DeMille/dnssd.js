/**
 * Creates a new RecordCollection
 * @class
 *
 * RecordSet might have been a better name, but a 'record set' has a specific
 * meaning with dns.
 *
 * The 'hash' property of ResourceRecords/QueryRecords is used to keep items in
 * the collection/set unique.
 */
class RecordCollection {
  /**
   * @param {ResorceRecord[]} [records] - optional starting records
   */
  constructor(records) {
    this.size = 0;
    this._records = {};

    if (records) this.addEach(records);
  }

  has(record) {
    return Object.hasOwnProperty.call(this._records, record.hash);
  }

  hasEach(records) {
    return records.every(record => this.has(record));
  }

  hasAny(records) {
    return !!this.intersection(records).size;
  }

  /**
   * Retrieves the equivalent record from the collection
   *
   * Eg, for two equivalent records A and B:
   *   A !== B                  - different objects
   *   A.equals(B) === true     - but equivalent records
   *
   *   collection.add(A)
   *   collection.get(B) === A  - returns object A, not B
   */
  get(record) {
    return (this.has(record)) ? this._records[record.hash] : undefined;
  }

  add(record) {
    if (!this.has(record)) {
      this._records[record.hash] = record;
      this.size++;
    }
  }

  addEach(records) {
    records.forEach(record => this.add(record));
  }

  delete(record) {
    if (this.has(record)) {
      delete this._records[record.hash];
      this.size--;
    }
  }

  clear() {
    this._records = {};
    this.size = 0;
  }

  rebuild() {
    const records = this.toArray();

    this.clear();
    this.addEach(records);
  }

  toArray() {
    return Object.values(this._records);
  }

  forEach(fn, context) {
    this.toArray().forEach(fn.bind(context));
  }

  /**
   * @return {RecordCollection} - a new record collection
   */
  filter(fn, context) {
    return new RecordCollection(this.toArray().filter(fn.bind(context)));
  }

  /**
   * @return {RecordCollection} - a new record collection
   */
  reject(fn, context) {
    return this.filter(r => !fn.call(context, r));
  }

  /**
   * @return {ResourceRecords[]} - array, not a new record collection
   */
  map(fn, context) {
    return this.toArray().map(fn.bind(context));
  }

  reduce(fn, acc, context) {
    return this.toArray().reduce(fn.bind(context), acc);
  }

  some(fn, context) {
    return this.toArray().some(fn.bind(context));
  }

  every(fn, context) {
    return this.toArray().every(fn.bind(context));
  }

  /**
   * @param  {RecordCollection|ResourceRecords[]} values - array or collection
   * @return {boolean}
   */
  equals(values) {
    const otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    if (this.size !== otherSet.size) return false;

    return this.every(record => otherSet.has(record));
  }

  /**
   * Returns a new RecordCollection containing the values of this collection
   * minus the records contained in the other record collection
   *
   * @param  {RecordCollection|ResourceRecords[]} values
   * @return {RecordCollection}
   */
  difference(values) {
    const otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    return this.reject(record => otherSet.has(record));
  }

  /**
   * Returns a new RecordCollection containing the values that exist in both
   * this collection and in the other record collection
   *
   * @param  {RecordCollection|ResourceRecords[]} values
   * @return {RecordCollection}
   */
  intersection(values) {
    const otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    return this.filter(record => otherSet.has(record));
  }

  /**
   * Checks if a group of records conflicts in any way with this set.
   * Returns all records that are conflicts out of the given values.
   *
   * Records that occur in both sets are ignored when check for conflicts.
   * This is to deal with a scenario like this:
   *
   * If this set has:
   *   A 'host.local' 1.1.1.1
   *   A 'host.local' 2.2.2.2
   *
   * And incoming set look like:
   *   A 'host.local' 1.1.1.1
   *   A 'host.local' 2.2.2.2
   *   A 'host.local' 3.3.3.3  <------ extra record
   *
   * That extra record shouldn't be a conflict with 1.1.1.1 or 2.2.2.2,
   * its probably bonjour telling us that there's more addresses that
   * can be used that we're not currently using.
   *
   * @param  {RecordCollection|ResourceRecords[]} values
   * @return {ResourceRecords[]}
   */
  getConflicts(values) {
    let otherSet = (values instanceof RecordCollection)
      ? values
      : new RecordCollection(values);

    // remove records that aren't conflicts
    const thisSet = this.difference(otherSet);
    otherSet = otherSet.difference(this);

    // find all records from the other set that conflict
    const conflicts = otherSet.filter(otherRecord =>
      thisSet.some(thisRecord => thisRecord.conflictsWith(otherRecord)));

    return conflicts.toArray();
  }
}


module.exports = RecordCollection;
