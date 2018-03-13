const EventEmitter = require('events').EventEmitter;

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
function Emitter(options = {}) {
  // this._eventContexts is a map of maps that track of listener/event pairs
  // created by some object / context
  //
  // {
  //   context: {
  //     listener_fn: event type,
  //   },
  // }
  //
  this._eventContexts = new Map();
  this.setMaxListeners(options.maxListeners || 0);
}

Emitter.prototype = Object.create(EventEmitter.prototype);
Emitter.prototype.constructor = Emitter;


/**
 * Adds a listener that is bound to a context
 */
Emitter.prototype.using = function(context) {
  const emitter = this;

  const contextSpecific = {
    on(event, fn) {
      const listener = fn.bind(context);
      const listeners = emitter._eventContexts.get(context) || new Map();

      // add listener/event to context list
      listeners.set(listener, event);
      emitter._eventContexts.set(context, listeners);

      // register event
      emitter.on(event, listener);

      return contextSpecific;
    },

    once(event, fn) {
      const listener = fn.bind(context);
      const listeners = emitter._eventContexts.get(context) || new Map();

      // add listener/event to context list
      listeners.set(listener, event);
      emitter._eventContexts.set(context, listeners);

      // register event
      emitter.once(event, listener);

      return contextSpecific;
    },
  };

  return contextSpecific;
};

Emitter.prototype.off = function(event, fn) {
  this.removeListener(event, fn);
  return this;
};

/**
 * Remove all listeners that were created by / assigned to given context
 */
Emitter.prototype.removeListenersCreatedBy = function(context) {
  const listeners = this._eventContexts.get(context) || [];

  listeners.forEach((event, fn) => this.off(event, fn));
  this._eventContexts.delete(context);

  return this;
};


module.exports = Emitter;
