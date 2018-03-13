'use strict';

var _create = require('babel-runtime/core-js/object/create');

var _create2 = _interopRequireDefault(_create);

var _map = require('babel-runtime/core-js/map');

var _map2 = _interopRequireDefault(_map);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var EventEmitter = require('events').EventEmitter;

/**
 * Node EventEmitter + some convenience methods
 * @class
 *
 * This emitter lets you do this:
 *
 * > emitter.using(obj)
 * >   .on('event', obj.handleEvent)
 * >   .on('thing', obj.doThing)
 * >
 * > emitter.removeListenersCreatedBy(obj)
 *
 * Because this doesn't work:
 *
 * > emitter.on('event', this.fn.bind(this))
 * > emitter.removeListener('event', this.fn.bind(this))
 *
 * @param {object} options
 */
function Emitter() {
  var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

  // this._eventContexts is a map of maps that track of listener/event pairs
  // created by some object / context
  //
  // {
  //   context: {
  //     listener_fn: event type,
  //   },
  // }
  //
  this._eventContexts = new _map2.default();
  this.setMaxListeners(options.maxListeners || 0);
}

Emitter.prototype = (0, _create2.default)(EventEmitter.prototype);
Emitter.prototype.constructor = Emitter;

/**
 * Adds a listener that is bound to a context
 */
Emitter.prototype.using = function (context) {
  var emitter = this;

  var contextSpecific = {
    on: function on(event, fn) {
      var listener = fn.bind(context);
      var listeners = emitter._eventContexts.get(context) || new _map2.default();

      // add listener/event to context list
      listeners.set(listener, event);
      emitter._eventContexts.set(context, listeners);

      // register event
      emitter.on(event, listener);

      return contextSpecific;
    },
    once: function once(event, fn) {
      var listener = fn.bind(context);
      var listeners = emitter._eventContexts.get(context) || new _map2.default();

      // add listener/event to context list
      listeners.set(listener, event);
      emitter._eventContexts.set(context, listeners);

      // register event
      emitter.once(event, listener);

      return contextSpecific;
    }
  };

  return contextSpecific;
};

Emitter.prototype.off = function (event, fn) {
  this.removeListener(event, fn);
  return this;
};

/**
 * Remove all listeners that were created by / assigned to given context
 */
Emitter.prototype.removeListenersCreatedBy = function (context) {
  var _this = this;

  var listeners = this._eventContexts.get(context) || [];

  listeners.forEach(function (event, fn) {
    return _this.off(event, fn);
  });
  this._eventContexts.delete(context);

  return this;
};

module.exports = Emitter;