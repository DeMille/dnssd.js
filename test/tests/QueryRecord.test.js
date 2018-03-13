const fs = require('fs');
const path = require('path');

const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const BufferWrapper = require(dir + '/BufferWrapper');
const hex           = require(dir + '/hex');
const RType         = require(dir + '/constants').RType;
const RClass        = require(dir + '/constants').RClass;

const filename = require('path').basename(__filename);
const debug = require(dir + '/debug')(`dnssd:${filename}`);


const QueryRecord = require(dir + '/QueryRecord');


describe('QueryRecord', function() {
  const queriesDir = path.resolve(__dirname, '../data/queries/');

  function getFile(file) {
    const buffer = fs.readFileSync(queriesDir + '/' + file);
    return new BufferWrapper(buffer);
  }


  describe('#constructor', function() {
    it('should create a new QM question from fields/defaults', function() {
      const query = new QueryRecord({name: 'Want'});

      expect(query).to.include({
        name  : 'Want',
        qtype : RType.ANY,
        qclass: RClass.IN,
        QU    : false,
      });
    });

    it('should create a new QU question from fields/defaults', function() {
      const query = new QueryRecord({name: 'Want', QU: true, qtype: RType.TXT});

      expect(query).to.include({
        name  : 'Want',
        qtype : RType.TXT,
        qclass: RClass.IN,
        QU    : true,
      });
    });
  });

  describe('::fromBuffer', function() {
    it('QueryRecord-QM.bin', function() {
      const wrapper = getFile('QueryRecord-QM.bin');
      const query = QueryRecord.fromBuffer(wrapper);

      expect(query).to.include({
        name  : 'hostname.local.',
        qtype : RType.A,
        qclass: RClass.IN,
        QU    : false,
      });
    });

    it('QueryRecord-QU.bin', function() {
      const wrapper = getFile('QueryRecord-QU.bin');
      const query = QueryRecord.fromBuffer(wrapper);

      expect(query).to.include({
        name  : 'test._service._tcp.local.',
        qtype : RType.ANY,
        qclass: RClass.IN,
        QU    : true,
      });
    });
  });


  describe('#writeTo', function() {
    const files = fs.readdirSync(queriesDir);

    files.forEach((file) => {
      it(file, function() {
        const input = getFile(file);
        const output = new BufferWrapper();

        const query = QueryRecord.fromBuffer(input);
        query.writeTo(output);

        if (debug.v.isEnabled) {
          debug.v('%s:\n%s\n\nINPUT: \n%s\n\nOUTPUT: \n%s\n\nAre equal?: %s',
            file, query,
            hex.view(input.unwrap()),
            hex.view(output.unwrap()),
            output.unwrap().equals(input.unwrap()));
        }

        expect( output.unwrap().equals(input.unwrap()) ).to.be.true;
      });
    });
  });


  describe('#toString', function() {
    describe('should look nice and not throw', function() {
      const files = fs.readdirSync(queriesDir);

      files.forEach((file) => {
        it(file, function() {
          const input = getFile(file);
          const query = QueryRecord.fromBuffer(input);

          debug(query.toString()); // dont throw
        });
      });
    });
  });

});
