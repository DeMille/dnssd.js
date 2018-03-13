'use strict';

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _getPrototypeOf = require('babel-runtime/core-js/object/get-prototype-of');

var _getPrototypeOf2 = _interopRequireDefault(_getPrototypeOf);

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require('babel-runtime/helpers/createClass');

var _createClass3 = _interopRequireDefault(_createClass2);

var _possibleConstructorReturn2 = require('babel-runtime/helpers/possibleConstructorReturn');

var _possibleConstructorReturn3 = _interopRequireDefault(_possibleConstructorReturn2);

var _inherits2 = require('babel-runtime/helpers/inherits');

var _inherits3 = _interopRequireDefault(_inherits2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var os = require('os');
var dgram = require('dgram');

var NetworkInterface = require('./NetworkInterface');

var filename = require('path').basename(__filename);
var debug = require('./debug')('dnssd:' + filename);

/**
 * Creates a network interface obj using some ephemeral port like 51254
 * @class
 * @extends NetworkInterface
 *
 * Used for dnssd.resolve() functions where you only need to send a query
 * packet, get an answer, and shut down. (Sending packets from port 5353
 * would indicate a fully compliant responder). Packets sent by these interface
 * objects will be treated as 'legacy' queries by other responders.
 */

var DisposableInterface = function (_NetworkInterface) {
  (0, _inherits3.default)(DisposableInterface, _NetworkInterface);

  function DisposableInterface(name, addresses) {
    (0, _classCallCheck3.default)(this, DisposableInterface);

    debug('Creating new DisposableInterface on ' + name + ':');

    var _this = (0, _possibleConstructorReturn3.default)(this, (DisposableInterface.__proto__ || (0, _getPrototypeOf2.default)(DisposableInterface)).call(this, name));

    _this._addresses = addresses;
    return _this;
  }

  /**
   * Creates/returns DisposableInterfaces from a name or names of interfaces.
   * Always returns an array of em.
   * @static
   *
   * Ex:
   * > const interfaces = DisposableInterface.createEach('eth0');
   * > const interfaces = DisposableInterface.createEach(['eth0', 'wlan0']);
   *
   * @param  {string|string[]} args
   * @return {DisposableInterface[]}
   */


  (0, _createClass3.default)(DisposableInterface, [{
    key: 'bind',
    value: function bind() {
      var _this2 = this;

      return _promise2.default.all(this._addresses.map(function (addr) {
        return _this2._bindSocket(addr);
      })).then(function () {
        debug('Interface ' + _this2._id + ' now bound');
        _this2._isBound = true;
      });
    }
  }, {
    key: '_bindSocket',
    value: function _bindSocket(address) {
      var _this3 = this;

      var isPending = true;

      var promise = new _promise2.default(function (resolve, reject) {
        var socketType = address.family === 'IPv6' ? 'udp6' : 'udp4';
        var socket = dgram.createSocket({ type: socketType });

        socket.on('error', function (err) {
          if (isPending) reject(err);else _this3._onError(err);
        });

        socket.on('close', function () {
          _this3._onError(new Error('Socket closed unexpectedly'));
        });

        socket.on('message', _this3._onMessage.bind(_this3));

        socket.on('listening', function () {
          var sinfo = socket.address();
          debug(_this3._id + ' listening on ' + sinfo.address + ':' + sinfo.port);

          _this3._sockets.push(socket);
          resolve();
        });

        socket.bind({ address: address.address });
      });

      return promise.then(function () {
        isPending = false;
      });
    }
  }], [{
    key: 'create',
    value: function create(name) {
      var addresses = [{ adderss: '0.0.0.0', family: 'IPv4' }];

      return name ? new DisposableInterface(name, os.networkInterfaces()[name]) : new DisposableInterface('INADDR_ANY', addresses);
    }

    /**
     * Checks if the names are interfaces that exist in os.networkInterfaces()
     * @static
     *
     * @param  {string|string[]} arg - interface name/names
     * @return {boolean}
     */

  }, {
    key: 'isValidName',
    value: function isValidName(name) {
      if (!name || typeof name !== 'string') return false;
      return !!~(0, _keys2.default)(os.networkInterfaces()).indexOf(name);
    }
  }]);
  return DisposableInterface;
}(NetworkInterface);

module.exports = DisposableInterface;