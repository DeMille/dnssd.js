let counter = 0;
const uniqueId = () => ++counter;


/**
 * TimerContainer is a convenience wrapper for setting/clearing timers
 * plus "lazy" timers that won't fire after waking from sleep.
 * @class
 *
 *  Instead of this:
 *     this.timeout = setTimeout(this.stop.bind(this));
 *     this.doSomehting = setTimeout(...);
 *     this.doThat = setTimeout(...);
 *     ... x10
 *
 *     clearTimeout(this.timeout)      <-- have to keep track of each
 *     clearTimeout(this.doSomething)
 *     clearTimeout(this.doThat)
 *
 * Do this:
 *     this.timers = new TimerContext(this);
 *     this.timers.set('timeout', this.stop, 1000);
 *     this.timers.set(fn1, 100);
 *     this.timers.set(fn2, 200);
 *     ...
 *
 *     this.timers.clear(); <-- clears all, only need to track this.timers
 *
 * Lazy timers that won't fire when walking from sleep. If a js timer
 * is set and the machine goes to sleep the timer will fire as soon as the
 * machine wakes from sleep. This behavior isn't always wanted. Lazy timers
 * won't fire if they are going off later than they are supposed to.
 *
 * Ex:
 *     timers.setLazy(doTimeSensitive, 1000)
 *     > machine sleeps for 1hr
 *     > machine wakes
 *     > doTimeSensitive doesn't fire
 *
 */
class TimerContainer {
  /**
   * Optional context. If used timer functions will be applied with it.
   * @param {object} [context]
   */
  constructor(context) {
    this._context = context;
    this._timers = {};
    this._lazyTimers  = {};
  }

  has(id) {
    return this._timers.hasOwnProperty(id) || this._lazyTimers.hasOwnProperty(id);
  }

  count() {
    return Object.keys(this._timers).length +
           Object.keys(this._lazyTimers).length;
  }

  /**
   * Set a normal timeout (like plain setTimeout)
   *
   * @param {string}   [id] - optional id for timer (so it can be cleared by id later)
   * @param {function} fn
   * @param {number}   delay
   */
  set(...args) {
    const delay = args.pop();
    const fn = args.pop();
    const id = (args.length) ? args.pop() : uniqueId();

    // clear previous duplicates
    if (this._timers[id]) this.clear(id);

    this._timers[id] = setTimeout(() => {
      // remove timer key BERORE running the fn
      // (fn could set another timer with the same id, screwing everything up)
      delete this._timers[id];
      fn.call(this._context);
    }, delay);
  }

  /**
   * Set a 'lazy' timeout that won't call it's fn if the timer fires later
   * than expected. (Won't fire after waking from sleep.)
   *
   * @param {string}   [id] - optional id for timer (so it can be cleared by id later)
   * @param {function} fn
   * @param {number}   delay
   */
  setLazy(...args) {
    const delay = args.pop();
    const fn = args.pop();
    const id = (args.length) ? args.pop() : uniqueId();

    // expect timer to fire after delay +- 5s fudge factor
    // only fire fn if the timer is firing when it was expected to (not after
    // waking from sleep)
    const finish = Date.now() + delay + (5 * 1000);

    // clear previous duplicates
    if (this._lazyTimers[id]) this.clear(id);

    this._lazyTimers[id] = setTimeout(() => {
      // remove timer key BERORE running the fn
      // (fn could set another timer with the same id)
      delete this._lazyTimers[id];
      if (Date.now() < finish) fn.call(this._context);
    }, delay);
  }

  /**
   * Clear specific timer or clear all
   * @param {string} [id] - specific timer to clear
   */
  clear(id) {
    if (!id) {
      Object.keys(this._timers).forEach(timer => this.clear(timer));
      Object.keys(this._lazyTimers).forEach(timer => this.clear(timer));
    }

    if (this._timers.hasOwnProperty(id)) {
      clearTimeout(this._timers[id]);
      delete this._timers[id];
    }

    if (this._lazyTimers.hasOwnProperty(id)) {
      clearTimeout(this._lazyTimers[id]);
      delete this._lazyTimers[id];
    }
  }
}


module.exports = TimerContainer;
