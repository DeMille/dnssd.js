const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

describe('sleep', function() {
  it('should check for sleep and emit `wake` events', sinon.test(function() {
    const now = sinon.stub();
    now.onFirstCall().returns(60 * 1000); // timer fires on time
    now.onSecondCall().returns(31 * 60 * 1000); // timer fires 30min late

    // require within sinon.test() so fake timers will be set on load
    const sleep = rewire(dir + '/sleep');
    const revert = sleep.__set__('Date', {now});

    const stub = sinon.stub();
    sleep.on('wake', stub);

    this.clock.tick(60 * 1000); // first interval ok
    this.clock.tick(2 * 60 * 1000); // second interval emits wake

    expect(stub).to.have.been.calledOnce;
    revert();
  }));
});
