const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const Packet                   = require(dir + '/Packet');
const QueryRecord              = require(dir + '/QueryRecord');
const ResourceRecord           = require(dir + '/ResourceRecord');
const ExpiringRecordCollection = require(dir + '/ExpiringRecordCollection');

const Fake = require('../Fake');


const Query = require(dir + '/Query');


describe('Query', function() {
  const intf      = new Fake.NetworkInterface({id: 'Ethernet'});
  const offswitch = new Fake.EventEmitter();

  intf.cache = new ExpiringRecordCollection();

  // reset all stubbed functions after each test
  afterEach(function() {
    intf.reset();
    offswitch.reset();
    intf.cache.clear();
  });


  describe('#add()', function() {
    it('should add to this._questions', function() {
      const query = new Query(intf, offswitch);

      // single & multiple
      query.add({name: 'Record A'});
      query.add([{name: 'Record AAAA'}]);

      expect(query._questions.size).to.equal(2);
    });
  });


  describe('#start()', function() {
    it('should check cache unless specifically told not to', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, '_checkCache');

      query.ignoreCache(true);
      query.start();
      expect(query._checkCache).to.not.have.been.called;

      query.ignoreCache(false);
      query.start();
      expect(query._checkCache).to.have.been.called;
    });

    it('should stop if it has no questions or were all answered', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, '_checkCache');
      sinon.stub(query, 'stop');

      query.start();

      expect(query.stop).to.have.been.called;
    });

    it('should add `answer` and `query` event listeners', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, '_checkCache');
      sinon.stub(query, '_onAnswer');
      sinon.stub(query, '_onQuery');

      query.add({name: 'Bogus Record'});
      query.start();

      intf.emit('answer');
      intf.emit('query');

      expect(query._onAnswer).to.have.been.called;
      expect(query._onQuery).to.have.been.called;
    });

    it('should queue send for short delay & set timeout', sinon.test(function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, '_checkCache');
      sinon.stub(query, '_send');
      sinon.stub(query, '_startTimer');

      query.add({name: 'Bogus Record'});
      query.setTimeout(120);
      query.start();

      expect(query._startTimer).to.have.not.been.called;
      expect(query._send).to.have.not.been.called;

      this.clock.tick(120);

      expect(query._startTimer).to.have.been.called;
      expect(query._send).to.have.been.called;
    }));
  });


  describe('#stop()', function() {
    it('should stop & remove listeners', function() {
      const query = new Query(intf, offswitch);
      query.stop();

      expect(intf.removeListenersCreatedBy).to.have.been.calledWith(query);
    });

    it('should not do anything if already stopped', function() {
      const query = new Query(intf, offswitch);

      query.stop();
      query.stop(); // <-- does nothing

      expect(intf.removeListenersCreatedBy).to.not.have.been.calledTwice;
    });
  });


  describe('#_restart()', function() {
    it('should reset questions/answers and resend query', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, '_send');

      const answer = new ResourceRecord.AAAA({name: 'Record'});
      const packet = new Packet();
      packet.setAnswers([answer]);

      query.add([{name: answer.name}, {name: 'unknown'}]);
      query.start();

      intf.emit('answer', packet);
      expect(query._questions.size).to.equal(1);

      query._restart();
      expect(query._questions.size).to.equal(2);
      expect(query._send).to.have.been.called;
    });

    it('should not do anything if already stopped', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, '_send');

      query.stop();
      query._restart(); // <-- does nothing

      expect(query._send).to.not.have.been.called;
    });
  });


  describe('#_send()', function() {
    it('should add known answers and send packet', function() {
      const query = new Query(intf, offswitch);

      const packet = new Packet();
      packet.setQuestions(['fake']);

      sinon.stub(query, '_makePacket');
      sinon.stub(query, '_addKnownAnswers').returns(packet);

      query._send();

      expect(intf.send).to.have.been.calledWith(packet);
    });

    it('should not send packets if they are empty', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, '_addKnownAnswers').returns(new Packet());

      query._send();

      expect(intf.send).to.not.have.been.called;
    });

    it('should make next packet early and queue next send', function() {
      const query = new Query(intf, offswitch);

      sinon.stub(query, '_makePacket');
      sinon.stub(query, '_addKnownAnswers').returns(new Packet());

      query._send();

      expect(query._makePacket).to.have.been.called;
      expect(query._next).to.equal(1000 * 2);
    });

    it('should not queue further sends for non-continuous queries', function() {
      const query = new Query(intf, offswitch);

      sinon.stub(query, '_makePacket');
      sinon.stub(query, '_addKnownAnswers').returns(new Packet());

      query.continuous(false);
      query._send();

      expect(query._makePacket).to.not.have.been.called;
      expect(query._nextQueryTimer).to.not.exist;
    });
  });


  describe('#_addKnownAnswers()', function() {
    it('should only include answers > 50% TTL and set isUnique to false', function() {
      const query = new Query(intf, offswitch);

      const answer = new ResourceRecord.SRV({name: 'SRV'});
      sinon.stub(query._knownAnswers, 'getAboveTTL').returns([answer]);

      const packet = query._addKnownAnswers(new Packet());

      expect(packet.answers).to.eql([answer]);
      expect(packet.answers[0].isUnique).to.be.false;
    });
  });


  describe('#_removeKnownAnswer()', function() {
    it('should remove answers from known list as they expire from cache', function() {
      const query = new Query(intf, offswitch);

      const answer = new ResourceRecord.PTR({name: 'PTR'});
      const packet = new Packet();
      packet.setAnswers([answer]);

      query.add({name: answer.name});
      query.start();

      intf.emit('answer', packet);
      expect(query._knownAnswers.size).to.equal(1);

      intf.cache.emit('expired', answer);
      expect(query._knownAnswers.size).to.equal(0);
    });
  });


  describe('#_onAnswer()', function() {
    it('should check incoming records for answers to questions', function(done) {
      const query = new Query(intf, offswitch);

      const answer = new ResourceRecord.AAAA({name: 'Record'}); // answsers
      const related = new ResourceRecord.A({name: 'Related'});  // doesn't

      const packet = new Packet();
      packet.setAnswers([answer]);
      packet.setAdditionals([related]);

      query.on('answer', (record, others) => {
        expect(record).to.equal(answer);
        expect(others).to.eql([related]);
        done();
      });

      query.add({name: 'Record'});
      query._onAnswer(packet);
    });

    it('should remove unique answers from questions list', function(done) {
      const query = new Query(intf, offswitch);

      const packet = new Packet();
      packet.setAnswers([ new ResourceRecord.AAAA({name: 'Unique'}) ]);

      query.on('answer', () => {
        expect(query._knownAnswers.size).to.equal(0);
        expect(query._questions.size).to.equal(0);
        done();
      });

      query.add({name: 'Unique'});
      query._onAnswer(packet);
    });

    it('should add shared records to known answer list instead', function(done) {
      const query = new Query(intf, offswitch);

      const packet = new Packet();
      packet.setAnswers([ new ResourceRecord.PTR({name: 'Shared'}) ]);

      query.on('answer', () => {
        expect(query._knownAnswers.size).to.equal(1);
        expect(query._questions.size).to.equal(1);
        done();
      });

      query.add({name: 'Shared'});
      query._onAnswer(packet);
    });

    it('should stop on first answer if query is non continuous', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, 'stop');

      const packet = new Packet();
      packet.setAnswers([ new ResourceRecord.PTR({name: 'Not an answer'}) ]);

      query.continuous(false);
      query.add({name: 'Somthing'});
      query._onAnswer(packet);

      expect(query.stop).to.have.been.called;
    });

    it('should stop if all questions were answered', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, 'stop');

      query._onAnswer(new Packet());

      expect(query._questions.size).to.equal(0);
      expect(query.stop).to.have.been.called;
    });

    it('should exit early if stopped', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, 'stop');

      query._isStopped = true;
      query._onAnswer(new Packet());

      expect(query.stop).to.not.have.been.called;
    });
  });


  describe('#_onQuery()', function() {
    it('should remove duplicate questions from outgoing packet', function() {
      const query = new Query(intf, offswitch);
      const question = new QueryRecord({name: 'Question'});

      const incoming = new Packet();
      incoming.setQuestions([question]);

      query._queuedPacket = new Packet();
      query._queuedPacket.setQuestions([question]);

      query._onQuery(incoming);

      expect(query._queuedPacket.questions).to.be.empty;
    });

    it('should ONLY remove duplicate questions and leave the others', function() {
      const query = new Query(intf, offswitch);

      const question_A = new QueryRecord({name: 'Question A'});
      const question_B = new QueryRecord({name: 'Question B'});

      const packet = new Packet();
      packet.setQuestions([question_A]);

      query._queuedPacket = new Packet();
      query._queuedPacket.setQuestions([question_A, question_B]);

      query._onQuery(packet);

      expect(query._queuedPacket.questions).to.eql([question_B]);
    });

    it('should not perform check if stopped', function() {
      const query = new Query(intf, offswitch);
      const question = new QueryRecord({name: 'Question'});

      const incoming = new Packet();
      incoming.setQuestions([question]);

      query._queuedPacket = new Packet();
      query._queuedPacket.setQuestions([question]);

      query.stop();
      query._onQuery(incoming);

      expect(query._queuedPacket.questions).to.not.be.empty;
    });

    it('should not do check if query came from the same interface', function() {
      const query = new Query(intf, offswitch);
      const question = new QueryRecord({name: 'Question'});

      const incoming = new Packet();
      incoming.setQuestions([question]);
      sinon.stub(incoming, 'isLocal').returns(true);

      query._queuedPacket = new Packet();
      query._queuedPacket.setQuestions([question]);

      query._onQuery(incoming);

      expect(query._queuedPacket.questions).to.not.be.empty;
    });

    it('should not perform check if packet has known answers', function() {
      const query = new Query(intf, offswitch);
      const question = new QueryRecord({name: 'Record'});

      const incoming = new Packet();
      incoming.setQuestions([question]);
      incoming.setAnswers([ new ResourceRecord.AAAA({name: 'Record'}) ]);

      query._queuedPacket = new Packet();
      query._queuedPacket.setQuestions([question]);

      query._onQuery(incoming);

      expect(query._queuedPacket.questions).to.not.be.empty;
    });
  });


  describe('#_checkCache()', function() {
    const PTR = new ResourceRecord.PTR({name: 'shared'});
    const SRV = new ResourceRecord.SRV({name: 'unique'});
    const TXT = new ResourceRecord.TXT({name: 'not_in_cache'});

    beforeEach(function() {
      intf.cache.addEach([PTR, SRV]);
    });

    it('should check interface cache for answers to questions', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, 'emit');

      query.add([
        {name: 'shared', qtype: PTR.rrtype},
        {name: 'unique', qtype: SRV.rrtype},
      ]);

      query._checkCache();

      expect(query._questions.size).to.equal(1);
      expect(query._knownAnswers.size).to.equal(1);
      expect(query.emit).to.have.been
        .calledWith('answer', PTR)
        .calledWith('answer', SRV);
    });

    it('should do nothing if no answers are found', function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, 'emit');

      query.add({name: 'not_in_cache', qtype: TXT.rrtype});
      query._checkCache();

      expect(query._questions.size).to.equal(1);
      expect(query._knownAnswers.size).to.equal(0);
      expect(query.emit).to.not.have.been.called;
    });
  });


  describe('#_startTimer()', function() {
    it('should timeout and stop query if not answered', sinon.test(function() {
      const query = new Query(intf, offswitch);
      sinon.stub(query, 'emit');

      query.setTimeout(2000);
      query._startTimer();

      this.clock.tick(3000);

      expect(query.emit).to.have.been.calledWith('timeout');
      expect(query._isStopped).to.be.true;
    }));
  });

});
