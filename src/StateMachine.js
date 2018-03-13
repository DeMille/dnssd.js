const events = require('events');

const has = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);


class StateMachine {
  constructor(states) {
    this.state = '';
    this.prevState = '';
    this.states = states;

    const emitter = new events.EventEmitter();
    this.emit = emitter.emit.bind(emitter);
    this.once = emitter.once.bind(emitter);
    this.on = emitter.on.bind(emitter);
    this.off = emitter.removeListener.bind(emitter);
  }

  _apply(state, fn, ...args) {
    if (has(this.states, state) && has(this.states[state], fn)) {
      this.states[state][fn].call(this, ...args);
    }
  }

  transition(to, ...args) {
    if (!has(this.states, to)) {
      throw new Error(`Can't transition, state ${to} doesn't exist!`);
    }

    this.prevState = this.state;
    this.state = to;

    this._apply(this.prevState, 'exit');
    this._apply(this.state, 'enter', ...args);
  }

  handle(input, ...args) {
    this._apply(this.state, input, ...args);
  }
}


module.exports = StateMachine;
