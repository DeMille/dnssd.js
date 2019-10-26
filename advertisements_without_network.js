// docker run --init -it --network none -v $(pwd):/tmp --rm node bash -c "node /tmp/advertisements_without_network.js"

const dnssd = require('./')

const interfaces = require('os').networkInterfaces()
Object.entries(interfaces).forEach(([name, addresses]) => {
  console.log(name)
  console.log(addresses)
  if (addresses.filter(addressRecord => addressRecord.family === 'IPv4').length) {
    const ad = new dnssd.Advertisement(dnssd.tcp('http'), 9999, {
      interface: name
    })
    ad.on('error', err => {
      console.log(err)
    })
    ad.start()
  }
})

// setInterval(() => console.log('yay'), 1000)
