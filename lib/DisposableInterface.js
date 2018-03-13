'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

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
  _inherits(DisposableInterface, _NetworkInterface);

  function DisposableInterface(name, addresses) {
    _classCallCheck(this, DisposableInterface);

    debug('Creating new DisposableInterface on ' + name + ':');

    var _this = _possibleConstructorReturn(this, (DisposableInterface.__proto__ || Object.getPrototypeOf(DisposableInterface)).call(this, name));

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


  _createClass(DisposableInterface, [{
    key: 'bind',
    value: function bind() {
      var _this2 = this;

      return Promise.all(this._addresses.map(function (addr) {
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

      var promise = new Promise(function (resolve, reject) {
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
      return !!~Object.keys(os.networkInterfaces()).indexOf(name);
    }
  }]);

  return DisposableInterface;
}(NetworkInterface);

module.exports = DisposableInterface;