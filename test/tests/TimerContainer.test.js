const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const TimerContainer = require(dir + '/TimerContainer');


describe('TimerContainer', function() {

  describe('.set', function() {
    it('should add a timer that fires on the context', sinon.test(function() {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.set('name', function() {
        expect(this).to.equal(context);
        this.fn();
      }, 1000);

      this.clock.tick(2000);
      expect(context.fn).to.have.been.called;
    }));

    it('should have name be optional', sinon.test(function() {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.set(() => context.fn(), 1000);

      this.clock.tick(1000);
      expect(context.fn).to.have.been.called;
    }));

    it('should clear old timers with the same name', sinon.test(function() {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.set('name', () => context.fn(), 1000);
      timers.set('name', () => context.fn(), 5000);

      this.clock.tick(1000);
      expect(context.fn).to.not.have.been.called;

      this.clock.tick(5000);
      expect(context.fn).to.have.been.called;
    }));
  });


  describe('.setLazy', function() {
    it('should add a timer that fires on the context', sinon.test(function() {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.setLazy('name', function() {
        expect(this).to.equal(context);
        this.fn();
      }, 1000);

      this.clock.tick(1000);
      expect(context.fn).to.have.been.called;
    }));

    it('should have name be optional', sinon.test(function() {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.setLazy(() => context.fn(), 1000);

      this.clock.tick(1000);
      expect(context.fn).to.have.been.called;
    }));

    it('should clear old timers with the same name', sinon.test(function() {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.setLazy('name', () => context.fn(), 1000);
      timers.setLazy('name', () => context.fn(), 5000);

      this.clock.tick(1000);
      expect(context.fn).to.not.have.been.called;
      expect(timers.has('name')).to.be.true;

      this.clock.tick(5000);
      expect(context.fn).to.have.been.called;
      expect(timers.has('name')).to.be.false;
    }));

    it('should NOT run fn if the timer goes off late', sinon.test(function() {
      const RewiredTimerContainer = rewire(dir + '/TimerContainer');

      const now = sinon.stub();
      now.onFirstCall().returns(0);
      now.onSecondCall().returns(30 * 1000);

      const revert = RewiredTimerContainer.__set__('Date', {now});

      const context = {fn: sinon.stub()};
      const timers = new RewiredTimerContainer(context);

      timers.setLazy(() => context.fn(), 1000);

      this.clock.tick(30 * 1000);
      expect(context.fn).to.not.have.been.called;

      revert();
    }));
  });


  describe('.clear', function() {
    it('should clear old timers with the same name', sinon.test(function() {
      const context = {fn: sinon.stub()};
      const timers = new TimerContainer(context);

      timers.set(() => context.fn(), 1000);
      timers.set(() => context.fn(), 1000);
      timers.setLazy(() => context.fn(), 1000);
      timers.setLazy(() => context.fn(), 1000);
      timers.clear();

      this.clock.tick(1000);
      expect(context.fn).to.not.have.been.called;
    }));
  });


  describe('.has', function() {
    it('should be true/false if timer was set', function() {
      const timers = new TimerContainer();

      timers.set('normal', () => {}, 1000);
      timers.setLazy('lazy', () => {}, 1000);

      expect(timers.has('normal')).to.be.true;
      expect(timers.has('lazy')).to.be.true;
      expect(timers.has('unknown')).to.be.false;
      timers.clear();
    });
  });


  describe('.count', function() {
    it('should return number of timers currently set', function() {
      const timers = new TimerContainer();

      timers.set(() => {}, 1000);
      timers.setLazy(() => {}, 1000);

      expect(timers.count()).to.equal(2);
      timers.clear();
      expect(timers.count()).to.equal(0);
    });
  });

});
