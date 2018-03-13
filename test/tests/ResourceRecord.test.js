const fs = require('fs');
const path = require('path');

const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const BufferWrapper = require(dir + '/BufferWrapper');
const QueryRecord   = require(dir + '/QueryRecord');
const hex           = require(dir + '/hex');
const RType         = require(dir + '/constants').RType;
const RClass        = require(dir + '/constants').RClass;

const filename = require('path').basename(__filename);
const debug = require(dir + '/debug')('dnssd:' + filename);


const ResourceRecord = require(dir + '/ResourceRecord');


describe('ResourceRecord', function() {
  const packetDir = path.resolve(__dirname, '../data/records/');

  function getFile(file) {
    const buffer = fs.readFileSync(packetDir + '/' + file);
    return new BufferWrapper(buffer);
  }


  describe('#constructor', function() {
    it('should throw an error, use ::fromBuffer instead', function() {
      expect(() => new ResourceRecord()).to.throw(Error);
    });
  });


  describe('ResourceRecord.A', function() {
    describe('#constructor', function() {
      it('should make new record from given fields & defaults', function() {
        const record = new ResourceRecord.A({
          name: 'test.local.',
          address: '1.1.1.1',
          additionals: ['fake record'],
        });

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.A);

        expect(record).to.include({
          rrtype     : RType.A,
          rrclass    : RClass.IN,
          name       : 'test.local.',
          ttl        : 120,
          isUnique   : true,
          address    : '1.1.1.1',
        });

        expect(record.additionals).to.have.members(['fake record']);
      });

      it('should throw if record not given a name', function() {
        expect(() => new ResourceRecord.A()).to.throw(Error);
        expect(() => new ResourceRecord.A({})).to.throw(Error);
        expect(() => new ResourceRecord.A({name: ''})).to.throw(Error);
      });
    });

    describe('::fromBuffer', function() {
      it('A.bin', function() {
        const wrapper = getFile('A.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.A);

        expect(record).to.include({
          rrtype  : RType.A,
          rrclass : RClass.IN,
          name    : 'box.local.',
          ttl     : 120,
          isUnique: true,
          address : '169.254.22.58',
        });
      });
    });
  });


  describe('ResourceRecord.PTR', function() {
    describe('#constructor', function() {
      it('should make new record from given fields & defaults', function() {
        const record = new ResourceRecord.PTR({
          name: '_service._tcp.local.',
          PTRDName: 'test._service._tcp.local.',
        });

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.PTR);

        expect(record).to.include({
          rrtype  : RType.PTR,
          rrclass : RClass.IN,
          name    : '_service._tcp.local.',
          ttl     : 4500,
          isUnique: false,
          PTRDName: 'test._service._tcp.local.',
        });
      });
    });

    describe('::fromBuffer', function() {
      it('PTR-service.bin', function() {
        const wrapper = getFile('PTR-service.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.PTR);

        expect(record).to.include({
          rrtype  : RType.PTR,
          rrclass : RClass.IN,
          name    : '_service._tcp.local.',
          ttl     : 4500,
          isUnique: false,
          PTRDName: 'test._service._tcp.local.',
        });
      });

      it('PTR-enumerator.bin', function() {
        const wrapper = getFile('PTR-enumerator.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.PTR);

        expect(record).to.include({
          rrtype  : RType.PTR,
          rrclass : RClass.IN,
          name    : '_services._dns-sd._udp.local.',
          ttl     : 4500,
          isUnique: false,
          PTRDName: '_service._tcp.local.',
        });
      });

      it('PTR-goodbye.bin', function() {
        const wrapper = getFile('PTR-goodbye.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.PTR);

        expect(record).to.include({
          rrtype  : RType.PTR,
          rrclass : RClass.IN,
          name    : '_service._tcp.local.',
          ttl     : 0,
          isUnique: false,
          PTRDName: 'test._service._tcp.local.',
        });
      });
    });
  });


  describe('ResourceRecord.TXT', function() {
    describe('#constructor', function() {
      it('should make new record from given fields & defaults', function() {
        const record = new ResourceRecord.TXT({
          name: 'test._service._tcp.local.',
          txt:  {key: new Buffer('value')},
        });

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.TXT);

        expect(record).to.include({
          rrtype  : RType.TXT,
          rrclass : RClass.IN,
          name    : 'test._service._tcp.local.',
          ttl     : 4500,
          isUnique: true,
        });

        expect(record.txt).to.eql({key: 'value'});
        expect(record.txtRaw).to.eql({key: new Buffer('value')});
      });
    });

    describe('::fromBuffer', function() {
      it('TXT-empty.bin', function() {
        const wrapper = getFile('TXT-empty.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.TXT);

        expect(record).to.include({
          rrtype  : RType.TXT,
          rrclass : RClass.IN,
          name    : 'test._service._tcp.local.',
          ttl     : 4500,
          isUnique: true,
        });

        expect(record.txt).to.be.empty;
        expect(record.txtRaw).to.be.empty;
      });

      it('TXT-false.bin', function() {
        const wrapper = getFile('TXT-false.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.TXT);

        expect(record).to.include({
          rrtype  : RType.TXT,
          rrclass : RClass.IN,
          name    : 'BOX@TuneBlade._http._tcp.local.',
          ttl     : 4500,
          isUnique: true,
        });

        expect(record.txt).to.eql({Password: 'False'}); // <- a string!
        expect(record.txtRaw).to.eql({Password: new Buffer('False')});
      });

      it('TXT-large.bin', function() {
        const wrapper = getFile('TXT-large.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.TXT);

        expect(record).to.include({
          rrtype  : RType.TXT,
          rrclass : RClass.IN,
          name    : 'Test._testlargetxt._tcp.local.',
          ttl     : 4500,
          isUnique: true,
        });

        const expected = {GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG: true};

        expect(record.txt).to.include(expected);
        expect(record.txtRaw).to.include(expected);
      });
    });

    describe('#_readRData', function() {
      function makeTXT(data) {
        const wrapper = new BufferWrapper();
        wrapper.writeFQDN('Test.');
        wrapper.writeUInt16BE(RType.TXT);
        wrapper.writeUInt16BE(RClass.IN);
        wrapper.writeUInt32BE(4500);

        const rdataStartPos = wrapper.tell();
        wrapper.skip(2); // <- rdata length goes here

        wrapper.writeUInt8(data.length);
        wrapper.writeString(data);

        const endRData = wrapper.tell();

        wrapper.seek(rdataStartPos);
        wrapper.writeUInt16BE(endRData - rdataStartPos - 2); // <- rdata length
        wrapper.seek(0); // <- reset position

        return wrapper;
      }

      it('key=value -> {key: value}', function() {
        const wrapper = makeTXT('key=value');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record.txt).to.eql({key: 'value'});
        expect(record.txtRaw).to.eql({key: new Buffer('value')});
      });

      it('key= -> {key: null}', function() {
        const wrapper = makeTXT('key=');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record.txt).to.eql({key: null});
        expect(record.txtRaw).to.eql({key: null});
      });

      it('key -> {key: true}', function() {
        const wrapper = makeTXT('key');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record.txt).to.eql({key: true});
        expect(record.txtRaw).to.eql({key: true});
      });
    });
  });


  describe('ResourceRecord.AAAA', function() {
    describe('#constructor', function() {
      it('should make new record from given fields & defaults', function() {
        const record = new ResourceRecord.AAAA({
          name   : 'test.local.',
          address: '::1',
          ttl    : 333,
        });

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.AAAA);

        expect(record).to.include({
          rrtype  : RType.AAAA,
          rrclass : RClass.IN,
          name    : 'test.local.',
          ttl     : 333,
          isUnique: true,
          address: '::1',
        });
      });
    });

    describe('::fromBuffer', function() {
      it('AAAA.bin', function() {
        const wrapper = getFile('AAAA.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.AAAA);

        expect(record).to.include({
          rrtype  : RType.AAAA,
          rrclass : RClass.IN,
          name    : 'box.local.',
          ttl     : 120,
          isUnique: true,
          address : 'fe80::c5b:7534:952d:163a',
        });
      });
    });
  });


  describe('ResourceRecord.SRV', function() {
    describe('#constructor', function() {
      it('should make new record from given fields & defaults', function() {
        const record = new ResourceRecord.SRV({
          name  : 'test._service._tcp.local.',
          target: 'box.local.',
          port  : 9000,
        });

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.SRV);

        expect(record).to.include({
          rrtype  : RType.SRV,
          rrclass : RClass.IN,
          name    : 'test._service._tcp.local.',
          ttl     : 120,
          isUnique: true,
          target  : 'box.local.',
          port    : 9000,
        });
      });
    });

    describe('::fromBuffer', function() {
      it('SRV.bin', function() {
        const wrapper = getFile('SRV.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.SRV);

        expect(record).to.include({
          rrtype  : RType.SRV,
          rrclass : RClass.IN,
          name    : 'test._service._tcp.local.',
          ttl     : 120,
          isUnique: true,
          target  : 'box.local.',
          port    : 9090,
          priority: 0,
          weight  : 0,
        });
      });
    });
  });


  describe('ResourceRecord.NSEC', function() {
    describe('#constructor', function() {
      it('should make new record from given fields & defaults', function() {
        const record = new ResourceRecord.NSEC({
          name    : 'test._service._tcp.local.',
          existing: [RType.SRV, RType.TXT],
        });

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.NSEC);

        expect(record).to.include({
          rrtype  : RType.NSEC,
          rrclass : RClass.IN,
          name    : 'test._service._tcp.local.',
          ttl     : 120,
          isUnique: true,
        });

        expect(record.existing).to.have.members([RType.TXT, RType.SRV]);
      });
    });

    describe('::fromBuffer', function() {
      it('NSEC-addresses.bin', function() {
        const wrapper = getFile('NSEC-addresses.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.NSEC);

        expect(record).to.include({
          rrtype  : RType.NSEC,
          rrclass : RClass.IN,
          name    : 'box.local.',
          ttl     : 120,
          isUnique: true,
        });

        expect(record.existing).to.have.members([RType.A, RType.AAAA]);
      });

      it('NSEC-service.bin', function() {
        const wrapper = getFile('NSEC-service.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.NSEC);

        expect(record).to.include({
          rrtype  : RType.NSEC,
          rrclass : RClass.IN,
          name    : 'test._service._tcp.local.',
          ttl     : 4500,
          isUnique: true,
        });

        expect(record.existing).to.have.members([RType.TXT, RType.SRV]);
      });
    });

    describe('#_readRData', function() {
      it('should only parse restricted form and ignore blocks > 255', function() {
        const wrapper = new BufferWrapper();
        wrapper.writeFQDN('Test.');
        wrapper.writeUInt16BE(RType.NSEC);
        wrapper.writeUInt16BE(RClass.IN);
        wrapper.writeUInt32BE(4500);

        const rdataStartPos = wrapper.tell();
        wrapper.skip(2); // <- rdata length goes here

        wrapper.writeFQDN('Test.');
        wrapper.writeUInt8(1);      // block 1
        wrapper.writeUInt8(1);      // bitfield length (1 octet)
        wrapper.writeUInt8(1 << 6); // RType.A (01000000)

        const finalPos = wrapper.tell();

        wrapper.seek(rdataStartPos);
        wrapper.writeUInt16BE(finalPos - rdataStartPos - 2); // <- rdata length
        wrapper.seek(0); // <- reset position

        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record.existing).to.be.empty;
        expect(wrapper.tell()).to.equal(finalPos);
      });

      it('should ignore bad records with bitfield length > 32', function() {
        const wrapper = new BufferWrapper();
        wrapper.writeFQDN('Test.');
        wrapper.writeUInt16BE(RType.NSEC);
        wrapper.writeUInt16BE(RClass.IN);
        wrapper.writeUInt32BE(4500);

        const rdataStartPos = wrapper.tell();
        wrapper.skip(2); // <- rdata length goes here

        wrapper.writeFQDN('Test.');
        wrapper.writeUInt8(0);      // block 0
        wrapper.writeUInt8(44);     // bitfield length (44 octets)
        wrapper.writeUInt8(1 << 6); // RType.A (01000000)

        const finalPos = wrapper.tell();

        wrapper.seek(rdataStartPos);
        wrapper.writeUInt16BE(finalPos - rdataStartPos - 2); // <- rdata length
        wrapper.seek(0); // <- reset position

        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record.existing).to.be.empty;
        expect(wrapper.tell()).to.equal(finalPos);
      });
    });

    describe('#_writeRData', function() {
      it('should not throw if `existing` is empty', function() {
        const wrapper = new BufferWrapper();
        const record = new ResourceRecord.NSEC({name: 'Empty'});

        expect(() => record._writeRData(wrapper)).to.not.throw(Error);
      });
    });
  });


  describe('ResourceRecord.Unknown', function() {
    describe('#constructor', function() {
      it('should make new record from given fields & defaults', function() {
        const rdata = new Buffer('rdata');
        const record = new ResourceRecord.Unknown({
          name  : 'test._service._tcp.local.',
          rrtype: 127,
          rdata : rdata,
        });

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.Unknown);

        expect(record).to.include({
          rrtype  : 127,
          rrclass : RClass.IN,
          name    : 'test._service._tcp.local.',
          ttl     : 120,
          isUnique: true,
          rdata   : rdata,
        });
      });
    });

    describe('::fromBuffer', function() {
      it('HINFO-unknown.bin', function() {
        const wrapper = getFile('HINFO-unknown.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.Unknown);

        expect(record).to.include({
          rrtype  : 13,
          rrclass : RClass.IN,
          name    : 'Test._testupdate._tcp.local.',
          ttl     : 4500,
          isUnique: true,
        });

        expect(record.RData).to.be.a.buffer;
      });

      it('OPT-unknown.bin', function() {
        const wrapper = getFile('OPT-unknown.bin');
        const record = ResourceRecord.fromBuffer(wrapper);

        expect(record).to.be.instanceof(ResourceRecord);
        expect(record).to.be.instanceof(ResourceRecord.Unknown);

        expect(record).to.include({
          rrtype: 41,
          name  : '.',
          ttl   : 4500,
        });

        expect(record.RData).to.be.a.buffer;
      });
    });
  });


  describe('#writeTo', function() {
    const files = fs.readdirSync(packetDir);

    files.forEach((file) => {
      it(file, function() {
        const input = getFile(file);
        const output = new BufferWrapper();

        const record = ResourceRecord.fromBuffer(input);
        record.writeTo(output);

        if (debug.v.isEnabled) {
          debug.v('%s:\n%s\n\nINPUT: \n%s\n\nOUTPUT: \n%s\n\nAre equal?: %s',
            file, record,
            hex.view(input.unwrap()),
            hex.view(output.unwrap()),
            output.unwrap().equals(input.unwrap()));
        }

        expect( output.unwrap().equals(input.unwrap()) ).to.be.true;
      });
    });
  });


  describe('#conflictsWith', function() {
    const SRV_1 = new ResourceRecord.SRV({name: 'Same', target: 'Something'});
    const SRV_2 = new ResourceRecord.SRV({name: 'Same', target: 'Else'});
    const PTR_1 = new ResourceRecord.PTR({name: 'Same'});
    const PTR_2 = new ResourceRecord.PTR({name: 'Different'});

    it('should be true if there is a conflict', function() {
      expect(SRV_1.conflictsWith(SRV_2)).to.be.true;  // different rdata
    });

    it('should be false if no conflict', function() {
      expect(SRV_1.conflictsWith(SRV_1)).to.be.false; // same rdata
      expect(SRV_1.conflictsWith(PTR_1)).to.be.false; // different rrtype
      expect(SRV_1.conflictsWith(PTR_2)).to.be.false; // different name
      expect(PTR_1.conflictsWith(PTR_2)).to.be.false; // not unique
    });
  });


  describe('#canAnswer', function() {
    const specific = new QueryRecord({name: 'NAME', qtype: RType.SRV});
    const anyRType = new QueryRecord({name: 'name', qtype: RType.ANY});
    const anyClass = new QueryRecord({name: 'name', qclass: RClass.ANY});
    const noMatch  = new QueryRecord({name: 'Test', qtype: RType.ANY});

    const SRV = new ResourceRecord.SRV({name: 'Name'}); // <-- case insensitive
    const PTR = new ResourceRecord.PTR({name: 'Name'});
    const TXT = new ResourceRecord.TXT({name: 'Name', rrclass: 123});

    it('should be true if record can answer the query record', function() {
      expect(SRV.canAnswer(specific)).to.be.true;
      expect(SRV.canAnswer(anyRType)).to.be.true;
      expect(PTR.canAnswer(anyRType)).to.be.true;
      expect(TXT.canAnswer(anyClass)).to.be.true;
    });

    it('should be false record can\'t answer question', function() {
      expect(PTR.canAnswer(specific)).to.be.false;
      expect(TXT.canAnswer(anyRType)).to.be.false;
      expect(PTR.canAnswer(noMatch)).to.be.false;
      expect(PTR.canAnswer(noMatch)).to.be.false;
      expect(SRV.canAnswer(noMatch)).to.be.false;
    });
  });


  describe('#equals', function() {
    const SRV_1 = new ResourceRecord.SRV({name: 'Same', port: 9000});
    const SRV_2 = new ResourceRecord.SRV({name: 'Same', port: 9000});

    const TXT_1 = new ResourceRecord.TXT({name: 'Same', txt: {key: true}});
    const TXT_2 = new ResourceRecord.TXT({name: 'Same', txt: {key: true}});

    it('should be true if record can answer the query record', function() {
      expect(SRV_1.equals(SRV_2)).to.be.true;
      expect(TXT_1.equals(TXT_2)).to.be.true;
    });

    it('should be false record can\'t answer question', function() {
      expect(SRV_1.equals(TXT_1)).to.be.false;
      expect(SRV_2.equals(TXT_2)).to.be.false;
    });
  });


  describe('#compare', function() {
    // different rrclasses
    const rrclass_1 = new ResourceRecord.A({name: 'A', rrclass: 1});
    const rrclass_2 = new ResourceRecord.A({name: 'A', rrclass: 2});

    // different rrtypes
    const A    = new ResourceRecord.A({name: 'A'});
    const AAAA = new ResourceRecord.AAAA({name: 'AAAA'});

    // different rdata
    const TXT_1 = new ResourceRecord.TXT({name: 'TXT', txt: {key: '1'}});
    const TXT_2 = new ResourceRecord.TXT({name: 'TXT', txt: {key: '2'}});

    it('should first compare records base on rrclass', function() {
      expect(rrclass_1.compare(rrclass_2)).to.equal(-1);
      expect(rrclass_2.compare(rrclass_1)).to.equal(1);
    });

    it('should then compare based on rrtypes', function() {
      expect(A.compare(AAAA)).to.equal(-1);
      expect(AAAA.compare(A)).to.equal(1);
    });

    it('should then compared on rdata buffers', function() {
      expect(TXT_1.compare(TXT_2)).to.equal(-1);
      expect(TXT_2.compare(TXT_1)).to.equal(1);

      expect(TXT_2.compare(TXT_2)).to.equal(0);
      expect(TXT_1.compare(TXT_1)).to.equal(0);
    });
  });


  describe('#matches', function() {
    const SRV_1 = new ResourceRecord.SRV({name: 'SRV Record', target: 'box.local.'});
    const SRV_2 = new ResourceRecord.SRV({name: 'SRV Record', target: 'test.local.'});

    it('should return true/false if record matches all properties', function() {
      const properties_1 = {name: 'SRV Record', target: 'box.local.'};
      const properties_2 = {name: 'SRV Record', target: 'test.local.'};

      expect(SRV_1.matches(properties_1)).to.be.true;
      expect(SRV_1.matches(properties_2)).to.be.false;

      expect(SRV_2.matches(properties_1)).to.be.false;
      expect(SRV_2.matches(properties_2)).to.be.true;
    });

    it('should match strings case insensitive', function() {
      const properties = {name: 'srv RECORD', rrtype: RType.SRV};

      expect(SRV_1.matches(properties)).to.be.true;
      expect(SRV_2.matches(properties)).to.be.true;
    });
  });


  describe('#clone', function() {
    const SRV = new ResourceRecord.SRV({name: 'SRV Record', target: 'box.local.'});

    const unknown = new ResourceRecord.Unknown({
      name: 'Unknown.type.',
      rrtype: 127,
      rdata: new Buffer('rdata'),
    });

    it('should return a clone', function() {
      const clone = SRV.clone();

      expect(clone.equals(SRV)).to.be.true; // same data
      expect(clone).to.not.equal(SRV);      // different object
    });

    it('should work for unknown types too', function() {
      const clone = unknown.clone();

      expect(clone.equals(unknown)).to.be.true; // same data
      expect(clone).to.not.equal(unknown);      // different object
    });
  });


  describe('#updateWith', function() {
    const SRV = new ResourceRecord.SRV({name: 'SRV Record', target: 'box.local.'});
    const clone = SRV.clone();

    it('should update record and rehash', function() {
      SRV.updateWith(function(record) {
        record.target = 'new.local.';
      });

      expect(SRV.target).to.equal('new.local.');
      expect(SRV.equals(clone)).to.be.false;
    });
  });


  describe('#canGoodbye', function() {
    const PTR = new ResourceRecord.PTR({name: 'PTR'});
    const reserved = new ResourceRecord.PTR({name: 'db._dns-sd._udp.example.com.'});

    it('should return false for reserved record names', function() {
      expect(PTR.canGoodbye()).to.be.true;
      expect(reserved.canGoodbye()).to.be.false;
    });
  });


  describe('#toString', function() {
    describe('should look nice and not throw', function() {
      const files = fs.readdirSync(packetDir);

      files.forEach((file) => {
        it(file, function() {
          const input = getFile(file);
          const record = ResourceRecord.fromBuffer(input);

          debug(record.toString()); // dont throw
        });
      });
    });
  });

});
