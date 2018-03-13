"use strict";

var _classCallCheck2 = require("babel-runtime/helpers/classCallCheck");

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require("babel-runtime/helpers/createClass");

var _createClass3 = _interopRequireDefault(_createClass2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * const mutex = new Mutex();
 *
 * function limitMe() {
 *   mutex.lock((unlock) => {
 *     asyncFn().then(unlock);
 *   });
 * }
 *
 * limitMe();
 * limitMe(); // <-- will wait for first call to finish & unlock
 *
 */
var Mutex = function () {
  function Mutex() {
    (0, _classCallCheck3.default)(this, Mutex);

    this._queue = [];
    this.locked = false;
  }

  (0, _createClass3.default)(Mutex, [{
    key: "lock",
    value: function lock(fn) {
      var _this = this;

      var unlock = function unlock() {
        var nextFn = _this._queue.shift();

        if (nextFn) nextFn(unlock);else _this.locked = false;
      };

      if (!this.locked) {
        this.locked = true;
        fn(unlock);
      } else {
        this._queue.push(fn);
      }
    }
  }]);
  return Mutex;
}();

module.exports = Mutex;