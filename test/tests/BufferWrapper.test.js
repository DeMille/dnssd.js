const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const BufferWrapper = rewire(dir + '/BufferWrapper');


describe('BufferWrapper', function() {

  describe('Buffer read/write aliases', function() {
    it('#readUInt8(): should return value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0x01]));

      expect(wrapper.readUInt8()).to.equal(0x01);
      expect(wrapper.tell()).to.equal(1);
    });

    it('#readUInt16BE(): should return value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0x01,0x02]));

      expect(wrapper.readUInt16BE()).to.equal(0x0102);
      expect(wrapper.tell()).to.equal(2);
    });

    it('#readUInt32BE(): should return value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0x01,0x02,0x03,0x04]));

      expect(wrapper.readUInt32BE()).to.equal(0x01020304);
      expect(wrapper.tell()).to.equal(4);
    });

    it('#readUIntBE(): should return value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0x01,0x02,0x03,0x04]));

      expect(wrapper.readUIntBE(4)).to.equal(0x01020304);
      expect(wrapper.tell()).to.equal(4);
    });

    it('#writeUInt8(): should write value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0]));
      wrapper.writeUInt8(0x04);

      expect(wrapper.buffer).to.eql(new Buffer([0x04]));
      expect(wrapper.tell()).to.equal(1);
    });

    it('#writeUInt16BE(): should write value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0,0]));
      wrapper.writeUInt16BE(0x0405);

      expect(wrapper.buffer).to.eql(new Buffer([0x04,0x05]));
      expect(wrapper.tell()).to.equal(2);
    });

    it('#writeUInt32BE(): should write value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0,0,0,0]));
      wrapper.writeUInt32BE(0x01020304);

      expect(wrapper.buffer).to.eql(new Buffer([0x01,0x02,0x03,0x04]));
      expect(wrapper.tell()).to.equal(4);
    });

    it('#writeUIntBE(): should write value and increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0,0,0,0]));
      wrapper.writeUIntBE(0x01020304, 4);

      expect(wrapper.buffer).to.eql(new Buffer([0x01,0x02,0x03,0x04]));
      expect(wrapper.tell()).to.equal(4);
    });
  });


  describe('Other read/writes', function() {
    it('#readString(): should read utf8 string, increment position', function() {
      const str = 'generic string';
      const wrapper = new BufferWrapper(new Buffer(str));

      expect(wrapper.readString(str.length)).to.equal(str);
      expect(wrapper.tell()).to.equal(str.length);
    });

    it('#writeString(): should write utf8 string, increment position', function() {
      const str = 'generic string';
      const wrapper = new BufferWrapper(new Buffer(str.length));
      wrapper.writeString(str);

      expect(wrapper.buffer).to.eql(new Buffer(str));
      expect(wrapper.tell()).to.equal(str.length);
    });

    it('#read(): should read n bytes, increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0x01,0x02,0x03,0x04]));

      expect(wrapper.read(4)).to.eql(new Buffer([0x01,0x02,0x03,0x04]));
      expect(wrapper.tell()).to.equal(4);
    });

    it('#add(): should add buffer, increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0,0,0,0]));
      wrapper.add(new Buffer([0x01,0x02,0x03,0x04]));

      expect(wrapper.buffer).to.eql(new Buffer([0x01,0x02,0x03,0x04]));
      expect(wrapper.tell()).to.equal(4);
    });

    it('#remaining(): should show number of bytes til end of buffer', function() {
      const wrapper = new BufferWrapper(new Buffer([0,0,0,0]));

      expect(wrapper.remaining()).to.equal(4);
    });

    it('#skip(): should skip n bytes, increment position', function() {
      const wrapper = new BufferWrapper(new Buffer([0,0,0,0]));
      wrapper.skip(2);

      expect(wrapper.tell()).to.equal(2);
    });

    it('#trim(): should trim/return internal buffer up to position', function() {
      const wrapper = new BufferWrapper(new Buffer([0x01,0x02,0x03,0x04]));
      wrapper.skip(2);

      expect(wrapper.unwrap()).to.eql(new Buffer([0x01,0x02]));
    });
  });


  describe('#_checkLength()', function() {
    const wrapper = new BufferWrapper(new Buffer([0,0,0,0]));
    sinon.stub(wrapper, '_grow');

    beforeEach(function() {
      wrapper._grow.reset();
    });

    it('should not grow if not needed', function() {
      wrapper._checkLength(4);
      expect(wrapper._grow).to.not.have.been.called;
    });

    it('should grow with a default of 512', function() {
      wrapper._checkLength(8);
      expect(wrapper._grow).to.have.been.calledWith(512);
    });

    it('should grow by 1.5 * needed if > 512', function() {
      wrapper._checkLength(604);
      expect(wrapper._grow).to.have.been.calledWith(900);
    });
  });


  describe('#_grow()', function() {
    it('should add n sized buffer to end', function() {
      const wrapper = new BufferWrapper(new Buffer(0));
      wrapper._grow(5);

      expect(wrapper.buffer.length).to.equal(5);
    });
  });


  describe('#indexOf()', function() {
    describe('should use Buffer.indexOf in newer versions of node', function() {
      it('should find index', function() {
        const wrapper = new BufferWrapper();
        wrapper.add(new Buffer([0,1,2,3,4]));

        expect(wrapper.indexOf(new Buffer([2,3]))).to.equal(2);
      });

      it('should return -1 if not found', function() {
        const wrapper = new BufferWrapper();
        wrapper.add(new Buffer([0,1,2,3,4]));

        expect(wrapper.indexOf(new Buffer([5,6]))).to.equal(-1);
      });
    });

    describe('should do naive search in older versions of node', function() {
      class OldBuffer extends Buffer {}
      OldBuffer.prototype.indexOf = null; // older versions don't have indexOf
      let revert;

      before(function() {
        revert = BufferWrapper.__set__('Buffer', OldBuffer);
      });

      after(function() {
        revert();
      });

      it('should find index', function() {
        const wrapper = new BufferWrapper();
        wrapper.add(new Buffer([0,1,2,3,4]));

        expect(wrapper.indexOf(new Buffer([2,3]))).to.equal(2);
      });

      it('should return -1 if not found', function() {
        const wrapper = new BufferWrapper();
        wrapper.add(new Buffer([0,1,2,3,4]));

        expect(wrapper.indexOf(new Buffer([5,6]))).to.equal(-1);
      });
    });
  });


  describe('#readFQDN()', function() {
    it('should read basic names without pointers', function() {
      const wrapper = new BufferWrapper();

      wrapper.writeUInt8(3); // 'www'.length
      wrapper.writeString('www');
      wrapper.writeUInt8(6); // 'google'.length
      wrapper.writeString('google');
      wrapper.writeUInt8(3); // 'com'.length
      wrapper.writeString('com');
      wrapper.writeUInt8(0); // terminating root label: .

      const finalPos = wrapper.tell();

      wrapper.seek(0);
      expect(wrapper.readFQDN()).to.equal('www.google.com.');
      expect(wrapper.tell()).to.equal(finalPos);
    });

    it('should follow pointers to read names', function() {
      const wrapper = new BufferWrapper();

      wrapper.writeUInt8(3);
      wrapper.writeString('www');
      wrapper.writeUInt8(6);
      wrapper.writeString('google');
      wrapper.writeUInt8(3);
      wrapper.writeString('com');
      wrapper.writeUInt8(0);

      const readPos = wrapper.tell();

      wrapper.writeUInt16BE(0xC000 + 0); // points to beginning

      const finalPos = wrapper.tell();

      wrapper.seek(readPos);
      expect(wrapper.readFQDN()).to.equal('www.google.com.');
      expect(wrapper.tell()).to.equal(finalPos);
    });

    it('should follow partial pointers to read names', function() {
      const wrapper = new BufferWrapper();

      wrapper.writeUInt8(6);
      wrapper.writeString('google');
      wrapper.writeUInt8(3);
      wrapper.writeString('com');
      wrapper.writeUInt8(0);

      const readPos = wrapper.tell();

      wrapper.writeUInt8(3);
      wrapper.writeString('www');
      wrapper.writeUInt16BE(0xC000 + 0); // points to beginning

      const finalPos = wrapper.tell();

      wrapper.seek(readPos);
      expect(wrapper.readFQDN()).to.equal('www.google.com.');
      expect(wrapper.tell()).to.equal(finalPos);
    });

    it('should follow multiple pointers to read names', function() {
      const wrapper = new BufferWrapper();

      wrapper.writeUInt8(3);
      wrapper.writeString('com');
      wrapper.writeUInt8(0);

      wrapper.writeUInt8(6);
      wrapper.writeString('google');
      wrapper.writeUInt16BE(0xC000 + 0); // points to beginning

      const readPos = wrapper.tell();

      wrapper.writeUInt8(3);
      wrapper.writeString('www');
      wrapper.writeUInt16BE(0xC000 + 5); // points to right before "google" length

      const finalPos = wrapper.tell();

      wrapper.seek(readPos);
      expect(wrapper.readFQDN()).to.equal('www.google.com.');
      expect(wrapper.tell()).to.equal(finalPos);
    });
  });


  describe('#writeFQDN()', function() {
    it('should do basic name writes w/o compression pointers', function() {
      const wrapper = new BufferWrapper();
      wrapper.writeFQDN('www.google.com.');

      const expected = new BufferWrapper();
      expected.writeUInt8(3);
      expected.writeString('www');
      expected.writeUInt8(6);
      expected.writeString('google');
      expected.writeUInt8(3);
      expected.writeString('com');
      expected.writeUInt8(0);

      expect(wrapper.unwrap().equals(expected.unwrap())).to.be.true;
    });

    it('should do whole compression pointers', function() {
      const wrapper = new BufferWrapper();
      wrapper.writeUInt8(3);
      wrapper.writeString('www');
      wrapper.writeUInt8(6);
      wrapper.writeString('google');
      wrapper.writeUInt8(3);
      wrapper.writeString('com');
      wrapper.writeUInt8(0);

      const expected = new BufferWrapper();
      expected.writeUInt8(3);
      expected.writeString('www');
      expected.writeUInt8(6);
      expected.writeString('google');
      expected.writeUInt8(3);
      expected.writeString('com');
      expected.writeUInt8(0);
      expected.writeUInt16BE(0xC000 + 0); // points to beginning

      wrapper.writeFQDN('www.google.com.');
      expect(wrapper.unwrap().equals(expected.unwrap())).to.be.true;
    });

    it('should do partial compression pointers', function() {
      const wrapper = new BufferWrapper();
      wrapper.writeUInt8(6);
      wrapper.writeString('google');
      wrapper.writeUInt8(3);
      wrapper.writeString('com');
      wrapper.writeUInt8(0);
      wrapper.writeUInt8(3);
      wrapper.writeString('www');
      wrapper.writeUInt16BE(0xC000 + 0); // points to beginning

      const expected = new BufferWrapper();
      expected.writeUInt8(6);
      expected.writeString('google');
      expected.writeUInt8(3);
      expected.writeString('com');
      expected.writeUInt8(0);
      expected.writeUInt8(3);
      expected.writeString('www');
      expected.writeUInt16BE(0xC000 + 0);
      expected.writeUInt16BE(0xC000 + 12); // points to right beore "www" length

      wrapper.writeFQDN('www.google.com.');
      expect(wrapper.unwrap().equals(expected.unwrap())).to.be.true;
    });

    it('should not try to compress pointers themselves again', function() {
      const wrapper = new BufferWrapper();

      // this could be another pointer, or other not needed data. it should be
      // ignored and the later pointer, "0xC000 + 2", should not be replaced with
      // "0xC000 + 0" just becuase it found "0xC000 + 2" here.
      wrapper.writeUInt16BE(0xC000 + 2);

      wrapper.writeUInt8(3);
      wrapper.writeString('com');
      wrapper.writeUInt8(0);
      wrapper.writeUInt8(6);
      wrapper.writeString('google');
      wrapper.writeUInt16BE(0xC000 + 2); // points to beginning
      wrapper.writeUInt8(3);
      wrapper.writeString('www');
      wrapper.writeUInt16BE(0xC000 + 7); // points to right before "google" length

      const expected = new BufferWrapper();
      expected.writeUInt16BE(0xC000 + 2);
      expected.writeUInt8(3);
      expected.writeString('com');
      expected.writeUInt8(0);
      expected.writeUInt8(6);
      expected.writeString('google');
      expected.writeUInt16BE(0xC000 + 2);
      expected.writeUInt8(3);
      expected.writeString('www');
      expected.writeUInt16BE(0xC000 + 7);
      expected.writeUInt16BE(0xC000 + 16); // points to right beore "www" length

      wrapper.writeFQDN('www.google.com.');
      expect(wrapper.unwrap().equals(expected.unwrap())).to.be.true;
    });
  });

});
