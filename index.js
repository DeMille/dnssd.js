var Advertisement    = require('./lib/Advertisement');
var Browser          = require('./lib/Browser');
var ServiceType      = require('./lib/ServiceType');
var validate         = require('./lib/validate');
var resolve          = require('./lib/resolve');
var NetworkInterface = require('./lib/NetworkInterface');


module.exports = {
  Advertisement:  Advertisement,
  Browser:        Browser,
  ServiceType:    ServiceType,
  tcp:            ServiceType.tcp,
  udp:            ServiceType.udp,
  all:            ServiceType.all,
  validate:       validate,
  resolve:        resolve.resolve,
  resolveA:       resolve.resolveA,
  resolveAAAA:    resolve.resolveAAAA,
  resolveSRV:     resolve.resolveSRV,
  resolveTXT:     resolve.resolveTXT,
  resolveService: resolve.resolveService,
};
