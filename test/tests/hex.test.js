const chalk = require('chalk');

const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const hex = require(dir + '/hex');


describe('hex', function() {
  describe('.view()', function() {
    it('should not throw on random data', function() {
      expect(hex.view.bind(null, new Buffer(1000))).to.not.throw();
    });

    it('should print ascii characters', function() {
      const input = new Buffer('Printable: [ -~]');
      const output = chalk.stripColor(hex.view(input));
      const expected = '50 72 69 6e 74 61 62 6c 65 3a 20 5b 20 2d 7e 5d  Printable: [ -~]';

      expect(output).to.equal(expected);
    });

    it('should print dots for other stuff', function() {
      const input = new Buffer('Dots: \x01\x02\x03\x04\x05\x06\x07\x08\x09\x10');
      const output = chalk.stripColor(hex.view(input));
      const expected = '44 6f 74 73 3a 20 01 02 03 04 05 06 07 08 09 10  Dots: ..........';

      expect(output).to.equal(expected);
    });

    it('should print in columns, even for lines <16 characters', function() {
      const input = new Buffer('Columns!');
      const output = chalk.stripColor(hex.view(input));
      const expected = '43 6f 6c 75 6d 6e 73 21                          Columns!';

      expect(output).to.equal(expected);
    });
  });

});
