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
const RType          = require(dir + '/constants').RType;

const Fake = require('../Fake');


const Responder = rewire(dir + '/Responder');


describe('Responder constructor', function() {
  const intf = new Fake.NetworkInterface();

  const PTR = new ResourceRecord.PTR({name: '_service._tcp.local.'});
  const SRV = new ResourceRecord.SRV({name: 'Instance 1._service._tcp.local.'});
  const TXT = new ResourceRecord.TXT({name: 'Bad!'});

  describe('#constructor()', function() {
    it('should parse instance name from records', function() {
      const records = [PTR, SRV];
      const responder = new Responder(intf, records);

      expect(responder._fullname).to.equal('Instance 1._service._tcp.local.');
      expect(responder._instance).to.equal('Instance 1');
    });

    it('should throw if records have 0 unique instance names', function() {
      const records = [PTR];

      expect(() => new Responder(intf, records)).to.throw(Error);
    });

    it('should throw if records have > 1 unique instance name', function() {
      const records = [PTR, SRV, TXT];

      expect(() => new Responder(intf, records)).to.throw(Error);
    });

    it('should throw if parsing name from records fails', function() {
      const records = [TXT];

      expect(() => new Responder(intf, records)).to.throw(Error);
    });

    it('should return a new Responder FSM', function() {
      const records = [SRV];

      expect((new Responder(intf, records)).transition).to.be.a.function;
    });
  });
});


describe('Responder', function() {
  const intf = new Fake.NetworkInterface();

  intf.cache = new Fake.ExpRecCollection();
  intf.cache.hasConflictWith.returns(false);

  const response = new Fake.MulticastResponse();
  const unicast  = new Fake.UnicastResponse();
  const goodbye  = new Fake.Goodbye();
  const probe    = new Fake.Probe();

  const MulticastConstructor = sinon.stub();
  MulticastConstructor.withArgs(intf).returns(response);

  const UnicastConstructor = sinon.stub();
  UnicastConstructor.withArgs(intf).returns(unicast);

  const GoodbyeConstructor = sinon.stub();
  GoodbyeConstructor.withArgs(intf).returns(goodbye);

  const ProbeConstructor = sinon.stub();
  ProbeConstructor.withArgs(intf).returns(probe);

  const ResponseStub = {
    Multicast: MulticastConstructor,
    Unicast: UnicastConstructor,
    Goodbye: GoodbyeConstructor,
  };

  Responder.__set__('Response', ResponseStub);
  Responder.__set__('Probe', ProbeConstructor);

  const service = '_http._tcp.local.';
  const fullname = 'Instance._http._tcp.local.';

  // records on interface 1
  const PTR_1  = new ResourceRecord.PTR({name:  service, PTRDName: fullname});
  const SRV_1  = new ResourceRecord.SRV({name:  fullname, target: '1'});
  const TXT_1  = new ResourceRecord.TXT({name:  fullname});
  const NSEC_1 = new ResourceRecord.NSEC({name: fullname});

  // records on interface 2
  const PTR_2  = new ResourceRecord.PTR({name:  service, PTRDName: fullname});
  const SRV_2  = new ResourceRecord.SRV({name:  fullname, target: '2'});
  const TXT_2  = new ResourceRecord.TXT({name:  fullname});
  const NSEC_2 = new ResourceRecord.NSEC({name: fullname});

  // test responder uses records for both intf
  const records = [PTR_1, SRV_1, TXT_1, NSEC_1];
  const bridgeable = [PTR_1, SRV_1, TXT_1, NSEC_1, PTR_2, SRV_2, TXT_2, NSEC_2];

  beforeEach(function() {
    // resets stub fns and removes all listeners
    intf.reset();
    intf.cache.clear();

    response.reset();
    unicast.reset();
    goodbye.reset();
    probe.reset();

    MulticastConstructor.reset();
    UnicastConstructor.reset();
    GoodbyeConstructor.reset();
    ProbeConstructor.reset();
  });


  describe('#start()', function() {
    it('should transition to probing state', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder.start();

      expect(responder.state).to.equal('probing');
    });
  });


  describe('#stop()', function() {
    it('should transition to stopped state', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder.stop();

      expect(responder.state).to.equal('stopped');
    });
  });


  describe('#goodbye()', function() {
    it('should do nothing if already stopped', function() {
      const responder = new Responder(intf, records, bridgeable);
      const fn = sinon.stub();

      responder.stop();
      responder.goodbye(fn);

      expect(responder.state).to.equal('stopped');
      expect(fn).to.have.been.called;
    });
  });


  describe('#updateEach()', function() {
    it('should filter records and invoke update each', function() {
      const srv = new ResourceRecord.SRV({name: fullname, target: 'old.target'});
      const responder = new Responder(intf, [srv]);

      sinon.stub(responder, 'handle');

      responder.updateEach(RType.SRV, (record) => {
        record.target = 'new.target';
      });

      expect(srv.target).to.equal('new.target');
      expect(responder.handle).to.have.been.calledWithMatch('update');
    });
  });


  describe('#getRecords()', function() {
    it('should return filtered records', function() {
      const responder = new Responder(intf, records, bridgeable);

      expect(responder.getRecords()).to.eql(records);
    });
  });


  describe('#once()', function() {
    it('should add a listener that gets removed after one use', function(done) {
      const responder = new Responder(intf, records, bridgeable);

      // should only get called once
      responder.once('event', done);

      responder.emit('event');
      responder.emit('event');
    });
  });


  describe('#_addListeners()', function() {
    it('should handle interface events', function() {
      const responder = new Responder(intf, records, bridgeable);
      sinon.stub(responder, 'handle');
      sinon.stub(responder, 'transition');

      responder.start(); // <-- adds listeners

      intf.emit('probe', 'fake probe obj');
      intf.emit('error', 'fake error obj');

      expect(responder.handle).to.have.been
        .calledWith('probe', 'fake probe obj')
        .calledOn(responder);

      expect(responder.transition).to.have.been
        .calledWith('stopped', 'fake error obj')
        .calledOn(responder);
    });
  });


  describe('#_removeListners()', function() {
    it('should remove all responder listeners from each interface', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder._removeListeners();

      expect(intf.removeListenersCreatedBy).to.have.been.calledWith(responder);
    });
  });


  describe('#_stopActives()', function() {
    it('should send stop event on offswith', function(done) {
      const responder = new Responder(intf, records, bridgeable);
      responder._offswitch.once('stop', done);

      responder._stopActives();
    });
  });


  describe('#_sendProbe()', function() {
    it('should filter unique records for each interface to send', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder._sendProbe(_.noop, _.noop);

      expect(probe.add).to.have.been.calledWithMatch([SRV_1, TXT_1, NSEC_1]);
    });

    it('should onSuccess(true) if all records were found in cache', function(done) {
      const responder = new Responder(intf, records, bridgeable);

      function onSuccess(wasCompletedEarly) {
        expect(wasCompletedEarly).to.be.true;
        done();
      }

      // alter stub behavior
      intf.cache.has.returns(true);

      responder._sendProbe(onSuccess, _.noop);
      expect(probe.add).to.not.have.been.called;

      // reset stub behavior
      intf.cache.has.resetBehavior();
    });

    it('should reject records in the intferfaces cache (conflict)', function() {
      const responder = new Responder(intf, records, bridgeable);

      // alter stub behavior
      intf.cache.hasConflictWith.withArgs(SRV_1).returns(true);

      responder._sendProbe(_.noop, _.noop);
      expect(probe.add).to.not.have.been.called;

      // reset stub behavior
      intf.cache.hasConflictWith.withArgs(SRV_1).returns(false);
    });

    it('should call onSuccess with true if probing completed early', function(done) {
      const responder = new Responder(intf, records, bridgeable);

      function onSuccess(wasCompletedEarly) {
        expect(wasCompletedEarly).to.be.true;
        done();
      }

      responder._sendProbe(onSuccess, _.noop);
      probe.emit('complete', true);
    });

    it('should do onFail if any probe has a conflict', function(done) {
      const responder = new Responder(intf, records, bridgeable);

      responder._sendProbe(_.noop, done);
      probe.emit('conflict');
    });
  });


  describe('#_sendAnnouncement()', function() {
    it('should repeats should default to 1 or use given number', function() {
      const responder = new Responder(intf, records, bridgeable);

      responder._sendAnnouncement();
      expect(response.repeat).to.have.been.calledWith(1);

      responder._sendAnnouncement(3);
      expect(response.repeat).to.have.been.calledWith(3);
    });
  });


  describe('#_sendGoodbye()', function() {
    it('should filter records by interface to send on', function() {
      const responder = new Responder(intf, records, bridgeable);

      responder._sendGoodbye(_.noop);

      expect(goodbye.add).to.have.been
        .calledWithMatch([PTR_1, SRV_1, TXT_1, NSEC_1]);
    });

    it('should remove records that shouldn\'t be goodbyed', sinon.test(function() {
      const responder = new Responder(intf, records, bridgeable);

      this.stub(SRV_1, 'canGoodbye').returns(false);

      responder._sendGoodbye(_.noop);

      expect(goodbye.add).to.have.been
        .calledWithMatch([PTR_1, TXT_1, NSEC_1]);
    }));

    it('should do callback when all goodbyes have been sent', function(done) {
      const responder = new Responder(intf, records, bridgeable);

      responder._sendGoodbye(done);

      goodbye.emit('stopped');
    });
  });


  describe('#_rename()', function() {
    const responder = new Responder(intf, records, bridgeable);

    it('should rename "Name" -> "Name (2)"', function() {
      const name = responder._rename('Name');
      expect(name).to.equal('Name (2)');
    });

    it('should rename "Name (2)" -> "Name (3)"', function() {
      const name = responder._rename('Name (2)');
      expect(name).to.equal('Name (3)');
    });
  });


  describe('#_onProbe()', function() {
    beforeEach(function() {
      intf.hasRecentlySent.resetBehavior();
    });

    it('should do nothing with empty probe packets', function() {
      const responder = new Responder(intf, records, bridgeable);

      responder._onProbe(new Packet());

      expect(MulticastConstructor).to.not.have.been.called;
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should do nothing if no probes can be answered', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: 'Some Other Record.local.'})
      ]);

      responder._onProbe(packet);

      expect(MulticastConstructor).to.not.have.been.called;
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should send multicast if QM and answer sent recently', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      intf.hasRecentlySent.returns(true);
      responder._onProbe(packet);

      expect(MulticastConstructor).to.have.been.calledWith(intf);
      expect(response.defensive).to.have.been.called;
      expect(response.add).to.have.been.calledWithMatch([SRV_1]);

      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should send unicast if QU and answer sent recently', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      intf.hasRecentlySent.returns(true);
      responder._onProbe(packet);

      expect(MulticastConstructor).to.not.have.been.called;

      expect(UnicastConstructor).to.have.been.calledWith(intf);
      expect(unicast.respondTo).to.have.been.calledWith(packet);
      expect(unicast.defensive).to.have.been.called;
      expect(unicast.add).to.have.been.calledWithMatch([SRV_1]);
    });

    it('should send multicast & unicast if needed', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV}),
        new QueryRecord({name: service,  qtype: RType.PTR, QU: true})
      ]);

      intf.hasRecentlySent.returns(true);
      responder._onProbe(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(unicast.add).to.have.been.calledWithMatch([PTR_1]);
    });

    it('should always send multicast if answer was not sent recently', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      intf.hasRecentlySent.returns(false);
      responder._onProbe(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should send negative responses when needed', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.AAAA})
      ]);

      responder._onProbe(packet);

      expect(response.add).to.have.been.calledWithMatch([NSEC_1]);
      expect(UnicastConstructor).to.not.have.been.called;
    });
  });


  describe('#_onQuery()', function() {
    beforeEach(function() {
      intf.hasRecentlySent.resetBehavior();
    });

    it('should do nothing with empty query packets', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder._onQuery(new Packet());

      expect(MulticastConstructor).to.not.have.been.called;
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should do nothing if no questions can be answered', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: 'Some Other Record.local.'})
      ]);

      responder._onQuery(packet);

      expect(MulticastConstructor).to.not.have.been.called;
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should send multicast if QM and answer sent recently', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      intf.hasRecentlySent.returns(true);
      responder._onQuery(packet);

      expect(MulticastConstructor).to.have.been.calledWith(intf);
      expect(response.add).to.have.been.calledWithMatch([SRV_1]);

      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should send unicast if QU and answer sent recently', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      intf.hasRecentlySent.returns(true);
      responder._onQuery(packet);

      expect(MulticastConstructor).to.not.have.been.called;

      expect(UnicastConstructor).to.have.been.calledWith(intf);
      expect(unicast.respondTo).to.have.been.calledWith(packet);
      expect(unicast.add).to.have.been.calledWithMatch([SRV_1]);
    });

    it('should send moth unicast & multicast if needed', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV}),
        new QueryRecord({name: service,  qtype: RType.PTR, QU: true}),
      ]);

      intf.hasRecentlySent.returns(true);
      responder._onQuery(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(unicast.add).to.have.been.calledWithMatch([PTR_1]);
    });

    it('should always send multicast if answer was not sent recently', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV, QU: true})
      ]);

      intf.hasRecentlySent.returns(false);
      responder._onQuery(packet);

      expect(response.add).to.have.been.calledWithMatch([SRV_1]);
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should always send unicast if packet is from a legacy source', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();
      packet.origin.port = 8765; // non mDNS port

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      responder._onQuery(packet);

      expect(packet.isLegacy()).to.be.true;
      expect(MulticastConstructor).to.not.have.been.called;
      expect(unicast.add).to.have.been.calledWithMatch([SRV_1]);
    });

    it('should suppress answers in known list if ttl > 0.5 original', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      packet.setAnswers([SRV_1]); // @ max default TTL

      responder._onQuery(packet);

      expect(MulticastConstructor).to.not.have.been.called;
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should not suppress answers in known list if ttl < 0.5 original', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.SRV})
      ]);

      const clone = SRV_1.clone();
      clone.ttl = 1; // lowest possible TTL

      packet.setAnswers([clone]);

      responder._onQuery(packet);

      expect(MulticastConstructor).to.have.been.called;
      expect(UnicastConstructor).to.not.have.been.called;
    });

    it('should send negative responses when needed', function() {
      const responder = new Responder(intf, records, bridgeable);
      const packet = new Packet();

      packet.setQuestions([
        new QueryRecord({name: fullname, qtype: RType.AAAA})
      ]);

      responder._onQuery(packet);

      expect(response.add).to.have.been.calledWithMatch([NSEC_1]);
      expect(UnicastConstructor).to.not.have.been.called;
    });
  });


  describe('#_onAnswer()', function() {
    const conflictingSRV = new ResourceRecord.SRV({
      name: fullname,
      target: 'conflicting', // <- conflict
    });

    const differentPTR = new ResourceRecord.PTR({
      name: service,
      PTRDName: 'different',
      isUnique: false, // <- can't be a conflict, just a different answer
    });

    const responder = new Responder(intf, records, bridgeable);
    sinon.stub(responder, 'transition');
    sinon.stub(responder, '_sendAnnouncement');

    beforeEach(function() {
      responder.transition.reset();
      responder._sendAnnouncement.reset();
    });

    it('should do nothing with empty answer packets', function() {
      responder._onAnswer(new Packet());

      expect(responder._sendAnnouncement).to.not.have.been.called;
      expect(responder.transition).to.not.have.been.called;
    });

    it('should do nothing with non-conflicting answers', function() {
      const packet = new Packet();
      packet.setAnswers([SRV_1, differentPTR]);

      responder._onAnswer(packet);

      expect(responder._sendAnnouncement).to.not.have.been.called;
      expect(responder.transition).to.not.have.been.called;
    });

    it('should transition to probing on conflciting answers', function() {
      const packet = new Packet();
      packet.setAnswers([conflictingSRV]);

      responder._onAnswer(packet);

      expect(responder.transition).to.have.been.calledWith('probing');
    });

    it('should re-announce "conflicting" bridged records', function() {
      const packet = new Packet();
      packet.setAnswers([SRV_2]); // SRV for interface 2

      responder._onAnswer(packet); // on interface 1

      expect(responder.transition).to.not.have.been.called;
      expect(responder._sendAnnouncement).to.have.been.called;
    });

    it("should re-announce records TTL=0'd by another responder", function() {
      const goodbyeRecord = SRV_1.clone();
      goodbyeRecord.ttl = 0;

      const packet = new Packet();
      packet.setAnswers([goodbyeRecord]);

      responder._onAnswer(packet);

      expect(responder.transition).to.not.have.been.called;
      expect(responder._sendAnnouncement).to.have.been.called;
    });
  });


  describe('Sanity tests:', function() {
    it('should probe -> announce -> respond', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder.start();

      // now sending probes
      expect(ProbeConstructor).to.have.been.called;

      // fake probes report complete:
      probe.emit('complete');

      // should be announcing:
      expect(MulticastConstructor).to.have.been.called;
      expect(responder.state).to.equal('responding');
    });


    it('should hold probes for 5s if too many conflicts', sinon.test(function() {
      const responder = new Responder(intf, records, bridgeable);

      // add a bunch of conflicts
      _.times(25, () => responder._conflicts.increment());
      responder.start();

      // not called yet, waiting for timeout due to conflicts
      expect(ProbeConstructor).to.not.have.been.called;

      this.clock.tick(6 * 1000);

      // probe queue fired
      expect(ProbeConstructor).to.have.been.called;

      probe.emit('complete');
      expect(responder.state).to.equal('responding');
    }));


    it('should reset conflict count after 15s', sinon.test(function() {
      // need to re-require within sinon sandbox for Date.now() to get replaced
      const ReloadedResponder = require(dir + '/Responder');
      const responder = new ReloadedResponder(intf, records, bridgeable);

      // add a bunch of conflicts
      _.times(25, () => responder._conflicts.increment());
      responder.start();

      this.clock.tick(16 * 1000);
      expect(responder._conflicts.count()).to.equal(0);
    }));


    it('should automatically rename itself as conflicts are found', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder.start();

      expect(responder._instance).to.equal('Instance');
      probe.emit('conflict'); // <- conflict!

      expect(responder._instance).to.equal('Instance (2)');
      probe.emit('conflict'); // <- again!

      expect(responder._instance).to.equal('Instance (3)');
      expect(responder._conflicts.count()).to.equal(2);

      probe.emit('complete'); // <- now successful
      expect(responder.state).to.equal('responding');

      expect(SRV_1.name).to.equal('Instance (3)' + '.' + service);
      expect(PTR_1.PTRDName).to.equal('Instance (3)' + '.' + service);
    });


    it('should skip announcing if all probes end early', function() {
      const responder = new Responder(intf, records, bridgeable);

      responder.start();
      probe.emit('complete', true); // <- ended early

      expect(MulticastConstructor).to.not.have.been.called;
    });


    it('should stop probing and re-probe if records are updated', function() {
      const responder = new Responder(intf, records, bridgeable);
      responder.start();

      expect(ProbeConstructor).to.have.been.called;
      expect(probe.start).to.have.been.calledOnce;

      responder.updateEach(RType.SRV, (record) => {
        record.target = 'Updated.local.';
      });

      expect(probe.start).to.have.been.calledTwice;
    });


    it("shouldn't send goodbyes if probing not complete", function(done) {
      const responder = new Responder(intf, records, bridgeable);
      responder.start();

      responder.goodbye(() => {
        expect(goodbye.start).to.not.have.been.called;
        done();
      });
    });


    it('should send goodbyes if probing complete', function(done) {
      const responder = new Responder(intf, records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      responder.goodbye(() => {
        expect(responder.state).to.equal('stopped');
        done();
      });

      goodbye.emit('stopped');
    });


    it('should announce record updates when in responding state', function() {
      const responder = new Responder(intf, records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      responder.updateEach(RType.SRV, () => {});

      expect(response.add).to.have.been
        .calledWithMatch([PTR_1, SRV_1, TXT_1, NSEC_1]);
    });


    it('should answer probes', function() {
      const responder = new Responder(intf, records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      // a conflicting probe
      const probePacket = new Packet();
      probePacket.setQuestions([ new QueryRecord({name: SRV_1.name}) ]);
      probePacket.setAnswers([ new ResourceRecord.SRV({name: SRV_1.name}) ]);

      // now responding & answering queries
      intf.emit('probe', probePacket);

      expect(response.add).to.have.been
        .calledWithMatch([SRV_1, TXT_1, NSEC_1]);
    });


    it('should answer queries', function() {
      const responder = new Responder(intf, records, bridgeable);

      // put into responding state (w/o announcing)
      responder.start();
      probe.emit('complete', true);

      const queryPacket = new Packet();
      queryPacket.setQuestions([ new QueryRecord({name: SRV_1.name}) ]);

      // now responding & answering queries
      intf.emit('query', queryPacket);

      expect(response.add).to.have.been.calledWithMatch([SRV_1, TXT_1, NSEC_1]);
    });


    it('should rename/re-probe when a conflicting answer comes in', function() {
      const responder = new Responder(intf, records, bridgeable);

      // put into responding state
      responder.start();
      probe.emit('complete');

      // create a conflicting record/packet
      const conflict = new Packet();
      conflict.setAnswers([
        new ResourceRecord.SRV({name: SRV_1.name, port: 3456})
      ]);

      // now responding & hearing other responder answers
      intf.emit('answer', conflict);

      // conflict causes it to re-probe
      expect(responder.state).to.equal('probing');
    });


    it('stopped state should be terminal', function() {
      const responder = new Responder(intf, records, bridgeable);

      responder.stop();
      responder.start();

      expect(responder.state).to.equal('stopped');
    });
  });

});
