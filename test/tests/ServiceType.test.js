const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);


const dir = process['test-dir'] || '../../src';
const ServiceType = rewire(dir + '/ServiceType');


describe('ServiceType', function() {

  describe('#constructor()', function() {
    it('should call this._fromString() on string', sinon.test(function() {
      this.stub(ServiceType.prototype, '_fromString');
      this.stub(ServiceType.prototype, '_validate');

      const type = new ServiceType('string');

      expect(type._fromString).to.have.been.called;
    }));

    it('should call this._fromArray() on array', sinon.test(function() {
      this.stub(ServiceType.prototype, '_fromArray');
      this.stub(ServiceType.prototype, '_validate');

      const type = new ServiceType([]);

      expect(type._fromArray).to.have.been.called;
    }));

    it('should call this._fromObj() on object', sinon.test(function() {
      this.stub(ServiceType.prototype, '_fromObj');
      this.stub(ServiceType.prototype, '_validate');

      const type = new ServiceType({});

      expect(type._fromObj).to.have.been.called;
    }));

    it('should convert multiple args to array form', sinon.test(function() {
      this.stub(ServiceType.prototype, '_fromArray');
      this.stub(ServiceType.prototype, '_validate');

      const type = new ServiceType('_http', '_tcp', 'sub1', 'sub2');
      const expected = ['_http', '_tcp', 'sub1', 'sub2'];

      expect(type._fromArray).to.have.been.calledWithMatch(expected);
    }));

    it('should throw an error for any other input type', sinon.test(function() {
      expect(() => new ServiceType(99)).to.throw();
    }));
  });


  describe('#_fromString()', function() {
    it('should parse names without subtypes', function() {
      const input = '_http._tcp';
      const results = {};

      ServiceType.prototype._fromString.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: [],
      };

      expect(results).to.eql(expected);
    });

    it('should parse names with subtypes', function() {
      const input = '_http._tcp,sub1,sub2';
      const results = {};

      ServiceType.prototype._fromString.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results).to.eql(expected);
    });

    it('should trim off weird commas/whitespace', function() {
      const input = ' _http._tcp ,sub1,sub2, ';
      const results = {};

      ServiceType.prototype._fromString.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results).to.eql(expected);
    });

    it('should handle service enumerator string', function() {
      const input = '_services._dns-sd._udp';
      const results = {};

      ServiceType.prototype._fromString.call(results, input);

      const expected = {
        name:     '_services._dns-sd',
        protocol: '_udp',
        subtypes: [],
      };

      expect(results).to.eql(expected);
    });
  });


  describe('#_fromArray()', function() {
    it('should handle nested array', function() {
      const input = ['_http', '_tcp', ['sub1', 'sub2']];
      const results = {_fromObj: sinon.stub()};

      ServiceType.prototype._fromArray.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results._fromObj).to.have.been.calledWithMatch(expected);
    });

    it('should handle flat array too', function() {
      const input = ['_http', '_tcp', 'sub1', 'sub2'];
      const results = {_fromObj: sinon.stub()};

      ServiceType.prototype._fromArray.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      expect(results._fromObj).to.have.been.calledWithMatch(expected);
    });
  });


  describe('#_fromObj()', function() {
    it('should cast subtypes to array', function() {
      const results = {};

      const input = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: 'sub1',
      };

      ServiceType.prototype._fromObj.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1'],
      };

      expect(results).to.eql(expected);
    });

    it('should use name, protocol, subs and ignore other properties', function() {
      const results = {};

      const input = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1'],
        ignore:   'ok',
      };

      ServiceType.prototype._fromObj.call(results, input);

      const expected = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1'],
      };

      expect(results).to.eql(expected);
    });
  });


  describe('#_validate()', function() {
    const stub = {
      serviceName: sinon.stub(),
      protocol   : sinon.stub(),
      label      : sinon.stub(),
    };

    let revert;

    before(function() {
      revert = ServiceType.__set__('validate', stub);
    });

    after(function() {
      revert();
    });

    beforeEach(function() {
      stub.serviceName.reset();
      stub.protocol.reset();
      stub.label.reset();
    });

    it('should throw error if name is missing / is not a string', function() {
      const input_1 = {name: 4};
      const input_2 = {name: ''};

      expect(ServiceType.prototype._validate.bind(input_1)).to.throw(Error);
      expect(ServiceType.prototype._validate.bind(input_2)).to.throw(Error);
    });

    it('should throw error if protocol is missing / is not a string', function() {
      const input_1 = {name: '_http', protocol: 4};
      const input_2 = {name: '_http', protocol: ''};

      expect(ServiceType.prototype._validate.bind(input_1)).to.throw(Error);
      expect(ServiceType.prototype._validate.bind(input_2)).to.throw(Error);
    });

    it('should be forgiving about underscores in name/protocol', function() {
      const context = {
        name:     'http',
        protocol: 'tcp',
        subtypes: [],
      };

      ServiceType.prototype._validate.call(context);

      expect(context.name).to.equal('_http');
      expect(context.protocol).to.equal('_tcp');
    });

    it('should run validation on name, protocol, and subtypes', function() {
      const context = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: [],
      };

      ServiceType.prototype._validate.call(context);

      expect(stub.serviceName).to.have.been.called;
      expect(stub.protocol).to.have.been.called;
      expect(stub.label).to.have.callCount(context.subtypes.length);
    });

    it('should *not* run validation on service enumerator types', function() {
      const context = {
        name:     '_services._dns-sd',
        protocol: '_udp',
        subtypes: ['sub1', 'sub2'],
      };

      ServiceType.prototype._validate.call(context);

      expect(context.subtypes).to.be.empty;
      expect(context.isEnumerator).to.be.true;
      expect(stub.serviceName).to.not.have.been.called;
    });
  });


  describe('#toString()', function() {
    it('should spit out a valid string without subtypes', function() {
      const context = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: [],
      };

      const result = ServiceType.prototype.toString.call(context);

      expect(result).to.equal('_http._tcp');
    });

    it('should spit out a valid string with subtypes', function() {
      const context = {
        name:     '_http',
        protocol: '_tcp',
        subtypes: ['sub1', 'sub2'],
      };

      const result = ServiceType.prototype.toString.call(context);

      expect(result).to.equal('_http._tcp,sub1,sub2');
    });
  });


  describe('::tcp()', function() {
    it('should throw error if service is missing / is not a string', function() {
      expect(ServiceType.tcp.bind(null)).to.throw(Error);
      expect(ServiceType.tcp.bind(null, '')).to.throw(Error);
    });

    it('should return a correct tcp ServiceType', function() {
      // single string
      expect(ServiceType.tcp('_http'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'});

      // name and subtype
      expect(ServiceType.tcp('_http', 'sub1'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'})
        .to.property('subtypes').eql(['sub1']);

      // name and subtypes in array
      expect(ServiceType.tcp('_http', ['sub1', 'sub2']))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);

      // name and subtypes
      expect(ServiceType.tcp('_http', 'sub1', 'sub2'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_http', protocol: '_tcp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);
    });
  });


  describe('::udp()', function() {
    it('should throw error if service is missing / is not a string', function() {
      expect(ServiceType.udp.bind(null)).to.throw(Error);
      expect(ServiceType.udp.bind(null, '')).to.throw(Error);
    });

    it('should return a correct udp ServiceType', function() {
      // single string
      expect(ServiceType.udp('_sleep-proxy'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'});

      // name and subtype
      expect(ServiceType.udp('_sleep-proxy', 'sub1'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'})
        .to.property('subtypes').eql(['sub1']);

      // name and subtypes in array
      expect(ServiceType.udp('_sleep-proxy', ['sub1', 'sub2']))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);

      // name and subtypes
      expect(ServiceType.udp('_sleep-proxy', 'sub1', 'sub2'))
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_sleep-proxy', protocol: '_udp'})
        .to.property('subtypes').eql(['sub1', 'sub2']);
    });
  });


  describe('::all()', function() {
    it('should return a correct enumerator ServiceType', function() {
      expect(ServiceType.all())
        .to.be.an.instanceof(ServiceType)
        .to.include({name: '_services._dns-sd', protocol: '_udp'})
        .to.have.property('isEnumerator', true);
    });
  });

});
