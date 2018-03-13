/**
 * Wraps a buffer for easier reading / writing without keeping track of offsets.
 * @class
 *
 * instead of:
 *   buffer.writeUInt8(1, 0);
 *   buffer.writeUInt8(2, 1);
 *   buffer.writeUInt8(3, 2);
 *
 * do:
 *   wrapper.writeUInt8(1);
 *   wrapper.writeUInt8(2);
 *   wrapper.writeUInt8(3);
 */
class BufferWrapper {
  /**
   * @param {Buffer}  [buffer]
   * @param {integer} [position]
   */
  constructor(buffer, position = 0) {
    this.buffer = buffer || Buffer.alloc(512);
    this.position = position;
  }

  readUInt8() {
    const value = this.buffer.readUInt8(this.position);
    this.position += 1;
    return value;
  }

  writeUInt8(value) {
    this._checkLength(1);
    this.buffer.writeUInt8(value, this.position);
    this.position += 1;
  }

  readUInt16BE() {
    const value = this.buffer.readUInt16BE(this.position);
    this.position += 2;
    return value;
  }

  writeUInt16BE(value) {
    this._checkLength(2);
    this.buffer.writeUInt16BE(value, this.position);
    this.position += 2;
  }

  readUInt32BE() {
    const value = this.buffer.readUInt32BE(this.position);
    this.position += 4;
    return value;
  }

  writeUInt32BE(value) {
    this._checkLength(4);
    this.buffer.writeUInt32BE(value, this.position);
    this.position += 4;
  }

  readUIntBE(len) {
    const value = this.buffer.readUIntBE(this.position, len);
    this.position += len;
    return value;
  }

  writeUIntBE(value, len) {
    this._checkLength(len);
    this.buffer.writeUIntBE(value, this.position, len);
    this.position += len;
  }

  readString(len) {
    const str = this.buffer.toString('utf8', this.position, this.position + len);
    this.position += len;
    return str;
  }

  writeString(str) {
    const len = Buffer.byteLength(str);
    this._checkLength(len);
    this.buffer.write(str, this.position);
    this.position += len;
  }

  /**
   * Returns a sub portion of the wrapped buffer
   * @param  {integer} len
   * @return {Buffer}
   */
  read(len) {
    const buf = Buffer.alloc(len).fill(0);
    this.buffer.copy(buf, 0, this.position);
    this.position += len;
    return buf;
  }

  /**
   * Writes another buffer onto the wrapped buffer
   * @param {Buffer} buffer
   */
  add(buffer) {
    this._checkLength(buffer.length);
    buffer.copy(this.buffer, this.position);
    this.position += buffer.length;
  }

  seek(position) {
    this.position = position;
  }

  skip(len) {
    this.position += len;
  }

  tell() {
    return this.position;
  }

  remaining() {
    return this.buffer.length - this.position;
  }

  unwrap() {
    return this.buffer.slice(0, this.position);
  }

  _checkLength(len) {
    const needed = len - this.remaining();
    const amount = (needed > 512) ? needed * 1.5 : 512;

    if (needed > 0) this._grow(amount);
  }

  _grow(amount) {
    this.buffer = Buffer.concat([this.buffer, Buffer.alloc(amount).fill(0)]);
  }


  indexOf(needle) {
    // limit indexOf search up to current position in buffer, no need to
    // search for stuff after this.position
    const haystack = this.buffer.slice(0, this.position);

    if (!haystack.length || !needle.length) return -1;
    if (needle.length > haystack.length) return -1;

    // use node's indexof if this version has it
    if (typeof Buffer.prototype.indexOf === 'function') {
      return haystack.indexOf(needle);
    }

    // otherwise do naive search
    const maxIndex = haystack.length - needle.length;
    let index = 0;
    let pos = 0;

    for (; index <= maxIndex; index++, pos = 0) {
      while (haystack[index + pos] === needle[pos]) {
        if (++pos === needle.length) return index;
      }
    }

    return -1;
  }


  /**
   * Reads a fully qualified domain name from the buffer following the dns
   * message format / compression style.
   *
   * Basic:
   * Each label is preceded by an uint8 specifying the length of the label,
   * finishing with a 0 which indicates the root label.
   *
   * +---+------+---+--------+---+-----+---+
   * | 3 | wwww | 6 | google | 3 | com | 0 |  -->  www.google.com.
   * +---+------+---+--------+---+-----+---+
   *
   * Compression:
   * A pointer is used to point to the location of the previously written labels.
   * If a length byte is > 192 (0xC0) then it means its a pointer to other
   * labels and not a length marker. The pointer is 2 octets long.
   *
   * +---+------+-------------+
   * | 3 | wwww | 0xC000 + 34 |  -->  www.google.com.
   * +---+------+-------------+
   *                       ^-- the "google.com." part can be found @ offset 34
   *
   * @return {string}
   */
  readFQDN() {
    const labels = [];
    let len, farthest;

    while (this.remaining() >= 0 && (len = this.readUInt8())) {
      // Handle dns compression. If the length is > 192, it means its a pointer.
      // The pointer points to a previous position in the buffer to move to and
      // read from. Pointer (a int16be) = 0xC000 + position
      if (len < 192) {
        labels.push(this.readString(len));
      } else {
        const position = (len << 8) + this.readUInt8() - 0xC000;

        // If a pointer was found, keep track of the farthest position reached
        // (the current position) before following the pointers so we can return
        // to it later after following all the compression pointers
        if (!farthest) farthest = this.position;
        this.seek(position);
      }
    }

    // reset to correct position after following pointers (if any)
    if (farthest) this.seek(farthest);

    return labels.join('.') + '.'; // + root label
  }


  /**
   * Writes a fully qualified domain name
   * Same rules as readFQDN above. Does compression.
   *
   * @param {string} name
   */
  writeFQDN(name) {
    // convert name into an array of buffers
    const labels = name.split('.').filter(s => !!s).map((label) => {
      const len = Buffer.byteLength(label);
      const buf = Buffer.alloc(1 + len);

      buf.writeUInt8(len, 0);
      buf.write(label, 1);

      return buf;
    });

    // add root label (a single ".") to the end (zero length label = 0)
    labels.push(Buffer.alloc(1));

    // compress
    const compressed = this._getCompressedLabels(labels);
    compressed.forEach(label => this.add(label));
  }


  /**
   * Finds a compressed version of given labels within the buffer
   *
   * Checks if a sub section has been written before, starting with all labels
   * and removing the first label on each successive search until a match (index)
   * is found, or until NO match is found.
   *
   * Ex:
   *
   * 1st pass: Instance._service._tcp.local
   * 2nd pass: _service._tcp.local
   * 3rd pass: _tcp.local
   *            ^-- found "_tcp.local" @ 34, try to compress more
   *
   * 4th pass: Instance._service.[0xC000 + 34]
   * 5th pass: _service.[0xC000 + 34]
   *            ^-- found "_service.[0xC000 + 34]" @ 52, try to compress more
   *
   * 6th pass: Instance.[0xC000 + 52]
   *
   * Nothing else found, returns [Instance, 0xC000+52]
   *
   * @param  {Buffer[]} labels
   * @return {Buffer[]} - compressed version
   */
  _getCompressedLabels(labels) {
    const copy = [...labels];
    const wrapper = this;

    function compress(lastPointer) {
      // re-loop on each compression attempt
      copy.forEach((label, index) => {
        // if a pointer was found on the last compress call, don't bother trying
        // to find a previous instance of a pointer, it doesn't do any good.
        // no need to change [0xC000 + 54] pointer to a [0xC000 + 23] pointer
        if (lastPointer && label === lastPointer) return;
        if (label.length === 1 && label[0] === 0) return;

        const subset = copy.slice(index);
        const pos = wrapper.indexOf(Buffer.concat(subset));

        if (!!~pos) {
          const pointer = Buffer.alloc(2);
          pointer.writeUInt16BE(0xC000 + pos, 0);

          // drop this label and everything after it (stopping forEach loop)
          // put the pointer there instead
          copy.splice(index, copy.length - index);
          copy.push(pointer);

          compress(pointer); // try to compress some more
        }
      });
    }

    compress();
    return copy;
  }
}


module.exports = BufferWrapper;
