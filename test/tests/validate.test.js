const _ = require('lodash');

const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const validate = require(dir + '/validate');


describe('validate', function() {

  describe('.protocol()', function() {
    it('should throw if input isn\'t a string', function() {
      expect(() => validate.protocol(4)).to.throw();
    });

    it('should throw if input isn\'t "_udp" or "_tcp"', function() {
      expect(() => validate.protocol('_wrong')).to.throw();
    });

    it('should *not* throw on "_udp" or "_tcp"', function() {
      expect(() => validate.protocol('_tcp')).to.not.throw();
      expect(() => validate.protocol('_udp')).to.not.throw();
    });
  });

  describe('.serviceName()', function() {
    it('should throw if input isn\'t a string', function() {
      expect(() => validate.serviceName(4)).to.throw();
    });

    it('should throw on empty string', function() {
      expect(() => validate.serviceName('')).to.throw();
    });

    it('should throw if input doesn\'t start with _', function() {
      expect(() => validate.serviceName('name')).to.throw();
    });

    it('should throw if input is >16 bytes', function() {
      expect(() => validate.serviceName('_0123456789abcdef')).to.throw();
    });

    it('should throw if input start or ends with ![A-Za-z0-9]', function() {
      expect(() => validate.serviceName('__Abc')).to.throw();
      expect(() => validate.serviceName('_Abc_')).to.throw();
    });

    it('should throw if input contains chars other than [A-Za-z0-9-]', function() {
      expect(() => validate.serviceName('_A+')).to.throw();
    });

    it('should throw if input contains consecutive hyphens', function() {
      expect(() => validate.serviceName('_A--Z')).to.throw();
    });

    it('should throw if input doesn\'t contains any letters', function() {
      expect(() => validate.serviceName('_000')).to.throw();
    });

    it('should *not* throw on valid input: "_service"', function() {
      expect(() => validate.serviceName('_service')).to.not.throw();
    });
  });

  describe('.label()', function() {
    it('should throw if isn\'t a string', function() {
      expect(() => validate.label(4)).to.throw();
    });

    it('should throw on empty string', function() {
      expect(() => validate.label('')).to.throw();
    });

    it('should throw if input contains a control character', function() {
      expect(() => validate.label('\x1F')).to.throw();
    });

    it('should throw if input is > 63 bytes', function() {
      const label = _.fill(new Array(64), 'A').join('');
      expect(() => validate.label(label)).to.throw();
    });

    it('should *not* throw on valid input: "A valid label 123"', function() {
      const label = 'A valid label 123';
      expect(() => validate.label(label)).to.not.throw();
    });
  });

  describe('.port()', function() {
    it('should throw if isn\'t an integer', function() {
      expect(() => validate.port('8080')).to.throw();
      expect(() => validate.port(8080.1)).to.throw();
    });

    it('should throw if > 0xFFFF or <= 0', function() {
      expect(() => validate.port(0xFFFF + 1)).to.throw();
      expect(() => validate.port(0)).to.throw();
      expect(() => validate.port(-1)).to.throw();
    });

    it('should *not* throw on valid input: 8080', function() {
      expect(() => validate.port(8080)).to.not.throw();
    });
  });

  describe('.txt()', function() {
    it('should throw if isn\'t a plain object', function() {
      expect(() => validate.txt('{}')).to.throw();
      expect(() => validate.txt(1234)).to.throw();
    });

    it('should throw if a key is > 9 bytes', function() {
      expect(() => validate.txt({'0123456789': ''})).to.throw();
    });


    it('should throw if a key contains a "="', function() {
      expect(() => validate.txt({'key=': ''})).to.throw();
    });

    it('should throw if a key contains non-printable ascii', function() {
      expect(() => validate.txt({'key_\x1F': ''})).to.throw();
    });

    it('should throw if input contains repeated keys (any case)', function() {
      expect(() => validate.txt({key: '', KEY: ''})).to.throw();
    });

    it('should throw if a value is not a string/num/buffer/boolean', function() {
      expect(() => validate.txt({key: {}})).to.throw();
    });

    it('should throw if a key/value pair is > 255 bytes', function() {
      expect(() => validate.txt({key: new Buffer(251)})).to.throw();
    });

    it('should throw if txt is > 1300 bytes', function() {
      const input = {
        key1: new Buffer(200),
        key2: new Buffer(200),
        key3: new Buffer(200),
        key4: new Buffer(200),
        key5: new Buffer(200),
        key6: new Buffer(200),
        key7: new Buffer(200),
      };

      expect(() => validate.txt(input)).to.throw();
    });

    it('should *not* throw on valid input:', function() {
      const input = {
        key: new Buffer(250),
        str: 'value 1',
        bool: true,
        num: 123,
      };

      expect(() => validate.txt(input)).to.not.throw();
    });
  });

});
