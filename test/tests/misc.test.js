const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const misc = rewire(dir + '/misc');


describe('misc', function() {

  describe('.fqdn()', function() {
    it('should build a fully qualified domain from labels', function() {
      const expected = 'Label #1.number2.last.';

      expect(misc.fqdn('Label #1', 'number2', 'last')).to.equal(expected);
      expect(misc.fqdn('Label #1', 'number2', 'last.')).to.equal(expected);
    });
  });


  describe('.parse()', function() {
    it('should do: Instance . _service . _protocol . domain .', function() {
      const input_1    = 'Instance._http._tcp.local.';
      const expected_1 = {
        instance: 'Instance',
        service : '_http',
        protocol: '_tcp',
        domain  : 'local',
      };

      const input_2    = 'Weird Name.With_!@#$._sleep-proxy._udp.example.com.';
      const expected_2 = {
        instance: 'Weird Name.With_!@#$',
        service : '_sleep-proxy',
        protocol: '_udp',
        domain  : 'example.com',
      };

      expect(misc.parse(input_1)).to.eql(expected_1);
      expect(misc.parse(input_2)).to.eql(expected_2);
    });

    it('should do: Type . _sub . _service . _protocol . domain .', function() {
      const input_1    = 'MySubtype._sub._http._tcp.local.';
      const expected_1 = {
        subtype : 'MySubtype',
        service : '_http',
        protocol: '_tcp',
        domain  : 'local',
      };

      const input_2    = 'Weird Sub.With_!@#$._sub._sleep-proxy._udp.example.com.';
      const expected_2 = {
        subtype : 'Weird Sub.With_!@#$',
        service : '_sleep-proxy',
        protocol: '_udp',
        domain  : 'example.com',
      };

      expect(misc.parse(input_1)).to.eql(expected_1);
      expect(misc.parse(input_2)).to.eql(expected_2);
    });

    it('should do: _service . _protocol . domain .', function() {
      const input_1    = '_http._tcp.local.';
      const expected_1 = {
        instance: '',
        service : '_http',
        protocol: '_tcp',
        domain  : 'local',
      };

      const input_2    = '_sleep-proxy._udp.example.com.';
      const expected_2 = {
        instance: '',
        service : '_sleep-proxy',
        protocol: '_udp',
        domain  : 'example.com',
      };

      expect(misc.parse(input_1)).to.eql(expected_1);
      expect(misc.parse(input_2)).to.eql(expected_2);
    });

    it('should do: Single_Label_Host . local .', function() {
      const input_1    = 'Host.local.';
      const expected_1 = {instance: 'Host', domain: 'local'};

      const input_2    = 'Faux.sub.domains.host.local.';
      const expected_2 = {instance: 'Faux.sub.domains.host', domain: 'local'};

      expect(misc.parse(input_1)).to.eql(expected_1);
      expect(misc.parse(input_2)).to.eql(expected_2);
    });

    it('should return null if parse doesn\'t work', function() {
      const input = 'Sub.domain.at.example.com.';

      expect(misc.parse(input)).to.be.empty;
    });
  });


  describe('visualPad()', function() {
    // 12 chars + 5 escape chars
    const input = '\x1B[35m_tis_magenta';
    const visualPad = misc.__get__('visualPad');

    it('should pad strings over len', function() {
      // visually padded to 20 (+5 escape chars)
      expect(visualPad(input, 20).length).to.equal(25);
    });

    it('should pad strings under (len + esc sequence len)', function() {
      // visually padded to 15 (+5 escape chars), even tho string is 17 chars
      expect(visualPad(input, 15).length).to.equal(20);
    });

    it('should pad strings under len', function() {
      // not padded, under length
      expect(visualPad(input, 10).length).to.equal(17);
    });
  });


  describe('.alignRecords()', function() {
    it('should return a array of record strings w/ equal columns', function() {
      function mockRecord(arr) {
        return { toParts() { return arr; } };
      }

      const record_1 = mockRecord(['Record 1', 'Record One Cell 2', 'Cell 3']);
      const record_2 = mockRecord(['Record Two', 'Record 2 C:2', 'Cell Three']);
      const record_3 = mockRecord(['Record 3', 'Cell 2']);

      const input = [
        [record_1, record_2],
        [record_3],
      ];

      const expected_str_1 = 'Record 1   Record One Cell 2 Cell 3    ';
      const expected_str_2 = 'Record Two Record 2 C:2      Cell Three';
      const expected_str_3 = 'Record 3   Cell 2           ';

      const expected = [
        [expected_str_1, expected_str_2],
        [expected_str_3],
      ];

      expect(misc.alignRecords.apply(null, input)).to.eql(expected);
    });
  });


  describe('makeRawTXT()', function() {
    it('{key: "value"} => {key: Buffer<>}', function() {
      const obj = {key: 'value'};
      const expected = {key: new Buffer('value')};

      expect(misc.makeRawTXT(obj)).to.eql(expected);
    });

    it('{key: false} => {}', function() {
      const obj = {key: false};
      const expected = {};

      expect(misc.makeRawTXT(obj)).to.eql(expected);
    });

    it('{key: true} => {key: true}', function() {
      const obj = {key: true};
      const expected = {key: true};

      expect(misc.makeRawTXT(obj)).to.eql(expected);
      expect(misc.makeRawTXT(obj)).to.not.equal(expected);
    });

    it('{key: null} => {key: null}', function() {
      const obj = {key: null};
      const expected = {key: null};

      expect(misc.makeRawTXT(obj)).to.eql(expected);
    });

    it('{key: Buffer<>} => {key: Buffer<>}', function() {
      const obj = {key: new Buffer('data')};
      const expected = {key: new Buffer('data')};

      expect(misc.makeRawTXT(obj)).to.eql(expected);
    });
  });


  describe('makeReadableTXT()', function() {
    it('{key: "value"} => {key: "value"}', function() {
      const obj = {key: 'value'};
      const expected = {key: 'value'};

      expect(misc.makeReadableTXT(obj)).to.eql(expected);
    });

    it('{key: false} => {}', function() {
      const obj = {key: false};
      const expected = {};

      expect(misc.makeReadableTXT(obj)).to.eql(expected);
    });

    it('{key: true} => {key: true}', function() {
      const obj = {key: true};
      const expected = {key: true};

      expect(misc.makeReadableTXT(obj)).to.eql(expected);
      expect(misc.makeReadableTXT(obj)).to.not.equal(expected);
    });

    it('{key: null} => {key: null}', function() {
      const obj = {key: null};
      const expected = {key: null};

      expect(misc.makeReadableTXT(obj)).to.eql(expected);
    });

    it('{key: Buffer<>} => {key: "string"}', function() {
      const obj = {key: new Buffer('data')};
      const expected = {key: 'data'};

      expect(misc.makeReadableTXT(obj)).to.eql(expected);
    });
  });

});
