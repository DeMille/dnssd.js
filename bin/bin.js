#!/usr/bin/env node

const dnssd = require('../index.js');


//
//
main(process.argv);
//
//


function showHelp(reason) {
  if (reason) console.log(`\n${reason}`);

  console.log('\nUsage: dnssd-js <command>\n');
  console.log('dnssd-js browse [type] [domain]');
  console.log('dnssd-js advertise <type> <port> [name] [txt]');
  console.log('dnssd-js query <record name> <record type>');
  console.log('dnssd-js address <hostname> [v4/v6]');

  process.exit();
}


function exit(err) {
  if (err) console.log(`\n${err}\n`);
  process.exit();
}


function padStart(value, len, filler = ' ') {
  const str = String(value);
  const fill = String(filler);
  const needed = len - str.length;

  return (needed > 0) ? fill.repeat(needed) + str : str;
}


function padEnd(value, len, filler = ' ') {
  const str = String(value);
  const fill = String(filler);
  const needed = len - str.length;

  return (needed > 0) ? str + fill.repeat(needed) : str;
}


function timestamp() {
  const now = new Date();

  const time = [
    padStart(now.getHours(), 2, 0),
    padStart(now.getMinutes(), 2, 0),
    padStart(now.getSeconds(), 2, 0),
    padStart(now.getMilliseconds(), 3, 0),
  ];

  return `[${time.join(':')}]`;
}


function print(time, status, type, instance) {
  console.log('%s  %s  %s  %s',
    padEnd(time, 14),
    padEnd(status, 4),
    padEnd(type, 20),
    instance);
}


function browse(serviceType, domain) {
  const browser = new dnssd.Browser(serviceType, {domain});

  // format to:
  // [23:18:53:805]  Up    _http._tcp   Test @ box.local. (169.254.22.58:4576)
  browser.on('serviceUp', (service) => {
    print(timestamp(), 'Up',
      `_${service.type.name}._${service.type.protocol}`,
      `${service.name} @ ${service.host} (${service.addresses[0]}:${service.port})`);
  });

  browser.on('serviceDown', (service) => {
    print(timestamp(), 'Down',
      `_${service.type.name}._${service.type.protocol}`,
      `${service.name} @ ${service.host} (${service.addresses[0]}:${service.port})`);
  });

  browser.on('error', exit);
  browser.start();
}


function browseAll(domain) {
  console.log('Browsing for all available services:\n');
  print('Time', 'U/D', 'Service Type', 'Instance');
  print('----', '---', '------------', '--------');

  const browser = new dnssd.Browser(dnssd.all(), { domain });
  const active = {};

  browser.on('serviceUp', (type) => {
    const serviceType = `_${type.name}._${type.protocol}`;

    // only start one browser for each new service type
    if (!active[serviceType]) {
      active[serviceType] = true;
      browse(serviceType, domain);
    }
  });

  browser.on('error', exit);
  browser.start();
}


function browseType(type, domain) {
  if (!type || type === 'all') return browseAll(domain);

  let serviceType;

  // wrap in case type validation fails
  try {
    serviceType = new dnssd.ServiceType(type);
  } catch (err) {
    exit(`Bad service type: ${err.message}`);
  }

  console.log(`Browsing for "${serviceType}":\n`);
  print('Time', 'U/D', 'Service Type', 'Instance');
  print('----', '---', '------------', '--------');

  browse(serviceType, domain);
}


function advertise(type, portString, name, obj) {
  const port = parseInt(portString, 10);
  let txt, advertisement;

  if (!port) exit('Missing port number');
  if (!Number.isInteger(port)) exit('Bad port number');

  // parse txt string
  if (obj) {
    try {
      txt = JSON.parse(obj);
    } catch (err) {
      exit(`Problem parsing txt object: ${txt.message}`);
    }
  }

  // wrap in case advert args fail validation check
  try {
    advertisement = new dnssd.Advertisement(type, port, {name, txt});
  } catch (err) {
    exit(`Problem creating advertisement: ${err.messsage}`);
  }

  console.log(`Creating advertisement for "${type}"...`);

  advertisement.on('active', () => {
    console.log('%s Advertisement now active', timestamp());
  });

  advertisement.on('instanceRenamed', (instance) => {
    console.log('%s Advertisement instance renamed "%s" due to a conflict.',
      timestamp(), instance);
  });

  advertisement.on('hostRenamed', (host) => {
    console.log('%s Advertisement hostname renamed "%s" due to a conflict.',
      timestamp(), host);
  });

  advertisement.on('stopped', () => {
    console.log('%s Advertisement stopped.', timestamp());
    exit();
  });

  advertisement.on('error', exit);
  advertisement.start();
}


function query(name, type) {
  if (!name) exit('Missing record name');
  if (!type) exit('Missing record type');

  // rrtype could be string (like TXT) or and int (like 16)
  const rrtype = (Number.isInteger(parseInt(type, 10))) ? parseInt(type, 10) : type;
  let getRecord;

  // wrap to check for validation errors
  try {
    getRecord = dnssd.resolve(name, rrtype);
  } catch (err) {
    exit(err);
  }

  getRecord
    .then((result) => {
      console.log(`Found record: ${result.answer}`);
    })
    .catch((err) => {
      exit(`Record not found. \nReason: ${err.message}`);
    });
}


function address(hostname, IPv = 'v4/v6') {
  if (!hostname) exit('Missing hostname');

  let getIPv4, getIPv6;

  // wrap to check for validation errors
  try {
    if (!!~IPv.indexOf('v4')) getIPv4 = dnssd.resolveA(hostname);
    if (!!~IPv.indexOf('v6')) getIPv6 = dnssd.resolveAAAA(hostname);
  } catch (err) {
    exit(err);
  }

  if (!getIPv4 && !getIPv6) exit('Invalid address type given: ' + IPv);

  Promise.all([getIPv4, getIPv6])
    .then((results) => {
      const IPv4 = results[0];
      const IPv6 = results[1];

      if (IPv4) console.log(`Found IPv4 address: ${IPv4}`);
      if (IPv6) console.log(`Found IPv6 address: ${IPv6}`);
    })
    .catch((err) => {
      exit(`Address not found. \nReason: ${err.message}`);
    });
}


function main(args) {
  const commands = {
    browse: browseType,
    register: advertise,
    advertise,
    query,
    address,
  };

  const command = args[2];

  if (!command || command === '-h' || command === '--help') showHelp();
  if (!(command in commands)) showHelp('Unknown command given');

  commands[command].apply(null, args.slice(3));

  process.on('SIGINT', exit);
  process.on('SIGTERM', exit);
  process.on('SIGQUIT', exit);
}
