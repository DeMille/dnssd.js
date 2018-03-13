'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var events = require('events');

var has = function has(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
};

var StateMachine = function () {
  function StateMachine(states) {
    _classCallCheck(this, StateMachine);

    this.state = '';
    this.prevState = '';
    this.states = states;

    var emitter = new events.EventEmitter();
    this.emit = emitter.emit.bind(emitter);
    this.once = emitter.once.bind(emitter);
    this.on = emitter.on.bind(emitter);
    this.off = emitter.removeListener.bind(emitter);
  }

  _createClass(StateMachine, [{
    key: '_apply',
    value: function _apply(state, fn) {
      if (has(this.states, state) && has(this.states[state], fn)) {
        var _states$state$fn;

        for (var _len = arguments.length, args = Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
          args[_key - 2] = arguments[_key];
        }

        (_states$state$fn = this.states[state][fn]).call.apply(_states$state$fn, [this].concat(args));
      }
    }
  }, {
    key: 'transition',
    value: function transition(to) {
      if (!has(this.states, to)) {
        throw new Error('Can\'t transition, state ' + to + ' doesn\'t exist!');
      }

      this.prevState = this.state;
      this.state = to;

      this._apply(this.prevState, 'exit');

      for (var _len2 = arguments.length, args = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        args[_key2 - 1] = arguments[_key2];
      }

      this._apply.apply(this, [this.state, 'enter'].concat(args));
    }
  }, {
    key: 'handle',
    value: function handle(input) {
      for (var _len3 = arguments.length, args = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        args[_key3 - 1] = arguments[_key3];
      }

      this._apply.apply(this, [this.state, input].concat(args));
    }
  }]);

  return StateMachine;
}();

module.exports = StateMachine;