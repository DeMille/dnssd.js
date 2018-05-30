const _ = require('lodash');

const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const Packet         = require(dir + '/Packet');
const ResourceRecord = require(dir + '/ResourceRecord');
const QueryRecord    = require(dir + '/QueryRecord');

const Fake = require('../Fake');


const NetworkInterface = rewire(dir + '/NetworkInterface');


describe('NetworkInterface', function() {
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

  const osStub = {networkInterfaces: sinon.stub().returns(interfaceAddresses)};
  NetworkInterface.__set__('os', osStub);

  beforeEach(function() {
    NetworkInterface.__set__('activeInterfaces', {});
  });


  describe('::get()', function() {
    it('should make a new NetworkInterface for `any`', function() {
      const intf = NetworkInterface.get();

      expect(intf).to.be.instanceof(NetworkInterface);
    });

    it('should return existing interface', function() {
      const intf  = NetworkInterface.get();
      const copy = NetworkInterface.get();

      expect(intf).to.equal(copy); // same object
    });

    it('should make a new NetworkInterface using a given multicast interface name', function() {
      const intf = NetworkInterface.get('Ethernet');
      const copy = NetworkInterface.get('Ethernet');

      expect(intf).to.be.instanceof(NetworkInterface);
      expect(intf).to.equal(copy); // same object
    });

    it('should make a new NetworkInterface using a given multicast IPv4 address', function() {
      const intf = NetworkInterface.get('192.168.1.5');
      const copy = NetworkInterface.get('192.168.1.5');

      expect(intf).to.be.instanceof(NetworkInterface);
      expect(intf).to.equal(copy); // same object
    });

    it('should throw with a decent error msg on bad input', function() {
      const one = NetworkInterface.get.bind(null, 'bad input'); // unknown interface
      const two = NetworkInterface.get.bind(null, '111.222.333.444'); // unknown address

      expect(one).to.throw();
      expect(two).to.throw();
    });
  });


  describe('::getLoopback()', function() {
    it('should return the name of the loopback interface, if any', function() {
      expect(NetworkInterface.getLoopback()).to.equal('Loopback');
    });
  });


  describe('#constructor()', function() {
    it('should init with proper defaults', function() {
      const intf = new NetworkInterface();

      expect(intf._usingMe).to.equal(0);
      expect(intf._isBound).to.equal(false);
      expect(intf._sockets).to.be.empty;
    });
  });


  describe('#bind()', function() {
    it('should resolve when every socket is bound', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_bindSocket').returns(Promise.resolve());

      intf.bind().then(() => {
        expect(intf._isBound).to.be.true;
        expect(intf._usingMe).to.equal(1);
        done();
      });
    });

    it('should reject if binding fails', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_bindSocket').returns(Promise.reject());

      intf.bind().catch(() => {
        expect(intf._isBound).to.be.false;
        expect(intf._usingMe).to.equal(0);
        done();
      });
    });

    it('should resolve immediately if already bound', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_bindSocket').returns(Promise.resolve());

      // bind twice, 2nd bind should be immediate with no re-bind
      intf.bind()
        .then(() => {
          expect(intf._bindSocket).to.have.callCount(1);
          intf.bind();
        })
        .then(() => {
          expect(intf._bindSocket).to.have.callCount(1);
          expect(intf._usingMe).to.equal(2);
          done();
        });
    });

    it('should prevent concurrent binds, only binding once', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_bindSocket').returns(Promise.resolve());

      const onSuccess = _.after(2, () => {
        expect(intf._bindSocket).to.have.callCount(1);
        expect(intf._usingMe).to.equal(2);
        expect(intf._isBound).to.be.true;
        done();
      });

      intf.bind().then(onSuccess);
      intf.bind().then(onSuccess);
    });

    it('should fail on both concurrents if binding fails', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_bindSocket').returns(Promise.reject());

      const onFail = _.after(2, () => {
        expect(intf._usingMe).to.equal(0);
        expect(intf._isBound).to.be.false;
        done();
      });

      intf.bind().catch(onFail);
      intf.bind().catch(onFail);
    });
  });


  describe('#_bindSocket()', function() {
    const socket = new Fake.Socket();
    socket.address.returns({});

    const dgram = {createSocket: sinon.stub().returns(socket)};

    let revert;

    before(function() {
      revert = NetworkInterface.__set__('dgram', dgram);
    });

    after(function() {
      revert();
    });

    beforeEach(function() {
      socket.reset();
      dgram.createSocket.reset();
    });

    it('should create IPv4 socket and resolve when bound', function(done) {
      const intf = new NetworkInterface();

      intf._bindSocket().then(() => {
        expect(dgram.createSocket).to.have.been.calledWithMatch({type: 'udp4'});
        done();
      });

      socket.emit('listening');
    });

    it('should `setMulticastInterface` if needed', function(done) {
      const intf = new NetworkInterface('Ethernet', '169.254.100.175');

      intf._bindSocket().then(() => {
        expect(intf._sockets[0].setMulticastInterface)
          .to.have.been.calledWith('169.254.100.175');

        done();
      });

      socket.emit('listening');
    });

    it('should reject if bind fails', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_onError');

      intf._bindSocket().catch(() => {
        expect(intf._onError).to.not.have.been.called;
        expect(intf._sockets).to.be.empty;
        done();
      });

      socket.emit('error');
    });

    it('should _onError when socket closes unexpectedly', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_onError', () => done());

      intf._bindSocket().then(() => {
        socket.emit('close');
      });

      socket.emit('listening');
    });

    it('should _onError on socket errors', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_onError', () => done());

      intf._bindSocket().then(() => {
        socket.emit('error');
      });

      socket.emit('listening');
    });

    it('should _onMessage when socket receives a message', function(done) {
      const intf = new NetworkInterface();
      sinon.stub(intf, '_onMessage', () => done());

      intf._bindSocket();
      socket.emit('message', 'fake msg', {fake: 'rinfo'});
    });
  });


  describe('#_addToCache()', function() {
    it('should add records to cache & flush unique records', function() {
      const intf = new NetworkInterface();

      const unique = new ResourceRecord.TXT({name: 'TXT'});
      const shared = new ResourceRecord.PTR({name: 'PTR'});

      const packet = new Packet();
      packet.setAnswers([unique]);
      packet.setAdditionals([shared]);

      sinon.spy(intf.cache, 'add');
      sinon.spy(intf.cache, 'flushRelated');

      intf._addToCache(packet);

      expect(intf.cache.flushRelated).to.have.been
        .calledOnce
        .calledWith(unique);

      expect(intf.cache.add).to.have.been
        .calledTwice
        .calledWith(unique)
        .calledWith(shared);
    });
  });


  describe('#_onMessage()', function() {
    const msg = (new Packet()).toBuffer();
    const rinfo = {address: '1.1.1.1', port: 5353};
    const PacketConstructor = sinon.stub();
    let revert;

    before(function() {
      revert = NetworkInterface.__set__('Packet', PacketConstructor);
    });

    after(function() {
      revert();
    });

    afterEach(function() {
      PacketConstructor.resetBehavior();
    });

    it('should emit answer event on answer messages', function(done) {
      const intf = new NetworkInterface();

      const answerPacket = new Packet();
      answerPacket.setAnswers([new ResourceRecord.TXT({name: 'TXT'})]);
      answerPacket.setResponseBit();

      PacketConstructor.returns(answerPacket);

      intf.on('answer', (arg) => {
        expect(arg).to.equal(answerPacket);
        done();
      });

      intf._onMessage(msg, rinfo);
    });

    it('should emit probe event on probe messages', function(done) {
      const intf = new NetworkInterface();

      const probePacket = new Packet();
      probePacket.setQuestions([new QueryRecord({name: 'TXT'})]);
      probePacket.setAuthorities([new ResourceRecord.TXT({name: 'TXT'})]);

      PacketConstructor.returns(probePacket);

      intf.on('probe', (arg) => {
        expect(arg).to.equal(probePacket);
        done();
      });

      intf._onMessage(msg, rinfo);
    });

    it('should emit query event on query messages', function(done) {
      const intf = new NetworkInterface();

      const queryPacket = new Packet();
      queryPacket.setQuestions([new QueryRecord({name: 'TXT'})]);

      PacketConstructor.returns(queryPacket);

      intf.on('query', (arg) => {
        expect(arg).to.equal(queryPacket);
        done();
      });

      intf._onMessage(msg, rinfo);
    });

    it('should skip over packets that are invalid', function() {
      const intf = new NetworkInterface();

      const invalidPacket = new Packet();
      invalidPacket.setQuestions([new QueryRecord({name: 'TXT'})]);
      sinon.stub(invalidPacket, 'isValid').returns(false);

      PacketConstructor.returns(invalidPacket);

      sinon.stub(intf, 'emit');
      intf._onMessage(msg, rinfo);

      expect(intf.emit).to.not.have.been.called;
    });

    it('should keep track of previously sent packets when debugging', function() {
      const debug = function() {};
      debug.isEnabled = true;
      debug.verbose = function() {};
      debug.verbose.isEnabled = true;

      const revertDebug = NetworkInterface.__set__('debug', debug);
      PacketConstructor.returns(new Packet());

      const intf = new NetworkInterface();
      intf._buffers.push((new Packet()).toBuffer());

      intf._onMessage(msg, rinfo);

      expect(intf._buffers).to.be.empty;
      revertDebug();
    });
  });


  describe('#hasRecentlySent()', function() {
    it('should be true if recently sent / false if not', sinon.test(function() {
      const intf = new NetworkInterface();
      const SRV  = new ResourceRecord.SRV({name: 'SRV'});

      intf._history.add(SRV);
      expect(intf.hasRecentlySent(SRV)).to.be.true;
      expect(intf.hasRecentlySent(SRV, 5)).to.be.true;

      this.clock.tick(10 * 1000);
      expect(intf.hasRecentlySent(SRV, 5)).to.be.false;
    }));
  });


  describe('#send()', function() {
    const answer = new ResourceRecord.TXT({name: 'Answer Record'});
    const question = new QueryRecord({name: 'Question Record'});
    const callback = sinon.stub();

    const socket = new Fake.Socket();
    socket.address.returns({family: 'IPv4'});

    const intf = new NetworkInterface();
    intf._sockets.push(socket);

    beforeEach(function() {
      intf._isBound = true;
      callback.reset();
      socket.reset();
      socket.send.resetBehavior();
      socket.send.yields();
    });

    it('should do nothing if not bound yet', function() {
      intf._isBound = false;
      intf.send(null, null, callback);

      expect(callback).to.have.been.called;
      expect(socket.send).to.not.have.been.called;
    });

    it('should do nothing if packet is empty', function() {
      intf.send(new Packet(), null, callback);

      expect(callback).to.have.been.called;
      expect(socket.send).to.not.have.been.called;
    });

    it('should do nothing if destination is not link local', function() {
      const packet = new Packet();
      packet.setQuestions([question]);

      intf.send(packet, {address: '7.7.7.7'}, callback);

      expect(socket.send).to.not.have.been.called;
    });

    it('should send packet to given destination', function() {
      const packet = new Packet();
      packet.setQuestions([question]);

      const destination = {address: '192.168.1.10', port: 4321};

      intf.send(packet, destination, callback);

      expect(socket.send.firstCall.args[3]).to.equal(destination.port);
      expect(socket.send.firstCall.args[4]).to.equal(destination.address);
      expect(callback).to.have.been.called;
    });

    it('should not send packet to destination on wrong IPv socket', function() {
      const packet = new Packet();
      packet.setQuestions([question]);

      intf.send(packet, {address: '::1'}, callback);

      expect(socket.send).to.not.have.been.called;
    });

    it('should send packet to multicast address', function() {
      const packet = new Packet();
      packet.setQuestions([question]);

      intf.send(packet, null, callback);

      expect(socket.send.firstCall.args[3]).to.equal(5353);
      expect(socket.send.firstCall.args[4]).to.equal('224.0.0.251');
    });

    it('should add outgoing answers to interface history', function() {
      const packet = new Packet();
      packet.setAnswers([answer]);
      packet.setResponseBit();

      intf.send(packet, null, callback);

      expect(intf.hasRecentlySent(answer)).to.be.true;
    });

    it('should keep track of sent buffers for debugging', function() {
      const debug = function() {};
      debug.isEnabled = true;
      debug.verbose = function() {};
      debug.verbose.isEnabled = true;

      const revert = NetworkInterface.__set__('debug', debug);

      const packet = new Packet();
      packet.setQuestions([question]);

      intf.send(packet, null, callback);

      expect(intf._buffers).to.be.not.empty;
      revert();
    });

    it('should split packet and resend on EMSGSIZE', sinon.test(function() {
      const err = new Error();
      err.code = 'EMSGSIZE';

      socket.send.onFirstCall().yields(err);

      const packet = new Packet();
      packet.setQuestions([question]);

      this.spy(intf, 'send');
      intf.send(packet);

      expect(intf.send).to.have.callCount(3); // first call + 2 more for each half
    }));

    it('should _onError for anything else', function(done) {
      socket.send.yields(new Error());

      const packet = new Packet();
      packet.setQuestions([question]);

      intf.on('error', () => done());
      intf.send(packet);
    });
  });


  describe('#_onError()', function() {
    it('should shutdown and emit error', function() {
      const intf = new NetworkInterface();
      sinon.stub(intf, 'stop');
      sinon.stub(intf, 'emit');

      const err = new Error();
      intf._onError(err);

      expect(intf.stop).to.have.been.called;
      expect(intf.emit).to.have.been.calledWith('error', err);
    });
  });


  describe('#stopUsing()', function() {
    it('should only shutdown when no one is using it anymore', function() {
      const intf = new NetworkInterface();
      intf._usingMe = 2;

      sinon.stub(intf, 'stop');

      intf.stopUsing();
      expect(intf.stop).to.not.have.been.called;

      intf.stopUsing();
      expect(intf.stop).to.have.been.called;
    });
  });


  describe('#stop()', function() {
    it('should remove all listeners from sockets before closing', function() {
      const intf = new NetworkInterface();
      const socket = new Fake.Socket();

      socket.close = () => {
        socket.emit('close');
      };

      socket.on('close', () => {
        throw new Error('Should remove listeners first!');
      });

      intf._sockets = [socket];
      intf.stop();
    });

    it('should not throw on socket.close() calls', function() {
      const intf = new NetworkInterface();
      const socket = new Fake.Socket();

      socket.close.throws('Already closed!');

      intf._sockets = [socket];
      intf.stop();
    });
  });

});
