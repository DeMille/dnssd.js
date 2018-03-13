const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';
const ResourceRecord = require(dir + '/ResourceRecord');

const Fake = require('../Fake');


const resolve = rewire(dir + '/resolve');


describe('resolve', function() {
  const intf = new Fake.DisposableInterface();

  const isValidName = sinon.stub();
  isValidName.returns(true);
  isValidName.withArgs('non-existant').returns(false);

  const DisposableInterface = {
    create: sinon.stub().returns(intf),
    isValidName: isValidName,
  };

  const query = new Fake.Query(); // does nothing
  const QueryConstructor = sinon.stub().returns(query);

  const resolver = new Fake.ServiceResolver(); // does nothing
  const ResolverConstructor = sinon.stub().returns(resolver);

  resolve.__set__('DisposableInterface', DisposableInterface);
  resolve.__set__('Query', QueryConstructor);
  resolve.__set__('ServiceResolver', ResolverConstructor);

  const A    = new ResourceRecord.A({name: 'A', address: '1.1.1.1'});
  const AAAA = new ResourceRecord.AAAA({name: 'AAAA', address: 'FF::'});
  const TXT  = new ResourceRecord.TXT({name: 'TXT', txt: {key: 'value'}});
  const SRV  = new ResourceRecord.SRV({name: 'SRV', target: 'Target', port: 9999});

  beforeEach(function() {
    intf.reset();
    query.reset();
    resolver.reset();
  });


  describe('.resolve', function() {
    describe('should throw on invalid input', function() {
      it('name', function() {
        expect(() => resolve.resolve()).to.throw(Error);
        expect(() => resolve.resolve('')).to.throw(Error);
        expect(() => resolve.resolve(999)).to.throw(Error);
      });

      it('qtype', function() {
        expect(() => resolve.resolve('name')).to.throw(Error);
        expect(() => resolve.resolve('name', '')).to.throw(Error);
        expect(() => resolve.resolve('name', 'WHAT')).to.throw(Error);
        expect(() => resolve.resolve('name', 0)).to.throw(Error);
      });

      it('options', function() {
        const options = {interface: 'non-existant'};

        expect(() => resolve.resolve('name', 1, 'wrong')).to.throw(Error);
        expect(() => resolve.resolve('name', 1, options)).to.throw(Error);
      });
    });

    it('should resolve answer and any related records', function(done) {
      resolve.resolve('record.name.', 'A').then((result) => {
        expect(result.answer).to.equal(A);
        expect(result.related).to.have.members([AAAA]);
        expect(intf.stop).to.have.been.called;
        done();
      });

      // need to let the interface stub's bind method resolve first
      setTimeout(() => query.emit('answer', A, [AAAA]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolve('record.name', 'A').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolve4', function() {
    it('should resolve with an address', function(done) {
      resolve.resolve4('record.name.').then((result) => {
        expect(result).to.equal(A.address);
        done();
      });

      // need to let the stubs bind resolve first
      setTimeout(() => query.emit('answer', A, [AAAA]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolve4('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolve6', function() {
    it('should resolve with an address', function(done) {
      resolve.resolve6('record.name.').then((result) => {
        expect(result).to.equal(AAAA.address);
        done();
      });

      setTimeout(() => query.emit('answer', AAAA, [A]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolve6('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolveSRV', function() {
    it('should resolve with SRV info', function(done) {
      resolve.resolveSRV('record.name.').then((result) => {
        expect(result).to.eql({
          target: SRV.target,
          port  : SRV.port,
        });

        done();
      });

      setTimeout(() => query.emit('answer', SRV, [TXT]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolveSRV('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolveTXT', function() {
    it('should resolve with TXT info', function(done) {
      resolve.resolveTXT('record.name.').then((result) => {
        expect(result).to.eql({
          txt   : TXT.txt,
          txtRaw: TXT.txtRaw,
        });

        done();
      });

      // need to let the stubs bind resolve first
      setTimeout(() => query.emit('answer', TXT, [SRV]), 10);
    });

    it('should reject with an error on timeout', function(done) {
      resolve.resolveTXT('record.name.').catch(() => done());

      setTimeout(() => query.emit('timeout'), 10);
    });
  });


  describe('.resolveService', function() {
    describe('should throw on invalid input', function() {
      it('name', function() {
        expect(() => resolve.resolveService()).to.throw(Error);
        expect(() => resolve.resolveService('')).to.throw(Error);
        expect(() => resolve.resolveService(999)).to.throw(Error);
      });

      it('options', function() {
        const options = {interface: 'non-existant'};

        expect(() => resolve.resolveService('name', 'wrong')).to.throw(Error);
        expect(() => resolve.resolveService('name', options)).to.throw(Error);
      });
    });

    it('should reject with an error on timeouts', function(done) {
      const expected = {fake: 'service'};
      resolver.service.returns(expected);

      resolve.resolveService('service.name.').then((result) => {
        expect(result).to.equal(expected);
        expect(resolver.stop).to.have.been.called;
        expect(intf.stop).to.have.been.called;
        done();
      });

      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should reject with an error on timeouts', function(done) {
      resolve.resolveService('service.name', {timeout: 10}).catch(() => done());
    });
  });

});
