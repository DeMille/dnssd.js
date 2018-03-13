// Periodically checks for sleep. The interval timer should fire within
// expected range. If it fires later than  expected, it's probably because
// it's coming back from sleep.

const EventEmitter = require('./EventEmitter');

const sleep = new EventEmitter();
const frequency = 60 * 1000; // check for sleep once a minute
const fudge = 5 * 1000;
let last = Date.now();

const interval = setInterval(function checkSleep() {
  const now = Date.now();
  const expected = last + frequency;
  last = now;

  if (now > (expected + fudge)) sleep.emit('wake');
}, frequency);

// don't hold up the process
interval.unref();


module.exports = sleep;
