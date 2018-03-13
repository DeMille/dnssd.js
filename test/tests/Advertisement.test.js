const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const ServiceType    = require(dir + '/ServiceType');
const ResourceRecord = require(dir + '/ResourceRecord');
const Packet         = require(dir + '/Packet');

const Fake = require('../Fake');


const Advertisement = rewire(dir + '/Advertisement');


describe('Advertisement', function() {
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
  Advertisement.__set__('os', osStub);

  const intf = new Fake.NetworkInterface();
  const responder = new Fake.Responder();
  const ResponderConstructor = sinon.stub().returns(responder);

  // change the networkInterfaces dependency within Advertisement.js so all new
  // advertisements have: Advertisement._interface = []
  const NetworkInterfaceMock = {get: sinon.stub().returns(intf)};

  Advertisement.__set__('NetworkInterface', NetworkInterfaceMock);
  Advertisement.__set__('Responder', ResponderConstructor);

  const sleep = Advertisement.__get__('sleep');

  beforeEach(function() {
    intf.reset();
    responder.reset();
    ResponderConstructor.reset();

    // reset info shared between multiple responders (sleep)
    // otherwise it would slowly accumulate listeners from each test
    sleep.removeAllListeners();
  });

  describe('#constructor()', function() {
    it('should be ok if new keyword missing', function() {
      expect(Advertisement('_http._tcp', 1234)).to.be.instanceof(Advertisement);
    });

    it('should accept service param as a ServiceType (no throw)', function() {
      new Advertisement(new ServiceType('_http._tcp'), 1234);
    });

    it('should accept service param as an object (no throw)', function() {
      new Advertisement({name: '_http', protocol: '_tcp'}, 1234);
    });

    it('should accept service param as a string (no throw)', function() {
      new Advertisement('_http._tcp', 1234);
    });

    it('should accept service param as an array (no throw)', function() {
      new Advertisement(['_http', '_tcp'], 1234);
    });

    it('should throw on invalid service types', function() {
      expect(() => new Advertisement('gunna throw', 1234)).to.throw(Error);
    });

    it('should throw on missing/invalid ports', function() {
      expect(() => new Advertisement('_http._tcp')).to.throw(Error);
      expect(() => new Advertisement('_http._tcp', 'Port 1000000')).to.throw(Error);
    });

    it('should throw on invalid TXT data', function() {
      const options = {txt: 'invalid'};
      expect(() => new Advertisement('_http._tcp', 1234, options)).to.throw(Error);
    });

    it('should throw on invalid instance names', function() {
      const options = {name: 123};
      expect(() => new Advertisement('_http._tcp', 1234, options)).to.throw(Error);
    });

    it('should throw on invalid hostnames', function() {
      const options = {host: 123};
      expect(() => new Advertisement('_http._tcp', 1234, options)).to.throw(Error);
    });
  });


  describe('#start()', function() {
    it('should return this', function() {
      const ad = new Advertisement('_http._tcp', 1234);

      expect(ad.start()).to.equal(ad);
    });

    it('should bind interfaces & start advertising', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);

      sinon.stub(ad, '_getDefaultID').returns(Promise.resolve());
      sinon.stub(ad, '_advertiseHostname').returns(Promise.resolve());

      sinon.stub(ad, '_advertiseService', () => {
        expect(intf.bind).to.have.been.called;
        done();
      });

      ad.start();
    });

    it('should return early if already started', function() {
      const ad = new Advertisement('_http._tcp', 1234);
      sinon.stub(ad, '_getDefaultID');
      sinon.stub(ad, '_advertiseHostname');
      sinon.stub(ad, '_advertiseService');

      ad.start();
      ad.start(); // <-- does nothing

      // wait for promises
      setTimeout(() => expect(ad._getDefaultID).to.have.been.calledOnce, 10);
    });

    it('should run _onError if something breaks in the chain', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);
      sinon.stub(ad, '_getDefaultID').returns(Promise.reject());

      ad.on('error', () => done());
      ad.start();
    });
  });


  describe('#stop()', function() {
    it('should remove interface listeners and deregister', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);

      ad.on('stopped', () => {
        expect(intf.removeListenersCreatedBy).to.have.been.calledWith(ad);
        expect(intf.stopUsing).to.have.been.called;
        done();
      });

      ad.stop();
    });

    it('should allow both responders to goodbye on clean stops', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);

      ad._hostnameResponder = responder;
      ad._serviceResponder  = responder;

      ad.on('stopped', () => {
        expect(responder.goodbye).to.have.been.calledTwice;
        done();
      });

      ad.stop();
    });

    it('should allow one responder to goodbye (if ad only has 1)', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);

      ad._hostnameResponder = responder;
      ad._serviceResponder  = null;

      ad.on('stopped', () => {
        expect(responder.goodbye).to.have.been.called;
        done();
      });

      ad.stop();
    });

    it('should stop immediately with stop(true)', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);

      ad._hostnameResponder = responder;
      ad._serviceResponder  = responder;

      ad.on('stopped', () => {
        expect(responder.stop).to.have.been.calledTwice;
        done();
      });

      ad.stop(true);
    });
  });


  describe('#updateTXT()', function() {
    it('should validate TXTs before updating', function() {
      const ad = new Advertisement('_http._tcp', 1234);
      ad._serviceResponder = responder;

      expect(() => ad.updateTXT('Not a valid TXT object')).to.throw(Error);
      expect(() => ad.updateTXT({a: 'valid TXT object'})).to.not.throw(Error);
    });

    it('should update record\'s txt and txtRaw ', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);
      const TXT = new ResourceRecord.TXT({name: 'TXT', txt: {}});

      ad._serviceResponder = new Fake.Responder();
      ad._serviceResponder.updateEach.yields(TXT);

      ad.updateTXT({a: 'valid TXT object'});

      setImmediate(() => {
        expect(TXT.txtRaw).to.not.be.empty;
        expect(TXT.txt).to.not.be.empty;
        done();
      });
    });
  });


  describe('#_restart()', function() {
    it('should stop/recreate responders when waking from sleep', function(done) {
      // one call of _advertiseService for start, another for the restart
      let count = 0;
      const complete = () => { (++count === 2) && done(); };

      const ad = new Advertisement('_http._tcp', 1234);
      ad._serviceResponder = responder;
      ad._hostnameResponder = responder;

      sinon.stub(ad, '_getDefaultID').returns(Promise.resolve());
      sinon.stub(ad, '_advertiseHostname').returns(Promise.resolve());
      sinon.stub(ad, '_advertiseService', () => complete());

      ad.start();
      sleep.emit('wake');

      expect(responder.stop).to.have.been.calledTwice;
    });
  });


  describe('#_getDefaultID()', function() {
    it('should set the defautl interface addresses based on answer', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);

      const packet = new Packet();
      packet.origin.address = '169.254.100.175';

      sinon.stub(packet, 'isLocal').returns(true);
      sinon.stub(packet, 'equals').returns(true);

      ad._getDefaultID().then(() => {
        expect(ad._defaultAddresses).to.equal(interfaceAddresses['Ethernet']);
        done();
      });

      intf.emit('query', packet);
    });

    it('should err out after 500ms with no answer', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);

      const packet_1 = new Packet();
      sinon.stub(packet_1, 'isLocal').returns(false);
      sinon.stub(packet_1, 'equals').returns(false);

      const packet_2 = new Packet();
      packet_2.origin.address = 'somehing.wrong';

      sinon.stub(packet_2, 'isLocal').returns(true);
      sinon.stub(packet_2, 'equals').returns(true);

      ad._getDefaultID().catch(() => done());

      intf.emit('query', packet_1);
      intf.emit('query', packet_2);
    });
  });


  describe('#_advertiseHostname()', function() {
    it('should start a Responder w/ the right records & interfaces', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);
      ad._defaultAddresses = [];

      const A = new ResourceRecord.A({name: 'A'});
      const AAAA = new ResourceRecord.AAAA({name: 'AAAA', address: 'FE80::'});

      const makeRecords = sinon.stub(ad, '_makeAddressRecords');
      makeRecords.returns([AAAA]);
      makeRecords.withArgs(ad._defaultAddresses).returns([A]);

      ad._advertiseHostname().then(() => done());

      const expected = [AAAA, AAAA, AAAA]; // one per interfacae

      expect(ResponderConstructor).to.have.been
        .calledWith(ad._interface, [A], expected);

      responder.emit('probingComplete'); // <-- gets created with ^
    });

    it('should handle rename events with _onHostRename', function() {
      const ad = new Advertisement('_http._tcp', 1234);
      sinon.stub(ad, '_makeAddressRecords');
      sinon.stub(ad, '_onHostRename');

      ad._advertiseHostname();
      responder.emit('rename');

      expect(ad._onHostRename).to.have.been.called;
    });
  });


  describe('#_onHostRename()', function() {
    it('should update ad.hostname and emit the new target', function() {
      const ad = new Advertisement('_http._tcp', 1234);

      ad.hostname = 'Host';
      ad._onHostRename('Host (2)');

      ad.on('hostRenamed', (name) => {
        expect(name).to.equal('Host (2).local.');
        expect(ad.hostname).to.equal('Host (2)');
      });
    });

    it('should update the service responders SRV targets', function() {
      const ad = new Advertisement('_http._tcp', 1234);
      const SRV = new ResourceRecord.SRV({name: 'SRV', target: 'Host'});

      ad._serviceResponder = new Fake.Responder();
      ad._serviceResponder.updateEach.yields(SRV);

      ad.hostname = 'Host';
      ad._onHostRename('Host (2)');

      expect(SRV.target).to.be.equal('Host (2).local.');
    });
  });


  describe('#_advertiseService()', function() {
    it('should start a Responder w/ the right records & interfaces', function() {
      const ad = new Advertisement('_http._tcp', 1234);

      const SRV = new ResourceRecord.SRV({name: 'SRV'});
      sinon.stub(ad, '_makeServiceRecords').returns([SRV]);

      ad._advertiseService();

      expect(ResponderConstructor).to.have.been.calledWith(ad._interface, [SRV]);
    });

    it('should listen to responder probingComplete event', function(done) {
      const ad = new Advertisement('_http._tcp', 1234);
      sinon.stub(ad, '_makeServiceRecords').returns([]);

      ad.on('active', done);

      ad._advertiseService();

      expect(ResponderConstructor).to.have.been.calledWith(ad._interface, []);
      responder.emit('probingComplete'); // <-- gets created with ^
    });

    it('should listen to responder rename event', function() {
      const ad = new Advertisement('_http._tcp', 1234);
      sinon.stub(ad, '_makeServiceRecords').returns([]);

      ad.on('instanceRenamed', function(instance) {
        expect(instance).to.equal('Instance (2)');
        expect(ad.instanceName).to.equal('Instance (2)');
      });

      ad.instnaceName = 'Instance';
      ad._advertiseService();

      responder.emit('rename', 'Instance (2)');
    });
  });


  describe('#_makeAddressRecords()', function() {
    const ad = new Advertisement('_http._tcp', 1234);

    const IPv4s = [{family: 'IPv4', address: '123.123.123.123'}];
    const IPv6s = [{family: 'IPv6', address: '::1'},
                   {family: 'IPv6', address: 'FE80::TEST'}];

    it('should return A/NSEC with IPv4 only interfaces', function() {
      const records = ad._makeAddressRecords(IPv4s);

      expect(records).to.have.lengthOf(2);
      expect(records[0]).to.be.instanceOf(ResourceRecord.A);
      expect(records[1]).to.be.instanceOf(ResourceRecord.NSEC);
      expect(records[1].existing).to.eql([1]);
    });

    it('should return AAAA/NSEC with IPv6 only interfaces', function() {
      const records = ad._makeAddressRecords(IPv6s);

      expect(records).to.have.lengthOf(2);
      expect(records[0]).to.be.instanceOf(ResourceRecord.AAAA); // <-- only one
      expect(records[1]).to.be.instanceOf(ResourceRecord.NSEC);
      expect(records[1].existing).to.eql([28]);
    });

    it('should return A/AAAA/NSEC with IPv4/IPv6 interfaces', function() {
      const both  = [...IPv4s, ...IPv6s];
      const records = ad._makeAddressRecords(both);

      expect(records).to.have.lengthOf(3);
      expect(records[0]).to.be.instanceOf(ResourceRecord.A);
      expect(records[1]).to.be.instanceOf(ResourceRecord.AAAA); // <-- only one
      expect(records[2]).to.be.instanceOf(ResourceRecord.NSEC);
      expect(records[2].existing).to.eql([1, 28]);
    });
  });


  describe('#_makeServiceRecords()', function() {
    it('should make SRV/TXT/PTR records', function() {
      const ad = new Advertisement('_http._tcp', 1234);
      ad.instanceName = 'Instance';
      ad.subtypes = ['_printer'];

      ad._hostnameResponder = new Fake.Responder();
      ad._hostnameResponder.getRecords.returns([]);

      const records = ad._makeServiceRecords(intf);

      expect(records).to.have.lengthOf(6);

      expect(records[0]).to.be.instanceOf(ResourceRecord.SRV);
      expect(records[0].name).to.equal('Instance._http._tcp.local.');

      expect(records[1]).to.be.instanceOf(ResourceRecord.TXT);
      expect(records[1].name).to.equal('Instance._http._tcp.local.');

      expect(records[2]).to.be.instanceOf(ResourceRecord.NSEC);
      expect(records[2].name).to.equal('Instance._http._tcp.local.');

      expect(records[3]).to.be.instanceOf(ResourceRecord.PTR);
      expect(records[3].name).to.equal('_http._tcp.local.');

      expect(records[4]).to.be.instanceOf(ResourceRecord.PTR);
      expect(records[4].name).to.equal('_services._dns-sd._udp.local.');

      expect(records[5]).to.be.instanceOf(ResourceRecord.PTR);
      expect(records[5].name).to.equal('_printer._sub._http._tcp.local.');
    });
  });

});
