let os = require('os');
let dgram = require('dgram');

const NetworkInterface = require('./NetworkInterface');

const filename = require('path').basename(__filename);
const debug = require('./debug')(`dnssd:${filename}`);


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
class DisposableInterface extends NetworkInterface {
  constructor(name, addresses) {
    debug(`Creating new DisposableInterface on ${name}:`);
    super(name);

    this._addresses = addresses;
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
  static create(name) {
    const addresses = [
      {adderss: '0.0.0.0', family: 'IPv4'},
      // {adderss: '::', family: 'IPv6'},
    ];

    return (name)
      ? new DisposableInterface(name, os.networkInterfaces()[name])
      : new DisposableInterface('INADDR_ANY', addresses);
  }

  /**
   * Checks if the names are interfaces that exist in os.networkInterfaces()
   * @static
   *
   * @param  {string|string[]} arg - interface name/names
   * @return {boolean}
   */
  static isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    return !!~Object.keys(os.networkInterfaces()).indexOf(name);
  }


  bind() {
    return Promise.all(this._addresses.map(addr => this._bindSocket(addr)))
      .then(() => {
        debug(`Interface ${this._id} now bound`);
        this._isBound = true;
      });
  }


  _bindSocket(address) {
    let isPending = true;

    const promise = new Promise((resolve, reject) => {
      const socketType = (address.family === 'IPv6') ? 'udp6' : 'udp4';
      const socket = dgram.createSocket({type: socketType});

      socket.on('error', (err) => {
        if (isPending) reject(err);
        else this._onError(err);
      });

      socket.on('close', () => {
        this._onError(new Error('Socket closed unexpectedly'));
      });

      socket.on('message', this._onMessage.bind(this));

      socket.on('listening', () => {
        const sinfo = socket.address();
        debug(`${this._id} listening on ${sinfo.address}:${sinfo.port}`);

        this._sockets.push(socket);
        resolve();
      });

      socket.bind({address: address.address});
    });

    return promise.then(() => {
      isPending = false;
    });
  }
}


module.exports = DisposableInterface;
