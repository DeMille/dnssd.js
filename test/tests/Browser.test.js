const chai      = require('chai');
const expect    = chai.expect;
const rewire    = require('rewire');
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../../src';

const ServiceType    = require(dir + '/ServiceType');
const ResourceRecord = require(dir + '/ResourceRecord');

const Fake = require('../Fake');


const Browser = rewire(dir + '/Browser');


describe('Browser', function() {
  const intf = new Fake.NetworkInterface();
  const query = new Fake.Query();
  const resolver = new Fake.ServiceResolver();

  // change the networkInterfaces dependency within Browser.js so all new
  // browsers have: browser._interface = intf
  const NetworkInterfaceMock = {get: sinon.stub().returns(intf)};

  const QueryConstructor = sinon.stub().returns(query);
  const ServiceResolverConstructor = sinon.stub().returns(resolver);

  Browser.__set__('NetworkInterface', NetworkInterfaceMock);
  Browser.__set__('ServiceResolver', ServiceResolverConstructor);
  Browser.__set__('Query', QueryConstructor);

  beforeEach(function() {
    intf.reset();
    query.reset();
    resolver.reset();
    ServiceResolverConstructor.reset();
  });


  describe('#constructor()', function() {
    it('should be ok if new keyword missing', function() {
      expect(Browser('_http._tcp')).to.be.instanceof(Browser);
    });

    it('should accept service param as a ServiceType (no throw)', function() {
      new Browser(new ServiceType('_http._tcp'));
    });

    it('should accept service param as an object (no throw)', function() {
      new Browser({name: '_http', protocol: '_tcp'});
    });

    it('should accept service param as a string (no throw)', function() {
      new Browser('_http._tcp');
    });

    it('should accept service param as an array (no throw)', function() {
      new Browser(['_http', '_tcp']);
    });

    it('should be ok with service enumerators (no throw)', function() {
      new Browser('_services._dns-sd._udp');
    });

    it('should throw on invalid service types', function() {
      expect(() => new Browser('gunna throw')).to.throw(Error);
    });

    it('should throw on multiple subtypes', function() {
      expect(() => new Browser(['_http', '_tcp', 'sub1', 'sub2'])).to.throw(Error);
    });
  });


  describe('#start()', function() {
    it('should return this', function() {
      const browser = new Browser('_http._tcp');
      sinon.stub(browser, '_startQuery');

      expect(browser.start()).to.equal(browser);
    });

    it('should bind interface & start queries', function(done) {
      const browser = new Browser('_http._tcp');

      sinon.stub(browser, '_startQuery', () => {
        expect(intf.bind).to.have.been.called;
        done();
      });

      browser.start();
    });

    it('should return early if already started', function() {
      const browser = new Browser('_http._tcp');
      sinon.stub(browser, '_startQuery');

      browser.start();
      browser.start(); // <-- does nothing

      // wait for promises
      setTimeout(() => expect(browser._startQuery).to.have.been.calledOnce, 10);
    });

    it('should run _onError on startup errors', function(done) {
      const browser = new Browser('_http._tcp');
      sinon.stub(browser, '_startQuery').returns(Promise.reject());

      browser.on('error', () => done());
      browser.start();
    });
  });


  describe('#stop()', function() {
    it('should remove listeners, stop resolvers, queries, & interfaces', function() {
      const browser = new Browser('_http._tcp');

      const resolver_1 = new Fake.ServiceResolver();
      const resolver_2 = new Fake.ServiceResolver();
      browser._resolvers['mock entry #1'] = resolver_1;
      browser._resolvers['mock entry #2'] = resolver_2;

      browser.stop();

      expect(resolver_1.stop).to.have.been.called;
      expect(resolver_2.stop).to.have.been.called;
      expect(intf.stopUsing).to.have.been.called;
      expect(browser.list()).to.be.empty;
    });
  });


  describe('#list()', function() {
    it('should return services that are currently active', function() {
      const browser = new Browser('_http._tcp');
      const service = {};

      const resolved = new Fake.ServiceResolver();
      resolved.isResolved.returns(false);
      resolved.service.returns(service);

      const unresolved = new Fake.ServiceResolver();
      resolved.isResolved.returns(true);
      resolved.service.returns({});

      browser._resolvers['resolved service'] = resolved;
      browser._resolvers['unresolved service'] = unresolved;

      expect(browser.list()).to.eql([service]);
    });

    it('should return services types that are currently active', function() {
      const browser = new Browser('_services._dns-sd._udp');

      const recordName = '_http._tcp.local.';
      browser._serviceTypes[recordName] = {name: 'http', protocol: 'tcp'};

      expect(browser.list()).to.eql([{name: 'http', protocol: 'tcp'}]);
    });
  });


  describe('#_onError()', function() {
    it('should call stop and emit the error', function(done) {
      const browser = new Browser('_http._tcp');
      sinon.stub(browser, 'stop');

      browser.on('error', () => {
        expect(browser.stop).to.have.been.called;
        done();
      });

      browser.start();

      intf.emit('error', new Error());
    });
  });


  describe('#_startQuery()', function() {
    it('should query for individual services', function() {
      const browser = new Browser('_http._tcp');
      browser._startQuery();

      expect(query.add).to.have.been.calledWithMatch({
        name: '_http._tcp.local.',
        qtype: 12,
      });
    });

    it('should query for service subtypes', function() {
      const browser = new Browser('_http._tcp,subtype');
      browser._startQuery();

      expect(query.add).to.have.been.calledWithMatch({
        name: 'subtype._sub._http._tcp.local.',
        qtype: 12,
      });
    });

    it('should query for available service types', function() {
      const browser = new Browser('_services._dns-sd._udp');
      browser._startQuery();

      expect(query.add).to.have.been.calledWithMatch({
        name: '_services._dns-sd._udp.local.',
        qtype: 12,
      });
    });
  });


  describe('#_addServiceType()', function() {
    const PTR = new ResourceRecord.PTR({
      name: '_services._dns-sd._udp.local.',
      PTRDName: '_http._tcp.local.',
    });

    it('should add new service types', function(done) {
      const browser = new Browser('_services._dns-sd._udp')
        .on('serviceUp', (type) => {
          expect(browser.list()).to.not.be.empty;
          expect(browser.list()[0]).to.eql({name: 'http', protocol: 'tcp'});
          expect(type).eql({name: 'http', protocol: 'tcp'});
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
    });

    it('should ignore PTRs with TTL=0', function(done) {
      const goodbye = PTR.clone();
      goodbye.ttl = 0;

      const browser = new Browser('_services._dns-sd._udp')
        .on('serviceUp', () => { throw new Error('bad!'); })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', goodbye), 10);

      setTimeout(() => {
        expect(browser.list()).to.be.empty;
        done();
      }, 10);
    });

    it('should answer that have already been found', function(done) {
      const browser = new Browser('_services._dns-sd._udp')
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => query.emit('answer', PTR), 10); // <-- ignored

      setTimeout(() => {
        expect(browser.list()).to.have.lengthOf(1);
        done();
      }, 10);
    });

    it('should do nothing if already stopped', function(done) {
      const browser = new Browser('_services._dns-sd._udp');

      browser.start();
      browser.stop();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10); // <-- ignored

      setTimeout(() => {
        expect(browser.list()).to.be.empty;
        done();
      }, 10);
    });
  });


  describe('#_addService()', function() {
    const PTR = new ResourceRecord.PTR({
      name: '_http._tcp.local.',
      PTRDName: 'Instance._http._tcp.local',
    });

    it('should only emit instance names with resolve = false', function(done) {
      new Browser('_http._tcp', {resolve: false})
        .on('serviceUp', (name) => {
          expect(name).to.equal('Instance');
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
    });

    it('should not maintain resovers if maintain = false', function(done) {
      new Browser('_http._tcp', {maintain: false})
        .on('serviceUp', () => {
          expect(resolver.stop).to.have.been.called;
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should emit services when they are resolved/change/down', function(done) {
      let obj;

      new Browser('_http._tcp')
        .on('serviceUp', (service) => {
          expect(service).to.be.an.object;
          obj = service;
          resolver.emit('updated');
        })
        .on('serviceChanged', (service) => {
          expect(service).to.equal(obj);
          resolver.emit('down');
        })
        .on('serviceDown', (service) => {
          expect(service).to.equal(obj);
          done();
        })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should not emit serviceDown if service has never resovled', function(done) {
      const browser = new Browser('_http._tcp')
        .on('serviceUp', () => { throw new Error('bad'); })
        .start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('down'), 10);

      setTimeout(() => {
        expect(browser.list()).to.be.empty;
        done();
      }, 10);
    });

    it('should ignore already known instance answers', function(done) {
      const browser = new Browser('_http._tcp');

      // done x2 would throw:
      browser.on('serviceUp', () => {
        expect(ServiceResolverConstructor).to.have.been.calledOnce;
        done();
      });

      browser.start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => query.emit('answer', PTR), 10);
      setTimeout(() => resolver.emit('resolved'), 10);
    });

    it('should ignore answers with TTL=0', function(done) {
      const goodbye = PTR.clone();
      goodbye.ttl = 0;

      const browser = new Browser('_http._tcp');
      browser.start();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', goodbye), 10);

      setTimeout(() => {
        expect(ServiceResolverConstructor).to.not.have.been.called;
        done();
      }, 10);
    });

    it('should do nothing if already stopped', function(done) {
      const browser = new Browser('_http._tcp');
      browser.start();
      browser.stop();

      // wait for promises to resolve first
      setTimeout(() => query.emit('answer', PTR), 10);

      setTimeout(() => {
        expect(ServiceResolverConstructor).to.not.have.been.called;
        done();
      }, 10);
    });
  });

});
