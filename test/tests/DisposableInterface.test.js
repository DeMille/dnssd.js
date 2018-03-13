const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';
const Fake = require('../Fake');


const DisposableInterface = rewire(dir + '/DisposableInterface');


describe('DisposableInterface', function() {
  // interface addresses, same form as os.networkInterfaces() output
  const interfaceAddresses = {
    'Ethernet':
     [ { address: 'fe80::73b6:73b6:73b6:73b6',
         family: 'IPv6',
         internal: false },
       { address: '169.254.100.175',
         family: 'IPv4',
         internal: false } ],
    'Wi-Fi':
     [ { address: 'fe80::7b30:7b30:7b30:7b30',
         family: 'IPv6',
         internal: false },
       { address: '192.168.1.5',
         family: 'IPv4',
         internal: false } ],
    'Loopback':
     [ { address: '::1',
         family: 'IPv6',
         internal: true },
       { address: '127.0.0.1',
         family: 'IPv4',
         internal: true } ],
  };

  const socket = new Fake.Socket();
  socket.address.returns({});

  const dgram = {createSocket: sinon.stub().returns(socket)};
  const osStub = {networkInterfaces: sinon.stub().returns(interfaceAddresses)};

  const wifi = interfaceAddresses['Wi-Fi'];
  const IPv6 = wifi[0];
  const IPv4 = wifi[1];

  DisposableInterface.__set__('dgram', dgram);
  DisposableInterface.__set__('os', osStub);

  beforeEach(function() {
    socket.reset();
    dgram.createSocket.reset();
  });

  describe('::create()', function() {
    it('should make a new DisposableInterface on INADDR_ANY', function() {
      const intf = DisposableInterface.create();

      expect(intf).to.be.instanceof(DisposableInterface);
      expect(intf._addresses).to.eql([{adderss: '0.0.0.0', family: 'IPv4'}]);
    });

    it('should return new interface from an interface name', function() {
      const intf = DisposableInterface.create('Wi-Fi');

      expect(intf).to.be.instanceof(DisposableInterface);
      expect(intf._addresses).to.equal(wifi);
    });
  });


  describe('::isValidName()', function() {
    it('should be false for bad inputs: "", {}, []', function() {
      expect(DisposableInterface.isValidName()).to.be.false;
      expect(DisposableInterface.isValidName('')).to.be.false;
      expect(DisposableInterface.isValidName({})).to.be.false;
    });

    it('should be true for active interfaces', function() {
      expect(DisposableInterface.isValidName('Ethernet')).to.be.true;
      expect(DisposableInterface.isValidName('Wi-Fi')).to.be.true;
    });

    it('should be false for inactive/non-existent interfaces', function() {
      expect(DisposableInterface.isValidName('ScoobyDoo')).to.be.false;
    });
  });


  describe('#.bind()', function() {
    it('should bind a socket for each address', function(done) {
      const intf = DisposableInterface.create('Wi-Fi');
      sinon.stub(intf, '_bindSocket').returns(Promise.resolve());

      intf.bind().then(done);
    });
  });


  describe('#_bindSocket()', function() {
    it('should create IPv4 socket and resolve when bound', function(done) {
      const intf = DisposableInterface.create('Wi-Fi');

      intf._bindSocket(IPv4).then(() => {
        expect(dgram.createSocket).to.have.been.calledWithMatch({type: 'udp4'});
        done();
      });

      socket.emit('listening');
    });

    it('should create IPv6 socket and resolve when bound', function(done) {
      const intf = DisposableInterface.create('Wi-Fi');

      intf._bindSocket(IPv6).then(() => {
        expect(dgram.createSocket).to.have.been.calledWithMatch({type: 'udp6'});
        done();
      });

      socket.emit('listening');
    });

    it('should reject if bind fails', function(done) {
      const intf = DisposableInterface.create('Wi-Fi');
      intf._bindSocket(IPv4).catch(() => done());

      socket.emit('error');
    });

    it('should _onError when socket closes unexpectedly', function(done) {
      const intf = DisposableInterface.create('Wi-Fi');
      sinon.stub(intf, '_onError', () => done());

      intf._bindSocket(IPv4).then(() => socket.emit('close'));

      socket.emit('listening');
    });

    it('should _onError on any other unexpected error', function(done) {
      const intf = DisposableInterface.create('Wi-Fi');
      sinon.stub(intf, '_onError', () => done());

      intf._bindSocket(IPv4).then(() => socket.emit('error'));

      socket.emit('listening');
    });

    it('should _onMessage when socket receives a message', function(done) {
      const intf = DisposableInterface.create('Wi-Fi');
      sinon.stub(intf, '_onMessage', () => done());

      intf._bindSocket(IPv4).then(() => socket.emit('message'));

      socket.emit('listening');
    });
  });

});
