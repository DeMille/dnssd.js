'use strict';

var misc = require('./misc');

/**
 * Custom error type w/ msg formatting
 *
 * const MyError = customError.create('MyError');
 * throw new MyError('Msg %s %d', 'stuff', 10);
 *
 * @param  {string} errorType
 * @return {Error}
 */
module.exports.create = function createErrorType(errorType) {
  function CustomError(message) {
    this.name = errorType;

    for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key];
    }

    this.message = misc.format.apply(misc, [message].concat(args));

    Error.captureStackTrace(this, CustomError);
  }

  CustomError.prototype = Object.create(Error.prototype);
  CustomError.prototype.constructor = CustomError;

  return CustomError;
};