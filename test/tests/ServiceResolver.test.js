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
const RType          = require(dir + '/constants').RType;

const Fake = require('../Fake');


const ServiceResolver = rewire(dir + '/ServiceResolver');


describe('ServiceResolver', function() {
  const fullname = 'Instance (2)._service._tcp.local.';
  const target = 'Target.local.';
  const type = '_service._tcp.local.';

  const PTR  = new ResourceRecord.PTR({name: type, PTRDName: fullname});
  const SRV  = new ResourceRecord.SRV({name: fullname, target: target, port: 8000});
  const TXT  = new ResourceRecord.TXT({name: fullname});
  const AAAA = new ResourceRecord.AAAA({name: target, address: '::1'});
  const A    = new ResourceRecord.A({name: target, address: '1.1.1.1'});

  const intf = new Fake.NetworkInterface();
  intf.cache = new Fake.ExpRecCollection();

  const query = new Fake.Query();
  const QueryConstructor = sinon.stub().returns(query);

  ServiceResolver.__set__('Query', QueryConstructor);

  beforeEach(function() {
    intf.reset();
    intf.cache.reset();
    query.reset();
    QueryConstructor.reset();
  });


  describe('#constructor()', function() {
    it('should parse fullname / make new FSM', sinon.test(function() {
      const resolver = new ServiceResolver(fullname, []);

      expect(resolver.instance).to.equal('Instance (2)');
      expect(resolver.serviceType).to.equal('_service');
      expect(resolver.protocol).to.equal('_tcp');
      expect(resolver.domain).to.equal('local');
      expect(resolver.transition).to.be.a.function;
    }));
  });


  describe('#service()', function() {
    it('should return the same obj each time (updated props)', function() {
      const resolver = new ServiceResolver(fullname, intf);

      expect(resolver.service()).to.equal(resolver.service());
    });

    it('should return the right stuff', function() {
      const resolver = new ServiceResolver(fullname, intf);

      expect(resolver.service()).to.eql({
        fullname : fullname,
        name     : 'Instance (2)',
        type     : {name: 'service', protocol: 'tcp'},
        domain   : 'local',
        host     : null,
        port     : null,
        addresses: [],
        txt      : {},
        txtRaw   : {},
      });
    });

    it('should remove service type underscore only if needed', function() {
      const name = 'Instance (2).service._tcp.local.';
      const resolver = new ServiceResolver(name, intf);

      expect(resolver.service().type).to.eql({name: 'service', protocol: 'tcp'});
    });

    it('should freeze address/txt/txtRaw so they can\'t be modified', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.txt = {};
      resolver.txtRaw = {};

      const service = resolver.service();
      service.addresses.push('something');
      service.txt.key = 'added!';
      service.txtRaw.key = 'added!';

      expect(service.addresses).to.not.eql(resolver.addresses);
      expect(service.txt).to.not.eql(resolver.txt);
      expect(service.txtRaw).to.not.eql(resolver.txtRaw);
    });
  });


  describe('#once()', function() {
    it('should add a listener that gets removed after one use', function(done) {
      const resolver = new ServiceResolver(fullname, intf);

      // should only get called once (or mocha errs)
      resolver.once('event', (one, two) => {
        expect(one).to.equal(1);
        expect(two).to.equal(2);
        done();
      });

      resolver.emit('event', 1, 2);
      resolver.emit('event');
    });
  });


  describe('#_addListeners()', function() {
    it('should listen to intf and intf cache', function(done) {
      const resolver = new ServiceResolver(fullname, intf);
      const allCalled = _.after(4, done);

      sinon.stub(resolver, 'transition', allCalled);
      sinon.stub(resolver, '_onAnswer' , allCalled);
      sinon.stub(resolver, '_onReissue', allCalled);
      sinon.stub(resolver, '_onExpired', allCalled);

      resolver._removeListeners();
      resolver._addListeners();

      intf.emit('answer');
      intf.emit('error');
      intf.cache.emit('reissue');
      intf.cache.emit('expired');
    });
  });


  describe('#_onReissue()', function() {
    const resolver = new ServiceResolver(fullname, intf);
    sinon.stub(resolver, 'handle');

    it('should ignore irrelevant records', function() {
      const ignore = new ResourceRecord.A({name: 'ignore!'});
      resolver._onReissue(ignore);

      expect(resolver.handle).to.not.have.been.called;
    });

    it('should pass relevant records to handle fn (name)', function() {
      resolver._onReissue(SRV);

      expect(resolver.handle).to.have.been.calledWith('reissue', SRV);
    });

    it('should pass relevant records to handle fn (target)', function() {
      resolver.target = 'Target.local.';
      resolver._onReissue(A);

      expect(resolver.handle).to.have.been.calledWith('reissue', A);
    });

    it('should pass relevant records to handle fn (PTR)', function() {
      resolver._onReissue(PTR);

      expect(resolver.handle).to.have.been.calledWith('reissue', PTR);
    });
  });


  describe('#_onExpired()', function() {
    it('should ignore irrelevant records', function() {
      const resolver = new ServiceResolver(fullname, intf);
      sinon.stub(resolver, 'transition');

      const ignore = new ResourceRecord.A({name: 'ignore!'});
      resolver._onExpired(ignore);

      expect(resolver.transition).to.not.have.been.called;
    });

    it('should stop if PTR or SRV expires', function() {
      const resolver = new ServiceResolver(fullname, intf);
      sinon.stub(resolver, 'transition');

      resolver._onExpired(SRV);
      resolver._onExpired(PTR);

      expect(resolver.transition).to.have.been
        .calledTwice
        .calledWith('stopped');
    });

    it('should remove dying addresses and unresolve if needed', function() {
      const resolver = new ServiceResolver(fullname, intf);
      sinon.stub(resolver, 'transition');

      resolver.target = 'Target.local.';
      resolver.addresses = ['1.1.1.1', '::1'];

      resolver._onExpired(A);

      expect(resolver.transition).to.not.have.been.called;
      expect(resolver.addresses).to.eql(['::1']);

      resolver._onExpired(AAAA);

      expect(resolver.transition).to.have.been.calledWith('unresolved');
      expect(resolver.addresses).to.be.empty;
    });

    it('should clear TXT data if TXT record dies', function() {
      const resolver = new ServiceResolver(fullname, intf);
      sinon.stub(resolver, 'transition');

      resolver._onExpired(TXT);

      expect(resolver.transition).to.been.calledWith('unresolved');
    });
  });


  describe('#_processRecords()', function() {
    it('should handle SRV changes', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.port = 9999;
      resolver.target = 'Target';
      resolver.addresses = ['1.1.1.1'];

      expect(resolver._processRecords([SRV])).to.be.true;
      expect(resolver.port).to.equal(8000);
      expect(resolver._processRecords([SRV])).to.be.false; // unchanged

      const change = new ResourceRecord.SRV({
        name: fullname,
        target: 'changed.local.',
      });

      expect(resolver._processRecords([change])).to.be.true;
      expect(resolver.target).to.equal('changed.local.');
      expect(resolver.addresses).to.be.empty;
    });

    it('should handle address record changes', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.target = target;
      resolver.addresses = ['1.1.1.1'];

      const more = new ResourceRecord.A({name: target, address: '2.2.2.2'});

      resolver._processRecords([A]);
      expect(resolver.addresses).to.eql(['1.1.1.1']); // unchanged

      resolver._processRecords([AAAA, more]);
      expect(resolver.addresses).to.eql(['1.1.1.1', '2.2.2.2', '::1']);
    });

    it('should handle TXT record changes', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.txt = {};
      resolver.txtRaw = {};

      const change = new ResourceRecord.TXT({name: fullname, txt: {key: 'value'}});

      expect(resolver._processRecords([change])).to.be.true;
      expect(resolver.txt).to.eql(change.txt);
      expect(resolver.txtRaw).to.eql(change.txtRaw);

      expect(resolver._processRecords([change])).to.be.false; // unchanged
    });

    it('should ignore irrelevant records', function() {
      const resolver = new ServiceResolver(fullname, intf);
      const ignore = new ResourceRecord.PTR({name: 'ignore!'});

      expect(resolver._processRecords([ignore])).to.be.false;
    });

    it('should ignore TTL=0 goodbye records', function() {
      const resolver = new ServiceResolver(fullname, intf);

      const goodbye = SRV.clone();
      goodbye.ttl = 0;

      expect(resolver._processRecords([goodbye])).to.be.false;
      expect(resolver.target).to.be.null;
    });
  });


  describe('#_queryForMissing()', function() {
    const resolver = new ServiceResolver(fullname, intf);
    sinon.stub(resolver, 'handle');

    beforeEach(function() {
      resolver.target    = null;
      resolver.txtRaw    = null;
      resolver.addresses = [];
    });

    it('should get missing SRV/TXTs', function() {
      resolver.target = null;
      resolver._queryForMissing();

      expect(query.add).to.have.been.calledonce;
      expect(query.add.firstCall.args[0]).to.have.lengthOf(2);
    });

    it('should get missing A/AAAAs', function() {
      resolver.target = 'Target.local.';
      resolver.txtRaw = {};
      resolver._queryForMissing();

      expect(query.add).to.have.been.calledonce;
      expect(query.add.firstCall.args[0]).to.have.lengthOf(2);
    });

    it('should get missing TXT/A/AAAAs', function() {
      resolver.target = 'Target.local.';
      resolver._queryForMissing();

      expect(query.add).to.have.been.calledonce;
      expect(query.add.firstCall.args[0]).to.have.lengthOf(3);
    });

    it('should check interface caches before sending queries', function() {
      intf.cache.find.returns([TXT]);

      resolver.target = 'Target.local.';
      resolver.addresses = ['1.1.1.1'];
      resolver._queryForMissing(); // <- will try to find TXT record

      expect(resolver.handle).to.have.been.calledWith('incomingRecords', [TXT]);
      expect(query.add).to.not.have.been.called;

      intf.cache.find.resetBehavior();
    });
  });


  describe('Sanity checks:', function() {
    it('should resolve w/ all needed starting records', function(done) {
      const resolver = new ServiceResolver(fullname, intf);

      resolver.once('resolved', function() {
        expect(resolver.addresses).to.eql(['1.1.1.1', '::1']);
        expect(resolver.target).to.equal(target);
        expect(resolver.port).to.equal(8000);
        expect(resolver.txt).to.eql({});
        expect(resolver.isResolved()).to.be.true;

        done();
      });

      expect(resolver.isResolved()).to.be.false;
      resolver.start([PTR, SRV, TXT, A, AAAA]);
    });


    it('should not need/ask for AAAA in this case', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT, A]);

      expect(QueryConstructor).to.not.have.been.called;
    });


    it('should ask for address records', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([PTR, SRV, TXT]);

      expect(query.add).to.have.been.calledWithMatch([
        {name: target, qtype: RType.A},
        {name: target, qtype: RType.AAAA},
      ]);
    });


    it('should check intf caches for answers first', function() {
      intf.cache.find.returns([A]);

      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([PTR, SRV, TXT]);

      expect(query.add).to.have.been.calledWithMatch([
        {name: target, qtype: RType.AAAA},
      ]);

      intf.cache.find.resetBehavior();
    });


    it('should ask for SRV and ignore A/AAAAs (target unknown)', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([TXT, A, AAAA]);

      expect(resolver.target).to.be.nil;
      expect(resolver.addresses).to.be.empty;

      expect(query.add).to.have.been.calledWithMatch([
        {name: fullname, qtype: RType.SRV}
      ]);
    });


    it('should resolve when needed answers come', function(done) {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT]);
      resolver.on('resolved', done);

      const packet = new Packet();
      packet.setAnswers([A, AAAA]);

      intf.emit('answer', packet);
    });


    it('should change queries if needed info changes', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT]); // unresolved

      const updated = new ResourceRecord.SRV({
        name: fullname,
        target: 'Updated Target.local.',
        port: 8000,
      });

      const packet = new Packet();
      packet.setAnswers([updated]);

      intf.emit('answer', packet);

      expect(query.add).to.have.been.calledWithMatch([
        {name: 'Updated Target.local.', qtype: RType.A},
        {name: 'Updated Target.local.', qtype: RType.AAAA},
      ]);
    });


    it('should unresolve w/ incomplete changes (new SRV no A/AAAA)', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      const updated = new ResourceRecord.SRV({
        name: fullname,
        target: 'Updated Target.local.',
        port: 8000,
      });

      const packet = new Packet();
      packet.setAnswers([updated]);

      intf.emit('answer', packet);

      expect(resolver.state).to.equal('unresolved');
    });


    it('should notify when service info gets updated', function(done) {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      resolver.on('updated', function() {
        expect(resolver.port).to.equal(1111);
        done();
      });

      const updated = new ResourceRecord.SRV({
        name: fullname,
        target: target,
        port: 1111, // <- new port
      });

      const packet = new Packet();
      packet.setAnswers([updated]);

      intf.emit('answer', packet);
    });


    it('should query for updates as records get stale', sinon.test(function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      intf.cache.emit('reissue', SRV);
      intf.cache.emit('reissue', TXT);
      intf.cache.emit('reissue', A);

      // wait for batch timer
      this.clock.tick(1000);

      expect(query.add).to.have.been.calledWithMatch([
        {name: fullname, qtype: RType.SRV},
        {name: type, qtype: RType.PTR},
        {name: fullname, qtype: RType.TXT},
        {name: target, qtype: RType.A},
      ]);
    }));


    it('should query for reissue updates when unresolved too', sinon.test(function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT, A, AAAA]); // is now resolved

      intf.cache.emit('expired', TXT);
      expect(resolver.isResolved()).to.be.false;

      intf.cache.emit('reissue', SRV);
      intf.cache.emit('reissue', A);

      // wait for batch timer
      this.clock.tick(1000);

      expect(query.add).to.have.been.calledWithMatch([
        {name: fullname, qtype: RType.SRV},
        {name: type, qtype: RType.PTR},
        {name: target, qtype: RType.A},
      ]);
    }));


    it('should go down if the SRV dies (notified from cache)', function(done) {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start([SRV, TXT, A, AAAA]); // is now resolved
      resolver.on('down', done);

      intf.cache.emit('expired', SRV);
    });


    it('should go down if the SRV dies, even if unresolved', function(done) {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.start();
      resolver.on('down', done);

      intf.cache.emit('expired', SRV);
    });


    it('should ignore interface and cache events in stopped state', function() {
      const resolver = new ServiceResolver(fullname, intf);
      sinon.stub(resolver, '_onAnswer');
      sinon.stub(resolver, '_onReissue');
      resolver.stop();

      intf.emit('answer');
      intf.cache.emit('reissue');

      expect(resolver._onAnswer).to.not.have.been.called;
      expect(resolver._onReissue).to.not.have.been.called;
    });


    it('should fail and stop if it can\'t resolve within 10s', sinon.test(function() {
      const resolver = new ServiceResolver(fullname, intf);

      resolver.start();
      expect(resolver.state).to.equal('unresolved');

      this.clock.tick(10 * 1000);
      expect(resolver.state).to.equal('stopped');
    }));


    it('stopped state should be terminal', function() {
      const resolver = new ServiceResolver(fullname, intf);
      resolver.stop();
      resolver.start();

      expect(resolver.state).to.equal('stopped');
    });
  });

});
