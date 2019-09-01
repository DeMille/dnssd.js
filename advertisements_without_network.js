//docker run --init -it --network none -v $(pwd):/tmp --rm node bash -c "node /tmp/advertisements_without_network.js"

const dnssd = require('./');

const ad = new dnssd.Advertisement(dnssd.tcp('http'), 4321);
ad.on('error', (err) => {
  console.log('err1')
  console.log(err)
})
const ad2 = new dnssd.Advertisement(dnssd.tcp('http'), 4321);
ad2.on('error', (err) => {
  console.log('err2')
  console.log(err)
})

ad.start();
ad2.start();

setInterval(() => console.log('yay'), 1000)
