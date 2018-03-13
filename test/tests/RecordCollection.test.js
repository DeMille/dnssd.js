const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';
const ResourceRecord = require(dir + '/ResourceRecord');


const RecordCollection = require(dir + '/RecordCollection');


describe('RecordCollection', function() {
  const record_1 = new ResourceRecord.SRV({name: '#1'});
  const record_2 = new ResourceRecord.SRV({name: '#2'});
  const record_3 = new ResourceRecord.SRV({name: '#3'});

  describe('#constructor()', function() {
    it('should init with correct properties', function() {
      const collection = new RecordCollection();

      expect(collection.size).to.equal(0);
      expect(collection._records).to.eql({});
    });

    it('should call #addEach if given initial records', sinon.test(function() {
      this.stub(RecordCollection.prototype, 'addEach');
      const record = new ResourceRecord.SRV({name: '#1'});
      const collection = new RecordCollection([record]);

      expect(collection.addEach).to.have.been.calledOnce;
    }));
  });


  describe('#has()', function() {
    const collection = new RecordCollection([record_1]);

    it('should return true if has record', function() {
      expect(collection.has(record_1)).to.be.true;
    });

    it('should return false if it does not have record', function() {
      expect(collection.has(record_2)).to.be.false;
    });
  });


  describe('#hasEach()', function() {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if has every record', function() {
      expect(collection.hasEach([record_1, record_2])).to.be.true;
    });

    it('should return false if it does not have any record', function() {
      expect(collection.hasEach([record_2, record_3])).to.be.false;
    });
  });


  describe('#hasAny()', function() {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if it has any of the records', function() {
      expect(collection.hasAny([record_1, record_3])).to.be.true;
    });

    it('should return false if it does not have any records', function() {
      expect(collection.hasAny([record_3])).to.be.false;
    });
  });


  describe('#get()', function() {
    const duplicate = new ResourceRecord.SRV({name: '#1'});
    const collection = new RecordCollection([record_1]);

    it('should return original record if collection has matching', function() {
      expect(collection.get(duplicate)).to.equal(record_1);
    });

    it('should return undefined if it does not have record', function() {
      expect(collection.get(record_3)).to.be.undefined;
    });
  });


  describe('#add()', function() {
    it('should add record and increment size', function() {
      const collection = new RecordCollection();
      collection.add(record_1);

      expect(collection.has(record_1)).to.be.true;
      expect(collection.size).to.equal(1);
    });

    it('should not increment size if record already added', function() {
      const collection = new RecordCollection([record_1]);
      collection.add(record_1);
      collection.add(record_1);

      expect(collection.has(record_1)).to.be.true;
      expect(collection.size).to.equal(1);
    });
  });


  describe('#addEach()', function() {
    it('should call #add for each record', function() {
      const collection = new RecordCollection();
      sinon.stub(collection, 'add');

      collection.addEach([record_1, record_1]);

      expect(collection.add).to.have.been
        .calledTwice
        .calledWith(record_1)
        .calledOn(collection);
    });
  });


  describe('#delete()', function() {
    const collection = new RecordCollection([record_1]);

    it('should return if collection does not have record', function() {
      collection.delete(record_2);

      expect(collection.size).to.equal(1);
    });

    it('should remove record and decrement size', function() {
      collection.delete(record_1);

      expect(collection.has(record_1)).to.be.false;
      expect(collection.size).to.equal(0);
    });
  });


  describe('#clear()', function() {
    it('should remove all record and reset size', function() {
      const collection = new RecordCollection([record_1, record_2]);

      collection.clear();

      expect(collection._records).to.eql({});
      expect(collection.size).to.equal(0);
    });
  });


  describe('#toArray()', function() {
    it('should return array of its records', function() {
      const collection = new RecordCollection([record_1, record_2]);

      expect(collection.toArray()).to.eql([record_1, record_2]);
    });
  });


  describe('#forEach()', function() {
    it('should call fn with given context', function() {
      const collection = new RecordCollection([record_1, record_2]);
      const fn = sinon.stub();
      const context = {};

      collection.forEach(fn, context);

      expect(fn).to.have.been
        .calledTwice
        .calledOn(context);
    });
  });


  describe('#filter()', function() {
    const collection = new RecordCollection([record_1, record_2]);
    const fn = sinon.stub();
    const context = {};

    it('should call fn with given context', function() {
      collection.filter(fn, context);

      expect(fn).to.have.been
        .calledTwice
        .calledOn(context);
    });

    it('should filter records using fn and return new collection', function() {
      const result = collection.filter(record => record.name === '#1');

      expect(result).to.eql(new RecordCollection([record_1]));
    });
  });


  describe('#reject()', function() {
    const collection = new RecordCollection([record_1, record_2]);
    const fn = sinon.stub();
    const context = {};

    it('should call fn with given context', function() {
      collection.reject(fn, context);

      expect(fn).to.have.been
        .calledTwice
        .calledOn(context);
    });

    it('should reject records using fn and return new collection', function() {
      const result = collection.reject(record => record.name === '#1');

      expect(result).to.eql(new RecordCollection([record_2]));
    });
  });


  describe('#map()', function() {
    const collection = new RecordCollection([record_1, record_2]);
    const fn = sinon.stub();
    const context = {};

    it('should call fn with given context', function() {
      collection.map(fn, context);

      expect(fn).to.have.been
        .calledTwice
        .calledOn(context);
    });

    it('should map records using fn and return an array', function() {
      const result = collection.map(record => record.name);

      expect(result).to.eql(['#1', '#2']);
    });
  });


  describe('#reduce()', function() {
    const collection = new RecordCollection([record_1, record_2]);
    const fn = sinon.stub();
    const context = {};

    it('should call fn with given context', function() {
      collection.reduce(fn, [], context);

      expect(fn).to.have.been
        .calledTwice
        .calledOn(context);
    });

    it('should reduce records using fn and return an array', function() {
      const result = collection.reduce((acc, record) => acc + record.name, '');

      expect(result).to.equal('#1#2');
    });
  });


  describe('#some()', function() {
    const collection = new RecordCollection([record_1, record_2]);
    const fn = sinon.stub();
    const context = {};

    it('should call fn with given context', function() {
      collection.some(fn, context);

      expect(fn).to.have.been
        .calledTwice
        .calledOn(context);
    });

    it('should return true if some records match fn', function() {
      const result = collection.some(record => record.name === '#1');

      expect(result).to.true;
    });

    it('should return false if no records match fn', function() {
      const result = collection.some(record => record.name === '#3');

      expect(result).to.false;
    });
  });


  describe('#every()', function() {
    const collection = new RecordCollection([record_1, record_2]);
    const fn = sinon.stub();
    const context = {};

    it('should call fn with given context', function() {
      collection.every(fn, context);

      expect(fn).to.have.always.been.calledOn(context);
    });

    it('should return true if every records match fn', function() {
      const result = collection.every(record => record instanceof ResourceRecord);

      expect(result).to.true;
    });

    it('should return false if no records match fn', function() {
      const result = collection.every(record => record.name === 'something');

      expect(result).to.false;
    });
  });


  describe('#equals()', function() {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return true if equal to given array', function() {
      const values = [record_1, record_2];
      expect(collection.equals(values)).to.be.true;
    });

    it('should return false if not equal to given array', function() {
      const values = [record_1];
      expect(collection.equals(values)).to.be.false;
    });

    it('should return true if equal to given collection', function() {
      const values = new RecordCollection([record_1, record_2]);
      expect(collection.equals(values)).to.be.true;
    });

    it('should return false if not equal to given collection', function() {
      const values = new RecordCollection([record_1]);
      expect(collection.equals(values)).to.be.false;
    });
  });


  describe('#difference()', function() {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return a new collection differenced with an array', function() {
      const values = [record_1];
      const difference = new RecordCollection([record_2]);

      expect(collection.difference(values)).to.eql(difference);
    });

    it('should return a new collection differenced with a collection', function() {
      const values = new RecordCollection([record_1]);
      const difference = new RecordCollection([record_2]);

      expect(collection.difference(values)).to.eql(difference);
    });
  });


  describe('#intersection()', function() {
    const collection = new RecordCollection([record_1, record_2]);

    it('should return a new collection intersected with an array', function() {
      const values = [record_1];
      const intersection = new RecordCollection([record_1]);

      expect(collection.intersection(values)).to.eql(intersection);
    });

    it('should return a new collection intersected with a collection', function() {
      const values = new RecordCollection([record_1]);
      const intersection = new RecordCollection([record_1]);

      expect(collection.intersection(values)).to.eql(intersection);
    });
  });


  describe('#getConflicts()', function() {
    const A_1 = new ResourceRecord.A({name: 'A', address: '0.0.0.1'});
    const A_2 = new ResourceRecord.A({name: 'A', address: '0.0.0.2'});
    const A_3 = new ResourceRecord.A({name: 'A', address: '0.0.0.3'});
    const A_4 = new ResourceRecord.A({name: 'A', address: '0.0.0.4'});

    const collection = new RecordCollection([A_1, A_2]);

    it('should return empty array if no conflicts were found', function() {
      expect(collection.getConflicts([A_1])).to.be.empty;
      expect(collection.getConflicts([A_1, A_2])).to.be.empty;
    });

    it('should return array of conflicting records', function() {
      const input = [A_3];
      const conflicts = [A_3];

      expect(collection.getConflicts(input)).to.eql(conflicts);
    });

    it('should ignore, when comparing, records that occur in both sets', function() {
      const input = [A_1, A_2, A_3, A_4];

      expect(collection.getConflicts(input)).to.be.empty;
    });
  });

});
