const os = require('os');

const _ = require('lodash');

const chai      = require('chai');
const expect    = chai.expect;
const sinon     = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);

const dir = process['test-dir'] || '../src';

const Browser       = require(dir + '/Browser');
const Advertisement = require(dir + '/Advertisement');
const ServiceType   = require(dir + '/ServiceType');
const resolve       = require(dir + '/resolve');


describe('Sanity tests:', function() {
  // these will take a while:
  this.timeout(5 * 1000);


  it('advertisement and browser should talk to each other', function(done) {
    const options = {name: 'Test #1'};

    const ad = new Advertisement('_test._tcp', 4444, options).start();

    const browser = new Browser(ServiceType.tcp('test'), options)
      .on('serviceUp', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          ad.stop();
        }
      })
      .on('serviceDown', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          browser.stop();
          done();
        }
      })
      .start();
  });


  it('advertisements should rename if they find a conflict', function(done) {
    const options = {name: 'Test #2'};
    const callback = _.after(3, done);
    let ad_1, ad_2;

    function stop() {
      ad_1.stop(false, callback);
      ad_2.stop(false, callback);
    }

    ad_2 = new Advertisement('_test._tcp', 5555, options) // <-- conflicting port!
      .on('instanceRenamed', (name) => {
        expect(name).to.equal('Test #2 (2)');
        callback(); // must be called for test to complete
      })
      .on('active', () => stop());

    ad_1 = new Advertisement(ServiceType.tcp('test'), 4444, options)
      .on('instanceRenamed', () => { throw new Error('Was renamed!'); })
      .on('active', () => ad_2.start())
      .start();
  });


  it('advertisements should not rename if without conflict', function(done) {
    const options = {name: 'Test #3'};
    const callback = _.after(2, done);
    let ad_1, ad_2;

    function stop() {
      ad_1.stop(false, callback);
      ad_2.stop(false, callback);
    }

    ad_2 = new Advertisement('_test._tcp', 4444, options) // <-- NO conflict
      .on('instanceRenamed', () => { throw new Error('Was renamed!'); })
      .on('active', () => stop());

    ad_1 = new Advertisement(ServiceType.tcp('test'), 4444, options)
      .on('instanceRenamed', () => { throw new Error('Was renamed!'); })
      .on('active', () => ad_2.start())
      .start();
  });


  it('should be able to resolve from an advertisement', function(done) {
    const options = {name: 'Test #3'};
    let ad;

    function check() {
      const fullname = 'Test #3._test._tcp.local.';

      resolve.resolveService(fullname, options)
        .then((service) => {
          expect(service.name).to.equal(ad.instanceName);
          expect(service.port).to.equal(4444);
          expect(service.type).to.eql({name: 'test', protocol: 'tcp'});
          expect(service.txt).to.eql({});

          ad.stop(false, done);
        })
        .catch((err) => {
          ad.stop(false, () => {
            done(err);
          });
        });
    }

    ad = new Advertisement(ServiceType.tcp('test'), 4444, options)
      .on('active', () => check())
      .start();
  });


  it('browsers should listen to advertisement changes', function(done) {
    const options = {name: 'Test #4'};
    let updated = false;

    const ad = new Advertisement('_test._tcp', 4444, options).start();

    const browser = new Browser('_test._tcp', options)
      .on('serviceChanged', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          if (_(service.txt).isEqual({key: 'value'})) {
            browser.stop();
            ad.stop(false, done);
          }
        }
      })
      .on('serviceUp', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          setTimeout(() => {
            ad.updateTXT({key: 'value'});
            updated = true;
          });
        }
      })
      .start();
  });


  it('advertisement / browser interface option should work', function(done) {
    const name = Object.keys(os.networkInterfaces())[0];
    const options = { name: 'Test #5', interface: name };

    const ad = new Advertisement('_test._tcp', 4444, options).start();

    const browser = new Browser(ServiceType.tcp('test'), options)
      .on('serviceUp', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          ad.stop();
        }
      })
      .on('serviceDown', (service) => {
        if (service.name === ad.instanceName && service.port === ad.port) {
          browser.stop();
          done();
        }
      })
      .start();
  });
});
