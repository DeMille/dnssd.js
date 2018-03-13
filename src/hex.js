const misc = require('./misc');

function chunk(arr, size) {
  let i = 0;
  let j = 0;
  const chunked = new Array(Math.ceil(arr.length / size));

  while (i < arr.length) {
    chunked[j++] = arr.slice(i, (i += size));
  }

  return chunked;
}

/**
 * Dumps packet buffers to an easier to look at string:
 *
 * XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX  ...ascii...!....
 * XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX  .asdf...........
 * XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX  .........asdf...
 * XX XX XX XX XX XX XX XX XX                       .........
 *
 * DNS name compression pointers shown in magenta
 *
 * @param  {Buffer} buffer
 * @return {string}
 */
module.exports.view = function view(buffer) {
  // chunk buffer into lines of 16 octets each, like:
  // [
  //  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  //  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  //  [1, 2, 3, 4, 5, 6, 7]
  // ]
  const lines = chunk(buffer, 16);

  // keep track of DNS name compression pointers since they are 2 bytes long
  // and we are only looking at 1 byte at a time per line in the loop
  let lastCharacterWasPtr = false;

  // turn each line into a str representation and join with newline
  return lines.map((octets) => {
    const hexChars = [];
    const asciiChars = [];

    // byte by byte marking pointers and ascii chars as they appear
    octets.forEach((octet) => {
      // individual chars
      let ascii = String.fromCharCode(octet);
      let hex = misc.padStart(octet.toString(16), 2, '0');

      // crazy regex range from ' ' to '~' (printable ascii)
      const isPrintableAscii = /[ -~]/.test(ascii);
      const currentCharIsPtr = (octet >= 192);

      // DNS name compression pointers are 2 octets long,
      // and can occur back to back
      if (currentCharIsPtr || lastCharacterWasPtr) {
        hex = misc.color(hex, 'magenta', true);
        ascii = misc.color('.', 'white', true);
      } else if (isPrintableAscii) {
        hex = misc.color(hex, 'blue');
      } else {
        ascii = misc.color('.', 'grey');
      }

      hexChars.push(hex);
      asciiChars.push(ascii);

      lastCharacterWasPtr = currentCharIsPtr;
    });

    // pad with 2 empty spaces so each line is the same length
    // when printed
    while (hexChars.length < 16) hexChars.push('  ');

    // str representation of this line
    // XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX  ...ascii...!....
    return hexChars.join(' ') + '  ' + asciiChars.join('');
  }).join('\n');
};
