const _ = require('lodash');

const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';
const ResourceRecord = require(dir + '/ResourceRecord');


const ExpiringRecordCollection = require(dir + '/ExpiringRecordCollection');


describe('ExpiringRecordCollection', function() {
  // SRV_1 & SRV_2 are related (same name, type) and will have the same namehash
  // PTR is a shared, non-unique record type
  const SRV_1 = new ResourceRecord.SRV({name: 'SRV', target: 'something', ttl: 10});
  const SRV_2 = new ResourceRecord.SRV({name: 'SRV', target: 'different', ttl: 20});
  const TXT   = new ResourceRecord.TXT({name: 'TXT', ttl: 10});
  const PTR   = new ResourceRecord.PTR({name: 'PTR', ttl: 10});


  describe('#has()', sinon.test(function() {
    const collection = new ExpiringRecordCollection([TXT]);

    it('should return true if collection already has record', function() {
      expect(collection.has(TXT)).to.be.true;
    });

    it('should return false if it does not have record', function() {
      expect(collection.has(PTR)).to.be.false;
    });
  }));


  describe('#add()', function() {
    it('should add record and #_schedule timers', function() {
      const collection = new ExpiringRecordCollection();
      sinon.stub(collection, '_schedule');

      collection.add(PTR);

      expect(collection.size).to.equal(1);
      expect(collection._schedule).to.have.been.calledOnce;
    });

    it('should updating existing record', function() {
      const collection = new ExpiringRecordCollection();
      sinon.stub(collection, '_schedule');

      collection.add(PTR);
      collection.add(PTR);

      expect(collection.size).to.equal(1);
    });

    it('should setToExpire instead of adding if TTL=0', function() {
      const zero = new ResourceRecord.SRV({name: 'TTL=0', ttl: 0});
      const collection = new ExpiringRecordCollection();
      sinon.stub(collection, 'setToExpire');

      collection.add(zero);

      expect(collection.size).to.equal(0);
      expect(collection.setToExpire).to.have.been.calledOnce;
    });
  });


  describe('#addEach()', function() {
    it('should add each record', function() {
      const collection = new ExpiringRecordCollection();
      collection.addEach([TXT, PTR]);

      expect(collection.has(TXT)).to.be.true;
      expect(collection.has(PTR)).to.be.true;
    });
  });


  describe('#hasAddedWithin()', function() {
    it('should be false if record does not exist yet', function() {
      const collection = new ExpiringRecordCollection([PTR]);

      expect(collection.hasAddedWithin(TXT, 1)).to.be.false;
    });

    it('should be true if has been added in range', sinon.test(function() {
      const collection = new ExpiringRecordCollection([PTR]);
      this.clock.tick(5 * 1000);

      expect(collection.hasAddedWithin(PTR, 6)).to.be.true;
    }));

    it('should be false if hasn\'t been added in range', sinon.test(function() {
      const collection = new ExpiringRecordCollection([PTR]);
      this.clock.tick(5 * 1000);

      expect(collection.hasAddedWithin(PTR, 4)).to.be.false;
    }));
  });


  describe('#get()', function() {
    it('should return undefined if record does not exist', function() {
      const collection = new ExpiringRecordCollection([PTR]);
      expect(collection.get(TXT)).to.be.undefined;
    });

    it('should return clone of record with adjusted TTL', sinon.test(function() {
      const collection = new ExpiringRecordCollection([PTR]);
      this.clock.tick(3 * 1000);

      const clone = collection.get(PTR);

      expect(clone).to.not.equal(PTR);
      expect(clone.ttl).to.equal(7);
    }));
  });


  describe('#delete()', function() {
    it('should remove record', function() {
      const collection = new ExpiringRecordCollection([TXT]);
      collection.delete(TXT);

      expect(collection.size).to.equal(0);
    });

    it('should remove record id from related group set', function() {
      const collection = new ExpiringRecordCollection([SRV_1, SRV_2]);
      collection.delete(SRV_1);

      expect(collection.size).to.equal(1);
      expect(collection._related[SRV_1.namehash].size).to.equal(1);
    });

    it('should do nothing if collection does not have record', function() {
      const collection = new ExpiringRecordCollection();
      collection.delete(SRV_1);

      expect(collection.size).to.equal(0);
    });

    it('should emit "expired" event with record', function(done) {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.on('expired', (result) => {
        expect(result).to.equal(PTR);
        done();
      });

      collection.delete(PTR);
    });
  });


  describe('#clear()', function() {
    it('should clear all timers and records', function() {
      const collection = new ExpiringRecordCollection([TXT, PTR]);
      collection.clear();

      expect(collection.size).to.equal(0);
    });
  });


  describe('#setToExpire()', function() {
    it('should clear timers and delete in 1s', sinon.test(function() {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.setToExpire(PTR);
      this.clock.tick(1 * 1000);

      expect(collection.size).to.equal(0);
    }));

    it('should do nothing if it does not have the record', sinon.test(function() {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.setToExpire(TXT);
      this.clock.tick(1 * 1000);

      expect(collection.size).to.equal(1);
    }));

    it('should not clear existing delete timers', sinon.test(function() {
      const collection = new ExpiringRecordCollection([PTR]);

      collection.setToExpire(PTR);

      this.clock.tick(0.5 * 1000);
      collection.setToExpire(PTR); // should NOT reset timer to 1s

      this.clock.tick(0.5 * 1000); // delete should have fired
      expect(collection.size).to.equal(0);
    }));
  });


  describe('#flushRelated()', function() {
    it('should expire related records added > 1s ago', sinon.test(function() {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      this.clock.tick(2 * 1000);
      collection.flushRelated(SRV_2);

      expect(collection.setToExpire).to.have.been.calledWith(SRV_1);
    }));

    it('should not expire records added < 1s ago', sinon.test(function() {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      this.clock.tick(0.5 * 1000);
      collection.flushRelated(SRV_2);

      expect(collection.setToExpire).to.not.have.been.called;
    }));

    it('should a record should not flush itself', sinon.test(function() {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      this.clock.tick(2 * 1000);
      collection.flushRelated(TXT);

      expect(collection.setToExpire).to.not.have.been.called;
    }));

    it('should *not* flush with non-unique records', sinon.test(function() {
      const collection = new ExpiringRecordCollection([SRV_1, TXT, PTR]);
      sinon.stub(collection, 'setToExpire');

      collection.flushRelated(PTR);

      expect(collection.setToExpire).to.not.have.been.called;
    }));
  });


  describe('#toArray()', function() {
    it('should return array of its records', function() {
      expect((new ExpiringRecordCollection([TXT])).toArray()).to.eql([TXT]);
    });
  });


  describe('#hasConflictWith()', sinon.test(function() {
    const collection = new ExpiringRecordCollection([SRV_1]);

    it('should return true if collection has a conflicting record', function() {
      expect(collection.hasConflictWith(SRV_2)).to.be.true;
    });

    it('should return false if collection has no conflicting records', function() {
      expect(collection.hasConflictWith(TXT)).to.be.false;
    });

    it('should not let a record to conflict with itself', function() {
      expect(collection.hasConflictWith(SRV_1)).to.be.false;
    });

    it('should always return false when given non-unique a record', function() {
      expect(collection.hasConflictWith(PTR)).to.be.false;
    });
  }));


  describe('#_getRelatedRecords()', function() {
    it('should return an array of records with the same name', function() {
      const collection = new ExpiringRecordCollection([PTR]);
      expect(collection._getRelatedRecords(PTR.namehash)).to.eql([PTR]);
    });

    it('should return an empty array if no related records exist', function() {
      const collection = new ExpiringRecordCollection([PTR]);
      expect(collection._getRelatedRecords('???')).to.eql([]);
    });
  });


  describe('#_filterTTL()', function() {
    it('should only return records with TTLs > cutoff', sinon.test(function() {
      const collection = new ExpiringRecordCollection([SRV_1]);

      this.clock.tick(8 * 1000);
      const results = collection._filterTTL([SRV_1, SRV_2], 0.50);

      expect(results).to.have.lengthOf(1);
      expect(results[0].hash).to.equal(SRV_2.hash);
    }));

    it('should return an array of clones', function() {
      const collection = new ExpiringRecordCollection([SRV_1]);
      const results = collection._filterTTL([SRV_1], 0.50);

      expect(results).to.not.equal([SRV_1]);
    });

    it('should subtract elapsed TTL for records', sinon.test(function() {
      const collection = new ExpiringRecordCollection([SRV_1]);

      this.clock.tick(4 * 1000);
      const results = collection._filterTTL([SRV_1], 0.50);

      expect(results).to.have.lengthOf(1);
      expect(results[0].ttl).to.equal(6);
    }));
  });


  describe('#_schedule()', function() {
    it('should schedule expiration and reissue timers', sinon.test(function() {
      const collection = new ExpiringRecordCollection([PTR]);
      sinon.stub(collection, 'emit');

      this.clock.tick(10 * 1000);

      expect(collection.emit).to.have.been
        .callCount(5)
        .calledWith('reissue', PTR)
        .calledWith('expired', PTR);
    }));
  });

});
