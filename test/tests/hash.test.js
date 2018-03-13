const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const hash = rewire(dir + '/hash');
const stringify = hash.__get__('stringify');


describe('hash', function() {

  describe('stringify()', function() {
    it('should handle arrays of primitives', function() {
      const input = ['foo', 'bar', 1, 2, true, false];
      const expected = '["foo","bar",1,2,true,false]';

      expect(stringify(input)).to.equal(expected);
    });

    it('should handle arrays of arrays of primitives', function() {
      const input = [['foo', 'bar'], [1, 2], [true, false]];
      const expected = '[["foo","bar"],[1,2],[true,false]]';

      expect(stringify(input)).to.equal(expected);
    });

    it('should handle objects & sort keys', function() {
      const input = {foo: 'bar', eggs: 'ham'};
      const expected = '{"eggs":"ham","foo":"bar"}';

      expect(stringify(input)).to.equal(expected);
    });

    it('should handle nested objects', function() {
      const input = {foo: 'bar', baz: {eggs: 'ham'}};
      const expected = '{"baz":{"eggs":"ham"},"foo":"bar"}';

      expect(stringify(input)).to.equal(expected);
    });

    it('should not break on null and co', function() {
      const input = [0, null, undefined];
      const expected = '[0,null,]';

      expect(stringify(input)).to.equal(expected);
    });

    it('should handle buffers', function() {
      const input = new Buffer('123');
      const expected = '{"type":"Buffer","data":[49,50,51]}';

      expect(stringify(input)).to.equal(expected);
    });
  });

  describe('.hash()', function() {
    it('should make are string arguments lowercase', function() {
      const str_A = 'UPPERCASE';
      const str_B = 'uppercase';

      expect(hash(str_A)).to.equal(hash(str_B));
    });

    it('should be deterministic with objects', function() {
      const obj_A = {foo: 'bar', ham: 'eggs'};
      const obj_B = {ham: 'eggs', foo: 'bar'};

      expect(hash(obj_A)).to.equal(hash(obj_B));
    });

    it('should treat object keys case-insensitively', function() {
      const obj_A = {foo: 'bar', hAm: 'eggs'};
      const obj_B = {FOO: 'bar', HaM: 'eggs'};

      expect(hash(obj_A)).to.equal(hash(obj_B));
    });

    it('should work with buffers too', function() {
      expect(hash('foo', new Buffer('123')))
        .to.equal(hash('foo', new Buffer('123')));
    });
  });

});
