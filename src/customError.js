const misc = require('./misc');

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
  function CustomError(message, ...args) {
    this.name = errorType;
    this.message = misc.format(message, ...args);

    Error.captureStackTrace(this, CustomError);
  }

  CustomError.prototype = Object.create(Error.prototype);
  CustomError.prototype.constructor = CustomError;

  return CustomError;
};
