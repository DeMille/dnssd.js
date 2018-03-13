let validate = require('./validate');
const ValidationError = require('./customError').create('ValidationError');


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
class ServiceType {
  constructor(...args) {
    const input = (args.length === 1) ? args[0] : args;

    this.name = null;
    this.protocol = null;
    this.subtypes = [];
    this.isEnumerator = false;

    const type = typeof input;

    if (type === 'string') this._fromString(input);
    else if (Array.isArray(input)) this._fromArray(input);
    else if (type === 'object') this._fromObj(input);
    else {
      throw new ValidationError('Argument must be string, obj, or array. got %s',
        type);
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
  static tcp(...args) {
    // insert protocol in the right spot (second arg)
    const input = [].concat(...args);
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
  static udp(...args) {
    // insert protocol in the right spot (second arg)
    const input = [].concat(...args);
    input.splice(1, 0, '_udp');

    return new ServiceType(input);
  }


  /**
   * Creates a new service enumerator
   * @return {ServiceType}
   */
  static all() {
    return new ServiceType('_services._dns-sd._udp');
  }


  /**
   * Parse a string into service parts
   * Ex:
   *   '_http._tcp'
   *   '_http._tcp,mysubtype,anothersub'
   */
  _fromString(str) {
    // trim off weird whitespace and extra trailing commas
    const parts = str.replace(/^[ ,]+|[ ,]+$/g, '').split(',').map(s => s.trim());

    this.name     = parts[0].split('.').slice(0, -1).join('.');
    this.protocol = parts[0].split('.').slice(-1)[0];
    this.subtypes = parts.slice(1);
  }


  /**
   * Parse an array into service parts
   * Ex:
   *   ['_http', '_tcp', ['mysubtype', 'anothersub']]
   *   ['_http', '_tcp', 'mysubtype', 'anothersub']
   */
  _fromArray([name, protocol, ...subtypes]) {
    this._fromObj({
      name,
      protocol,
      subtypes: [].concat(...subtypes),
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
  _fromObj({name, protocol, subtypes = []}) {
    this.name = name;
    this.protocol = protocol;
    this.subtypes = (Array.isArray(subtypes)) ? subtypes : [subtypes];
  }


  /**
   * Validates service name, protocol, and subtypes. Throws if any of them
   * are invalid.
   */
  _validate() {
    if (typeof this.name !== 'string') {
      throw new ValidationError('Service name must be a string, got %s',
        typeof this.name);
    }

    if (!this.name) {
      throw new ValidationError("Service name can't be empty");
    }

    if (typeof this.protocol !== 'string') {
      throw new ValidationError('Protocol must be a string, got %s',
        typeof this.protocol);
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
    this.subtypes.forEach(subtype => validate.label(subtype, 'Subtype'));
  }


  /**
   * A string representation of the service
   * ex: '_http._tcp,sub1,sub2'
   */
  toString() {
    return (this.subtypes.length)
      ? this.name + '.' + this.protocol + ',' + this.subtypes.join(',')
      : this.name + '.' + this.protocol;
  }
}


module.exports = ServiceType;
