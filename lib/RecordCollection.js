"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

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
var RecordCollection = function () {
  /**
   * @param {ResorceRecord[]} [records] - optional starting records
   */
  function RecordCollection(records) {
    _classCallCheck(this, RecordCollection);

    this.size = 0;
    this._records = {};

    if (records) this.addEach(records);
  }

  _createClass(RecordCollection, [{
    key: "has",
    value: function has(record) {
      return Object.hasOwnProperty.call(this._records, record.hash);
    }
  }, {
    key: "hasEach",
    value: function hasEach(records) {
      var _this = this;

      return records.every(function (record) {
        return _this.has(record);
      });
    }
  }, {
    key: "hasAny",
    value: function hasAny(records) {
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

  }, {
    key: "get",
    value: function get(record) {
      return this.has(record) ? this._records[record.hash] : undefined;
    }
  }, {
    key: "add",
    value: function add(record) {
      if (!this.has(record)) {
        this._records[record.hash] = record;
        this.size++;
      }
    }
  }, {
    key: "addEach",
    value: function addEach(records) {
      var _this2 = this;

      records.forEach(function (record) {
        return _this2.add(record);
      });
    }
  }, {
    key: "delete",
    value: function _delete(record) {
      if (this.has(record)) {
        delete this._records[record.hash];
        this.size--;
      }
    }
  }, {
    key: "clear",
    value: function clear() {
      this._records = {};
      this.size = 0;
    }
  }, {
    key: "rebuild",
    value: function rebuild() {
      var records = this.toArray();

      this.clear();
      this.addEach(records);
    }
  }, {
    key: "toArray",
    value: function toArray() {
      return Object.values(this._records);
    }
  }, {
    key: "forEach",
    value: function forEach(fn, context) {
      this.toArray().forEach(fn.bind(context));
    }

    /**
     * @return {RecordCollection} - a new record collection
     */

  }, {
    key: "filter",
    value: function filter(fn, context) {
      return new RecordCollection(this.toArray().filter(fn.bind(context)));
    }

    /**
     * @return {RecordCollection} - a new record collection
     */

  }, {
    key: "reject",
    value: function reject(fn, context) {
      return this.filter(function (r) {
        return !fn.call(context, r);
      });
    }

    /**
     * @return {ResourceRecords[]} - array, not a new record collection
     */

  }, {
    key: "map",
    value: function map(fn, context) {
      return this.toArray().map(fn.bind(context));
    }
  }, {
    key: "reduce",
    value: function reduce(fn, acc, context) {
      return this.toArray().reduce(fn.bind(context), acc);
    }
  }, {
    key: "some",
    value: function some(fn, context) {
      return this.toArray().some(fn.bind(context));
    }
  }, {
    key: "every",
    value: function every(fn, context) {
      return this.toArray().every(fn.bind(context));
    }

    /**
     * @param  {RecordCollection|ResourceRecords[]} values - array or collection
     * @return {boolean}
     */

  }, {
    key: "equals",
    value: function equals(values) {
      var otherSet = values instanceof RecordCollection ? values : new RecordCollection(values);

      if (this.size !== otherSet.size) return false;

      return this.every(function (record) {
        return otherSet.has(record);
      });
    }

    /**
     * Returns a new RecordCollection containing the values of this collection
     * minus the records contained in the other record collection
     *
     * @param  {RecordCollection|ResourceRecords[]} values
     * @return {RecordCollection}
     */

  }, {
    key: "difference",
    value: function difference(values) {
      var otherSet = values instanceof RecordCollection ? values : new RecordCollection(values);

      return this.reject(function (record) {
        return otherSet.has(record);
      });
    }

    /**
     * Returns a new RecordCollection containing the values that exist in both
     * this collection and in the other record collection
     *
     * @param  {RecordCollection|ResourceRecords[]} values
     * @return {RecordCollection}
     */

  }, {
    key: "intersection",
    value: function intersection(values) {
      var otherSet = values instanceof RecordCollection ? values : new RecordCollection(values);

      return this.filter(function (record) {
        return otherSet.has(record);
      });
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

  }, {
    key: "getConflicts",
    value: function getConflicts(values) {
      var otherSet = values instanceof RecordCollection ? values : new RecordCollection(values);

      // remove records that aren't conflicts
      var thisSet = this.difference(otherSet);
      otherSet = otherSet.difference(this);

      // find all records from the other set that conflict
      var conflicts = otherSet.filter(function (otherRecord) {
        return thisSet.some(function (thisRecord) {
          return thisRecord.conflictsWith(otherRecord);
        });
      });

      return conflicts.toArray();
    }
  }]);

  return RecordCollection;
}();

module.exports = RecordCollection;