const _ = require('lodash');

const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const EventEmitter = require(dir + '/EventEmitter');


describe('EventEmitter', function() {

  describe('#constructor()', function() {
    it('should subclass EventEmitter', function() {
      expect((new EventEmitter()).emit).to.be.a('function');
    });

    it('should allow options to set max # of listeners', sinon.test(function() {
      this.spy(EventEmitter.prototype, 'setMaxListeners');

      expect((new EventEmitter()).setMaxListeners).to.be.calledWith(0);
      expect((new EventEmitter({maxListeners: 77})).setMaxListeners).to.be.calledWith(77);
    }));
  });


  describe('#using()', function() {
    describe('.on()', function() {
      it('should bind a listener to a context', function() {
        const emitter = new EventEmitter();
        const listener = sinon.stub();
        const obj = {};

        emitter.using(obj).on('event', listener);

        emitter.emit('event');
        emitter.emit('event');

        expect(listener).to.have.been
          .calledTwice
          .calledOn(obj);
      });

      it('should keep track of listener contexts', function() {
        const emitter = new EventEmitter();
        const listener = sinon.stub();
        const obj = {};

        let contexts = emitter._eventContexts.get(obj);
        expect(contexts).to.be.undefined;

        emitter.using(obj).on('event_one', listener);

        contexts = emitter._eventContexts.get(obj);
        expect(contexts.size).to.equal(1);
        expect(_.toArray(contexts.values())).to.include('event_one');

        emitter.using(obj).on('event_two', listener);

        contexts = emitter._eventContexts.get(obj);
        expect(contexts.size).to.equal(2);
        expect(_.toArray(contexts.values())).to.include('event_two');
      });

      it('should work with null/undefined contexts', function() {
        const emitter = new EventEmitter();
        const listener_1 = sinon.stub();
        const listener_2 = sinon.stub();

        emitter.using(null).on('event_one', listener_1);
        emitter.using(undefined).on('event_two', listener_2);

        emitter.emit('event_one', 'emitted');
        emitter.emit('event_two', 'args', 'too');

        expect(emitter._eventContexts.get(null).size).to.equal(1);
        expect(emitter._eventContexts.get(undefined).size).to.equal(1);
        expect(emitter._events).to.not.be.empty;

        expect(listener_1).to.have.been
          .calledOnce
          .calledOn(null)
          .calledWith('emitted');

        expect(listener_2).to.have.been
          .calledOnce
          .calledOn(undefined)
          .calledWith('args', 'too');
      });
    });


    describe('.once()', function() {
      it('should bind a listener for only 1 emit', function() {
        const emitter = new EventEmitter();
        const listener = sinon.stub();
        const obj = {};

        emitter.using(obj).once('event', listener);

        emitter.emit('event');
        emitter.emit('event');

        expect(listener).to.have.been
          .calledOnce
          .calledOn(obj);
      });
    });
  });


  describe('#off()', function() {
    it('should alias this.removeListener()',function() {
      const fn = () => {};
      const emitter = new EventEmitter();
      sinon.stub(emitter, 'removeListener');

      emitter.off('event', fn);

      expect(emitter.removeListener).to.have.been.calledWith('event', fn);
    });
  });


  describe('#removeListenersCreatedBy()', function() {
    it('should remove all listeners from a context', function() {
      const fn = () => {};
      const obj = {};
      const emitter = new EventEmitter();
      sinon.spy(emitter, 'off');

      emitter.using(obj)
        .once('event_one', fn)
        .on('event_two', fn);

      emitter.removeListenersCreatedBy(obj);

      expect(emitter.off).to.have.been
        .calledTwice
        .calledWith('event_one')
        .calledWith('event_two');

      expect(emitter._events).to.be.empty;
      expect(emitter._eventContexts.get(obj)).to.be.undefined;
    });

    it('should work with null/undefined contexts', function() {
      const fn = () => {};
      const emitter = new EventEmitter();
      sinon.spy(emitter, 'off');

      emitter.using(undefined)
        .on('event_one', fn)
        .on('event_one', fn);

      emitter.using(null)
        .on('event_two', fn)
        .on('event_two', fn);

      emitter.removeListenersCreatedBy(undefined);

      expect(emitter.off).to.have.been
        .calledTwice
        .calledWith('event_one');

      emitter.removeListenersCreatedBy(null);

      expect(emitter.off).to.have.been
        .callCount(4)
        .calledWith('event_two');

      expect(emitter._events).to.be.empty;
      expect(emitter._eventContexts.size).to.equal(0);
    });

    it('should not throw on unknown contexts', function() {
      const emitter = new EventEmitter();

      expect(() => emitter.removeListenersCreatedBy('asdf')).to.not.throw(Error);
    });
  });

});
