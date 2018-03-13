const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const Packet         = require(dir + '/Packet');
const ResourceRecord = require(dir + '/ResourceRecord');

const Fake = require('../Fake');


const Response = require(dir + '/Response');


describe('Response.Multicast', function() {
  const intf      = new Fake.NetworkInterface({id: 'Ethernet'});
  const offswitch = new Fake.EventEmitter();

  beforeEach(function() {
    intf.reset();
    offswitch.reset();
  });


  describe('#constructor()', function() {
    it('should attach listeners', function() {
      const response = new Response.Multicast(intf, offswitch);

      expect(intf.using).to.have.been.calledWith(response);
      expect(offswitch.using).to.have.been.calledWith(response);
    });
  });


  describe('#add()', function() {
    it('should add to this._answers and add random delay', function() {
      const response = new Response.Multicast(intf, offswitch);

      // accept single records:
      response.add(new ResourceRecord.A({name: 'Unique'}));
      expect(response._delay).to.equal(0);

      // accept array of records:
      response.add([ new ResourceRecord.PTR({name: 'Shared'}) ]);
      expect(response._delay).to.be.within(20, 120);

      expect(response._answers.size).to.equal(2);
    });
  });


  describe('#start()', function() {
    it('should make packet and _send() after delay', sinon.test(function() {
      const response = new Response.Multicast(intf, offswitch);
      sinon.stub(response, '_send');

      response.start();
      this.clock.tick(120); // <-- the longest random delay possible

      expect(response._send).to.have.been.called;
    }));

    it('should ignore delay if defensive is set', sinon.test(function() {
      const response = new Response.Multicast(intf, offswitch);
      sinon.stub(response, '_send');

      response._delay = 100;
      response.defensive(true);

      response.start();
      this.clock.tick(0);

      expect(response._send).to.have.been.called;
    }));
  });


  describe('#stop()', function() {
    it('should stop & remove listeners', function(done) {
      const response = new Response.Multicast(intf, offswitch);

      response.on('stopped', () => {
        expect(intf.removeListenersCreatedBy).to.have.been.calledWith(response);
        expect(offswitch.removeListenersCreatedBy).to.have.been.calledWith(response);
        done();
      });

      response.stop();
    });

    it('should not do anything if already stopped', function(done) {
      const response = new Response.Multicast(intf, offswitch);

      response.on('stopped', done); // <-- more than once throws error

      response.stop();
      response.stop(); // <-- does nothing
    });
  });


  describe('#_send()', function() {
    it('should not reschedule if out of repeats', function() {
      const response = new Response.Multicast(intf, offswitch);
      sinon.stub(response, '_suppressRecents');

      response._send();

      expect(response._queuedTimer).to.not.exist;
      expect(response._next).to.equal(1000);
    });

    it('should reschedule next response, doubling delay', sinon.test(function() {
      const response = new Response.Multicast(intf, offswitch);
      sinon.stub(response, '_suppressRecents');
      sinon.stub(response, '_makePacket');
      sinon.stub(response, 'stop');

      intf.send.yields();

      response.repeat(3);
      response._send();

      this.clock.tick(1000);
      expect(intf.send).to.have.callCount(2);
      expect(response.stop).to.not.have.been.called;

      this.clock.tick(2000);
      expect(intf.send).to.have.callCount(3);
      expect(response.stop).to.have.been.called;

      this.clock.tick(4000);
      expect(intf.send).to.not.have.callCount(4);
    }));
  });


  describe('#_makePacket()', function() {
    it('should add additionals without repeating answers', function() {
      const response = new Response.Multicast(intf, offswitch);

      const A = new ResourceRecord.TXT({name: 'A'});
      const B = new ResourceRecord.TXT({name: 'B'});
      const C = new ResourceRecord.TXT({name: 'C', additionals: [A]});
      const D = new ResourceRecord.TXT({name: 'D', additionals: [B]});

      response.add([A, C, D]);

      const packet = response._makePacket();

      expect(packet.isAnswer()).to.be.true;
      expect(packet.answers).to.eql([A, C, D]);
      expect(packet.additionals).to.eql([B]); // <-- should not include A
    });
  });


  describe('#_suppressRecents()', function() {
    const response = new Response.Multicast(intf, offswitch);

    const A = new ResourceRecord.TXT({name: 'A'});
    const B = new ResourceRecord.TXT({name: 'B'});

    it('should suppress recently sent answers & additionals', function() {
      const packet = new Packet();
      packet.setAnswers([A, B]);

      intf.hasRecentlySent.withArgs(A).returns(false);
      intf.hasRecentlySent.withArgs(B).returns(true);

      const output = response._suppressRecents(packet);

      expect(output.answers).to.eql([A]); // <-- B suppressed
    });

    it('should do 250ms for defensive responses & 1s for others', function() {
      const packet = new Packet();
      packet.answers = [A];

      response.defensive(true);
      response._suppressRecents(packet);

      expect(intf.hasRecentlySent).to.have.been.calledWith(A, 0.250);

      response.defensive(false);
      response._suppressRecents(packet);

      expect(intf.hasRecentlySent).to.have.been.calledWith(A, 1);
    });
  });


  describe('#_onAnswer()', function() {
    const A = new ResourceRecord.TXT({name: 'A'});
    const B = new ResourceRecord.TXT({name: 'B'});

    it('should suppress queued answers found in incoming packet', function() {
      const response = new Response.Multicast(intf, offswitch);

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([A]);

      response._onAnswer(packet);

      expect(response._queuedPacket.answers).to.eql([B]); // <-- A suppressed
    });

    it('should not suppress TTL=0 answers', function() {
      const response = new Response.Multicast(intf, offswitch);
      const dead = new ResourceRecord.TXT({name: 'A', ttl: 0});

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([dead]);

      expect(response._queuedPacket.answers).to.eql([A, B]); // <-- not suppressed
    });

    it('should exit if response is in stopped state', function() {
      const response = new Response.Multicast(intf, offswitch);
      response.stop();

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([A]);

      response._onAnswer(packet);

      expect(response._queuedPacket.answers).to.eql([A, B]); // <-- not suppressed
    });

    it('should exit if incoming packet originated on same interface', function() {
      const response = new Response.Multicast(intf, offswitch);

      response._queuedPacket = new Packet();
      response._queuedPacket.setAnswers([A, B]);

      const packet = new Packet();
      packet.setAnswers([A]);
      sinon.stub(packet, 'isLocal').returns(true);

      response._onAnswer(packet);

      expect(response._queuedPacket.answers).to.eql([A, B]); // <-- not suppressed
    });
  });

});


describe('Response.Goodbye', function() {
  const intf      = new Fake.NetworkInterface();
  const offswitch = new Fake.EventEmitter();

  beforeEach(function() {
    intf.reset();
    offswitch.reset();
  });


  describe('#constructor()', function() {
    it('should inherit from Response.Multicast', function() {
      const goodbye = new Response.Goodbye(intf, offswitch);

      expect(goodbye).to.be.instanceof(Response.Multicast);
    });
  });


  describe('#_makePacket()', function() {
    it('should add clones to packet and TTL=0 them', function() {
      const goodbye = new Response.Goodbye(intf, offswitch);

      const add = new ResourceRecord.NSEC({name: 'removed'});
      const answer = new ResourceRecord.TXT({name: 'bye', additionals: add});
      goodbye.add(answer);

      const packet = goodbye._makePacket();

      expect(packet.isAnswer()).to.be.true;
      expect(packet.answers).to.have.lengthOf(1);
      expect(packet.answers[0]).to.not.equal(answer);
      expect(packet.answers[0].ttl).to.equal(0);
      expect(packet.additionals).to.be.empty;
    });
  });


  describe('#_suppressRecents()', function() {
    it('should do nothing', function() {
      const goodbye = new Response.Goodbye(intf, offswitch);
      const packet = new Packet();

      expect(goodbye._suppressRecents(packet)).to.equal(packet);
    });
  });

});


describe('Response.Unicast', function() {
  const intf      = new Fake.NetworkInterface();
  const offswitch = new Fake.EventEmitter();

  beforeEach(function() {
    intf.reset();
    offswitch.reset();
  });


  describe('#add()', function() {
    it('should add to this._answers and add random delay', function() {
      const response = new Response.Unicast(intf, offswitch);

      // accept single records:
      response.add(new ResourceRecord.A({name: 'Unique'}));
      expect(response._delay).to.equal(0);

      // accept array of records:
      response.add([ new ResourceRecord.PTR({name: 'Shared'}) ]);
      expect(response._delay).to.be.within(20, 120);

      expect(response._answers.size).to.equal(2);
    });
  });


  describe('#start()', function() {
    it('should make packet and send after delay', sinon.test(function() {
      const response = new Response.Unicast(intf, offswitch);
      sinon.stub(response, '_makePacket');

      response._delay = 100;
      response.start();

      this.clock.tick(100);

      expect(intf.send).to.have.been.called;
    }));

    it('should ignore delay if defensive or legacy are set', sinon.test(function() {
      const response = new Response.Unicast(intf, offswitch);
      sinon.stub(response, '_makePacket');

      response.defensive(true);
      response.start();

      this.clock.tick(0);

      expect(intf.send).to.have.been.called;
    }));

    it('should stop after packet is sent', function(done) {
      const response = new Response.Unicast(intf, offswitch);
      sinon.stub(response, '_makePacket');
      intf.send.yields();

      response.on('stopped', done);

      response.defensive(true);
      response.start();
    });
  });


  describe('#stop()', function() {
    it('should stop & remove listeners', function(done) {
      const response = new Response.Unicast(intf, offswitch);

      response.on('stopped', () => {
        expect(intf.removeListenersCreatedBy).to.have.been.calledWith(response);
        expect(offswitch.removeListenersCreatedBy).to.have.been.calledWith(response);
        done();
      });

      response.stop();
    });

    it('should not do anything if already stopped', function() {
      const response = new Response.Unicast(intf, offswitch);

      response.stop();
      response.stop(); // <-- does nothing

      expect(intf.removeListenersCreatedBy).to.not.have.been.calledTwice;
    });
  });


  describe('#_makePacket()', function() {
    const A = new ResourceRecord.TXT({name: 'A'});
    const B = new ResourceRecord.TXT({name: 'B'});
    const C = new ResourceRecord.TXT({name: 'C', additionals: [A]});
    const D = new ResourceRecord.TXT({name: 'D', additionals: [B]});
    const NSEC = new ResourceRecord.NSEC({name: 'NSEC'});

    it('should add additionals without repeating answers', function() {
      const response = new Response.Unicast(intf, offswitch);
      response.add([A, C, D]);

      const packet = response._makePacket();

      expect(packet.isAnswer()).to.be.true;
      expect(packet.answers).to.eql([A, C, D]);
      expect(packet.additionals).to.eql([B]);  // <-- A not included again
    });

    it('should make legacy packets', function() {
      const response = new Response.Unicast(intf, offswitch);
      response.add([A, NSEC]);

      const unicastQuery = new Packet();
      unicastQuery.origin.port = 2222; // <-- not 5353, so 'legacy'
      unicastQuery.header.ID = '123';

      response.respondTo(unicastQuery);

      const packet = response._makePacket();

      expect(packet.header.ID).to.equal(unicastQuery.header.ID);
      expect(packet.answers).to.have.lengthOf(1);
      expect(packet.answers[0]).to.not.equal(A);           // <-- clone
      expect(packet.answers[0].rrtype).to.equal(A.rrtype); // <-- NSEC removed
      expect(packet.answers[0].ttl).to.equal(10);          // <-- TTL adjusted
    });
  });

});
