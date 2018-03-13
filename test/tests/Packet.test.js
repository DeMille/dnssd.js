const fs = require('fs');
const path = require('path');

const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const BufferWrapper  = require(dir + '/BufferWrapper');
const ResourceRecord = require(dir + '/ResourceRecord');
const QueryRecord    = require(dir + '/QueryRecord');
const hex            = require(dir + '/hex');

const filename = require('path').basename(__filename);
const debug = require(dir + '/debug')(`dnssd:${filename}`);


const Packet = rewire(dir + '/Packet');


describe('Packet', function() {
  const packetDir = path.resolve(__dirname, '../data/packets/');

  describe('#constructor', function() {
    it('should start with an empty packet', function() {
      expect((new Packet()).isEmpty()).to.be.true;
    });

    it('should create a packet from a given buffer', sinon.test(function() {
      this.stub(Packet.prototype, 'parseBuffer');
      const fakebuffer = {};
      const packet = new Packet(fakebuffer);

      expect(packet.parseBuffer).to.have.been.calledWith(fakebuffer);
    }));

    it('should make .isInvalid() false if parsing fails', sinon.test(function() {
      this.stub(Packet.prototype, 'parseBuffer').throws();
      this.stub(Packet.prototype, 'isValid').returns(true);
      const fakebuffer = {};
      const packet = new Packet(fakebuffer);

      expect(packet.isValid()).to.be.false;
    }));
  });


  describe('#parseHeader', function() {
    it('should parse out header fields', function() {
      const buf = new Buffer([0, 37, 0, 0, 0, 4, 0, 3, 0, 2, 0, 1]);
      const wrapper = new BufferWrapper(buf);

      const header = Packet.prototype.parseHeader(wrapper);

      expect(header.ID).to.equal(37);
      expect(header.QDCount).to.equal(4);
      expect(header.ANCount).to.equal(3);
      expect(header.NSCount).to.equal(2);
      expect(header.ARCount).to.equal(1);
    });
  });


  describe('#writeHeader', function() {
    it('should write the header correctly', function() {
      const packet = new Packet();

      packet.header.ID = 45;
      packet.header.QR = 1;
      packet.header.OPCODE = 5;
      packet.header.AA = 0;
      packet.header.TC = 1;
      packet.header.RD = 0;
      packet.header.RA = 0;
      packet.header.Z  = 0;
      packet.header.AD = 0;
      packet.header.CD = 0;
      packet.header.RCODE = 1;

      packet.header.QDCount = 1;
      packet.header.ANCount = 2;
      packet.header.NSCount = 3;
      packet.header.ARCount = 4;

      packet.questions   = [1];          // length = 1
      packet.answers     = [1, 2];       // length = 2
      packet.authorities = [1, 2, 3];    // length = 3
      packet.additionals = [1, 2, 3, 4]; // length = 4

      const wrapper = new BufferWrapper();
      packet.writeHeader(wrapper);

      wrapper.seek(0); // reset position
      const header = Packet.prototype.parseHeader(wrapper);

      expect(header).to.eql(packet.header);
    });
  });


  describe('#parseBuffer', function() {
    const isResourceRecord = record => record instanceof ResourceRecord;
    const isQueryRecord = record => record instanceof QueryRecord;

    function expectRightTypes(packet) {
      expect(packet.questions.every(isQueryRecord)).to.be.true;
      expect(packet.answers.every(isResourceRecord)).to.be.true;
      expect(packet.additionals.every(isResourceRecord)).to.be.true;
      expect(packet.authorities.every(isResourceRecord)).to.be.true;
    }

    function generateTestFn(file, runTests) {
      return function() {
        const data = fs.readFileSync(packetDir + '/' + file);
        const packet = new Packet(data);

        if (debug.v.isEnabled) debug.v('%s:\n%s', file, hex.view(data));
        debug('%s:\n%s', file, packet);

        expectRightTypes(packet);
        runTests(packet);
      };
    }

    function test(file, runTests) {
      return it(file, generateTestFn(file, runTests));
    }

    test.only = function(file, runTests) {
      return it.only(file, generateTestFn(file, runTests));
    };


    describe('should parse uncompressed packetDir', function() {

      test('service probe.uncompressed.bin', function(packet) {
        expect(packet.isProbe()).to.be.true;
        expect(packet.questions).to.have.lengthOf(1);
        expect(packet.authorities).to.have.lengthOf(1);
      });

      test('service announcement.uncompressed.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(4);
        expect(packet.additionals).to.have.lengthOf(4);
      });

      test('service goodbye.uncompressed.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(1);
      });

      test('service announcement with large TXT.uncompressed.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(4);
        expect(packet.additionals).to.have.lengthOf(4);
      });

      test('enumerate query.uncompressed.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(5);
      });

      test('query with known answer.uncompressed.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(1);
        expect(packet.answers).to.have.lengthOf(1);
      });

      test('oddly repeated questions.uncompressed.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(4);
        expect(packet.answers).to.have.lengthOf(1);
      });

      test('query with lots of known answers.uncompressed.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(1);
        expect(packet.answers).to.have.lengthOf(9);
      });

      test('multiple queries, known answer, opt.uncompressed.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(8);
        expect(packet.answers).to.have.lengthOf(1);
        expect(packet.additionals).to.have.lengthOf(1);
      });

      test('answer with HINFO.uncompressed.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(1);
        expect(packet.additionals).to.have.lengthOf(1);
      });

      test('multiple announce with OPT.uncompressed.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(8);
        expect(packet.additionals).to.have.lengthOf(5);
      });

      test('chromecast probe.uncompressed.bin', function(packet) {
        expect(packet.isProbe()).to.be.true;
        expect(packet.questions).to.have.lengthOf(2);
        expect(packet.authorities).to.have.lengthOf(3);
      });
    });


    describe('should parse compressed packetDir', function() {

      test('service probe.bin', function(packet) {
        expect(packet.isProbe()).to.be.true;
        expect(packet.questions).to.have.lengthOf(1);
        expect(packet.authorities).to.have.lengthOf(1);
      });

      test('service announcement.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(4);
        expect(packet.additionals).to.have.lengthOf(4);
      });

      test('service goodbye.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(1);
      });

      test('service announcement with large TXT.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(4);
        expect(packet.additionals).to.have.lengthOf(4);
      });

      test('enumerate query.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(5);
      });

      test('query with known answer.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(1);
        expect(packet.answers).to.have.lengthOf(1);
      });

      test('oddly repeated questions.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(4);
        expect(packet.answers).to.have.lengthOf(1);
      });

      test('query with lots of known answers.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(1);
        expect(packet.answers).to.have.lengthOf(9);
      });

      test('multiple queries, known answer, opt.bin', function(packet) {
        expect(packet.isQuery()).to.be.true;
        expect(packet.questions).to.have.lengthOf(8);
        expect(packet.answers).to.have.lengthOf(1);
        expect(packet.additionals).to.have.lengthOf(1);
      });

      test('answer with HINFO.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(1);
        expect(packet.additionals).to.have.lengthOf(1);
      });

      test('multiple announce with OPT.bin', function(packet) {
        expect(packet.isAnswer()).to.be.true;
        expect(packet.answers).to.have.lengthOf(8);
        expect(packet.additionals).to.have.lengthOf(5);
      });

      test('chromecast probe.bin', function(packet) {
        expect(packet.isProbe()).to.be.true;
        expect(packet.questions).to.have.lengthOf(2);
        expect(packet.authorities).to.have.lengthOf(3);
      });
    });
  });


  describe('#toBuffer', function() {
    describe('should write packet to buffer and do label compression', function() {
      const compressedFiles = fs.readdirSync(packetDir)
        .filter(name => name.indexOf('uncompressed') === -1);

      compressedFiles.forEach((file) => {
        it(file, function() {
          const input = fs.readFileSync(packetDir + '/' + file);
          const packet = new Packet(input);
          const output = packet.toBuffer();

          if (debug.v.isEnabled) {
            debug.v('%s:\n%s\n\nINPUT: \n%s\n\nOUTPUT: \n%s\n\nAre equal?: %s',
              file, packet,
              hex.view(input),
              hex.view(output),
              output.equals(input));
          }

          expect(output.equals(input)).to.be.true;
        });
      });

    });
  });


  describe('#split', function() {
    it('should split answers in half', function() {
      const C = new ResourceRecord.TXT({name: 'C'});
      const D = new ResourceRecord.TXT({name: 'D'});
      const A = new ResourceRecord.TXT({name: 'A', additionals: [C]});
      const B = new ResourceRecord.TXT({name: 'B', additionals: [D]});

      const answerPacket = new Packet();
      answerPacket.setAnswers([A, B]);
      answerPacket.setAdditionals([C, D]);
      answerPacket.setResponseBit();

      const [one, two] = answerPacket.split();

      expect(one.answers).to.eql([A]);
      expect(two.answers).to.eql([B]);
      expect(one.additionals).to.eql([C]);
      expect(two.additionals).to.eql([D]);
    });

    it('should split questions in half', function() {
      const A = new QueryRecord({name: 'C'});
      const B = new QueryRecord({name: 'D'});
      const C = new ResourceRecord.TXT({name: 'A'});
      const D = new ResourceRecord.TXT({name: 'B'});

      const queryPacket = new Packet();
      queryPacket.setQuestions([A, B]);
      queryPacket.setAnswers([C, D]);

      const [one, two] = queryPacket.split();

      expect(one.questions).to.eql([A, B]);
      expect(two.questions).to.eql([]);
      expect(one.answers).to.eql([C]);
      expect(two.answers).to.eql([D]);
    });

    it('should give up and return empty packets for anything else...', function() {
      const A = new QueryRecord({name: 'C'});
      const B = new QueryRecord({name: 'D'});

      const unknownPacket = new Packet();
      unknownPacket.setAnswers([A, B]);
      unknownPacket.setAuthorities([A, B]);

      const [one, two] = unknownPacket.split();

      expect(one.isEmpty()).to.be.true;
      expect(two.isEmpty()).to.be.true;
    });
  });


  describe('#equals', function() {
    const A = new QueryRecord({name: 'A'});
    const B = new QueryRecord({name: 'B'});
    const C = new ResourceRecord.TXT({name: 'C'});
    const D = new ResourceRecord.TXT({name: 'D'});

    const packet_1 = new Packet();
    packet_1.setQuestions([A, B]);

    const packet_2 = new Packet();
    packet_2.setAnswers([C, D]);

    const packet_3 = new Packet();
    packet_3.setAnswers([A, B]);
    packet_3.setAdditionals([C]);

    const packet_4 = new Packet(); // <-- same, but diff object
    packet_4.setAnswers([A, B]);
    packet_4.setAdditionals([C]);

    const packet_5 = new Packet();
    packet_5.setAnswers([A, A, B]); // <-- repeats
    packet_5.setAdditionals([C]);

    const packet_6 = new Packet(); // <-- empty

    it('return false if packets are not equal', function() {
      expect(packet_1.equals(packet_2)).to.be.false;
      expect(packet_2.equals(packet_1)).to.be.false;
      expect(packet_2.equals(packet_3)).to.be.false;
      expect(packet_4.equals(packet_5)).to.be.false;
    });

    it('return true if packets are equal', function() {
      expect(packet_1.equals(packet_1)).to.be.true;
      expect(packet_3.equals(packet_4)).to.be.true;
      expect(packet_6.equals(packet_6)).to.be.true;
    });
  });


  describe('#toString', function() {
    describe('should look pretty and not throw', function() {
      const files = fs.readdirSync(packetDir);

      files.forEach((file) => {
        it(file, function() {
          const input = fs.readFileSync(packetDir + '/' + file);
          const packet = new Packet(input);

          debug('\n%s', packet.toString()); // shouldn't throw
        });
      });
    });
  });

});
