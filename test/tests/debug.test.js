const _ = require('lodash');

const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src/';
const ResourceRecord = require(dir + '/ResourceRecord');


describe('debug()', function() {
  let DEBUG, VERBOSE;

  before(function() {
    DEBUG = process.env.DEBUG;
    VERBOSE = process.env.VERBOSE;
  });

  after(function() {
    process.env.DEBUG = DEBUG;
    process.env.VERBOSE = VERBOSE;
  });

  beforeEach(function() {
    delete process.env.DEBUG;
    delete process.env.VERBOSE;
  });


  describe('should return noop for disabled loggers', function() {
    const env = {
      ''                      : 'nothing',
      '-*'                    : 'anything',
      '-debug'                : 'debug',
      'this'                  : 'that',
      '*,-except'             : 'except',
      '-some:subthing'        : 'some:subthing',
      '-some:*'               : 'some:other',
      'some:*,-some:subthing' : 'some:subthing',
    };

    describe('process.env.DEBUG', function() {
      _.forOwn(env, (namespace, input) => {
        it(input, function() {
          process.env.DEBUG = input;
          const debug = rewire(dir + '/debug');
          const fn = debug(namespace);

          expect(fn.v.isEnabled).to.be.false;
          expect(fn.verbose.isEnabled).to.be.false;
        });
      });
    });

    describe('process.env.VERBOSE', function() {
      _.forOwn(env, (namespace, input) => {
        it(input, function() {
          process.env.DEBUG = '*';
          process.env.VERBOSE = input;
          const debug = rewire(dir + '/debug');
          const fn = debug(namespace);

          expect(fn.v.isEnabled).to.be.false;
          expect(fn.verbose.isEnabled).to.be.false;
        });
      });
    });
  });


  describe('should return log fn for enabled loggers', function() {
    const env = {
      '*'                     : 'anything',
      'debug'                 : 'debug',
      '-this,that'            : 'that',
      'some:subthing'         : 'some:subthing',
      'some:*'                : 'some:other',
    };

    describe('process.env.DEBUG', function() {
      _.forOwn(env, (namespace, input) => {
        it(input, function() {
          process.env.DEBUG = input;
          const debug = rewire(dir + '/debug');
          const fn = debug(namespace);

          expect(fn).to.be.a.function;
          expect(fn.isEnabled).to.be.true;
        });
      });
    });

    describe('process.env.VERBOSE', function() {
      _.forOwn(env, (namespace, input) => {
        it(input, function() {
          process.env.DEBUG = '*';
          process.env.VERBOSE = input;
          const debug = rewire(dir + '/debug');
          const fn = debug(namespace);

          expect(fn.v).to.be.a.function;
          expect(fn.v.isEnabled).to.be.true;
        });
      });
    });
  });


  describe('log fn should never throw (lazy testing)', function() {
    let debug, revert, fn;

    before(function() {
      process.env.DEBUG = 'test';
      debug = rewire(dir + '/debug');
      revert = debug.__set__('logger', sinon.stub());
      fn = debug('test');
    });

    after(function() {
      revert();
    });

    const records = [
      new ResourceRecord.A({name: 'Example'}),
      new ResourceRecord.AAAA({name: 'Example'}),
    ];

    const tests = {
      'strings'              : ['An example string'],
      'strings w/ formatters': ['An example string %s', 'stuff'],
      'strings w/ extra args': ['An example string %s', 'stuff', 'extra'],
      'arrays'               : [['An', 'exmaple array']],
      'arrays & formatters'  : ['Array: %s', ['An', 'exmaple array']],
      'arrays & extra args'  : [['An', 'exmaple array'], ['extra']],
      'objects'              : [{An: 'example object'}],
      'objects & formatters' : ['Object: %s', {An: 'example object'}],
      'objects & extra args' : [{An: 'example object'}, {extra: 'arg'}],
      'records formatter'    : ['Records: %r', records],
      'bad records formatter': ['Record?: %r', [...records, {not: 'actually a record'}]],
    };

    tests['really big circular objects'] = [tests];

    _.forOwn(tests, (args, type) => {
      it(`should handle ${type}`, function() {
        expect(() => fn(...args)).to.not.throw();
      });
    });
  });

});
