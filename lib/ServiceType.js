'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _toArray(arr) { return Array.isArray(arr) ? arr : Array.from(arr); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var validate = require('./validate');
var ValidationError = require('./customError').create('ValidationError');

/**
 * Creates a new ServiceType
 * @class
 *
 * Used to turn some input into a reliable service type for advertisements and
 * browsers. Does validation on input, throwing errors if there's a problem.
 *
 * Name and protocol are always required, subtypes are optional.
 *
 * String (single argument):
 *   '_http._tcp'
 *   '_http._tcp,mysubtype,anothersub'
 *
 * Object (single argument):
 *   {
 *     name:     '_http',
 *     protocol: '_tcp',
 *     subtypes: ['mysubtype', 'anothersub'],
 *   }
 *
 * Array (single argument):
 *   ['_http', '_tcp', ['mysubtype', 'anothersub']]
 *   ['_http', '_tcp', 'mysubtype', 'anothersub']
 *
 * Strings (multiple arguments):
 *   '_http', '_tcp'
 *   '_http', '_tcp', 'mysubtype', 'anothersub'
 *
 * Validation step is forgiving about required leading underscores and
 * will add them it missing. So 'http.tcp' would be the same as '_http._tcp'.
 *
 * @param {string|object|array|...string} arguments
 */

var ServiceType = function () {
  function ServiceType() {
    _classCallCheck(this, ServiceType);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var input = args.length === 1 ? args[0] : args;

    this.name = null;
    this.protocol = null;
    this.subtypes = [];
    this.isEnumerator = false;

    var type = typeof input === 'undefined' ? 'undefined' : _typeof(input);

    if (type === 'string') this._fromString(input);else if (Array.isArray(input)) this._fromArray(input);else if (type === 'object') this._fromObj(input);else {
      throw new ValidationError('Argument must be string, obj, or array. got %s', type);
    }

    this._validate();
  }

  /**
   * Creates a new ServiceType with tcp protocol
   * Ex:
   *   ServiceType.tcp('_http')
   *   ServiceType.tcp('_http', 'sub1', 'sub2')
   *   ServiceType.tcp(['_http', 'sub1', 'sub2'])
   *
   * @param  {string|array|...string} arguments
   * @return {ServiceType}
   */


  _createClass(ServiceType, [{
    key: '_fromString',


    /**
     * Parse a string into service parts
     * Ex:
     *   '_http._tcp'
     *   '_http._tcp,mysubtype,anothersub'
     */
    value: function _fromString(str) {
      // trim off weird whitespace and extra trailing commas
      var parts = str.replace(/^[ ,]+|[ ,]+$/g, '').split(',').map(function (s) {
        return s.trim();
      });

      this.name = parts[0].split('.').slice(0, -1).join('.');
      this.protocol = parts[0].split('.').slice(-1)[0];
      this.subtypes = parts.slice(1);
    }

    /**
     * Parse an array into service parts
     * Ex:
     *   ['_http', '_tcp', ['mysubtype', 'anothersub']]
     *   ['_http', '_tcp', 'mysubtype', 'anothersub']
     */

  }, {
    key: '_fromArray',
    value: function _fromArray(_ref) {
      var _ref3;

      var _ref2 = _toArray(_ref),
          name = _ref2[0],
          protocol = _ref2[1],
          subtypes = _ref2.slice(2);

      this._fromObj({
        name: name,
        protocol: protocol,
        subtypes: (_ref3 = []).concat.apply(_ref3, _toConsumableArray(subtypes))
      });
    }

    /**
     * Parse an object into service parts
     * Ex: {
     *   name:     '_http',
     *   protocol: '_tcp',
     *   subtypes: ['mysubtype', 'anothersub'],
     * }
     */

  }, {
    key: '_fromObj',
    value: function _fromObj(_ref4) {
      var name = _ref4.name,
          protocol = _ref4.protocol,
          _ref4$subtypes = _ref4.subtypes,
          subtypes = _ref4$subtypes === undefined ? [] : _ref4$subtypes;

      this.name = name;
      this.protocol = protocol;
      this.subtypes = Array.isArray(subtypes) ? subtypes : [subtypes];
    }

    /**
     * Validates service name, protocol, and subtypes. Throws if any of them
     * are invalid.
     */

  }, {
    key: '_validate',
    value: function _validate() {
      if (typeof this.name !== 'string') {
        throw new ValidationError('Service name must be a string, got %s', _typeof(this.name));
      }

      if (!this.name) {
        throw new ValidationError("Service name can't be empty");
      }

      if (typeof this.protocol !== 'string') {
        throw new ValidationError('Protocol must be a string, got %s', _typeof(this.protocol));
      }

      if (!this.protocol) {
        throw new ValidationError("Protocol can't be empty");
      }

      // massage properties a little before validating
      // be lenient about underscores, add when missing
      if (this.name.substr(0, 1) !== '_') this.name = '_' + this.name;
      if (this.protocol.substr(0, 1) !== '_') this.protocol = '_' + this.protocol;

      // special case: check this service type is the service enumerator
      if (this.name === '_services._dns-sd' && this.protocol === '_udp') {
        this.isEnumerator = true;

        // enumerators shouldn't have subtypes
        this.subtypes = [];

        // skip validation for service enumerators, they would fail since
        // '_services._dns-sd' is getting shoehorned into this.name
        return;
      }

      validate.serviceName(this.name);
      validate.protocol(this.protocol);
      this.subtypes.forEach(function (subtype) {
        return validate.label(subtype, 'Subtype');
      });
    }

    /**
     * A string representation of the service
     * ex: '_http._tcp,sub1,sub2'
     */

  }, {
    key: 'toString',
    value: function toString() {
      return this.subtypes.length ? this.name + '.' + this.protocol + ',' + this.subtypes.join(',') : this.name + '.' + this.protocol;
    }
  }], [{
    key: 'tcp',
    value: function tcp() {
      var _ref5;

      // insert protocol in the right spot (second arg)
      var input = (_ref5 = []).concat.apply(_ref5, arguments);
      input.splice(1, 0, '_tcp');

      return new ServiceType(input);
    }

    /**
     * Creates a new ServiceType with udp protocol
     * Ex:
     *   ServiceType.tcp('_sleep-proxy,sub1,sub2')
     *   ServiceType.tcp('_sleep-proxy', 'sub1', 'sub2')
     *   ServiceType.tcp(['_sleep-proxy', 'sub1', 'sub2'])
     *
     * @param  {string|array|...string} [arguments]
     * @return {ServiceType}
     */

  }, {
    key: 'udp',
    value: function udp() {
      var _ref6;

      // insert protocol in the right spot (second arg)
      var input = (_ref6 = []).concat.apply(_ref6, arguments);
      input.splice(1, 0, '_udp');

      return new ServiceType(input);
    }

    /**
     * Creates a new service enumerator
     * @return {ServiceType}
     */

  }, {
    key: 'all',
    value: function all() {
      return new ServiceType('_services._dns-sd._udp');
    }
  }]);

  return ServiceType;
}();

module.exports = ServiceType;