'use strict';

// Periodically checks for sleep. The interval timer should fire within
// expected range. If it fires later than  expected, it's probably because
// it's coming back from sleep.

var EventEmitter = require('./EventEmitter');

var sleep = new EventEmitter();
var frequency = 60 * 1000; // check for sleep once a minute
var fudge = 5 * 1000;
var last = Date.now();

var interval = setInterval(function checkSleep() {
  var now = Date.now();
  var expected = last + frequency;
  last = now;

  if (now > expected + fudge) sleep.emit('wake');
}, frequency);

// don't hold up the process
interval.unref();

module.exports = sleep;