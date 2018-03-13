'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

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
var BufferWrapper = function () {
  /**
   * @param {Buffer}  [buffer]
   * @param {integer} [position]
   */
  function BufferWrapper(buffer) {
    var position = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;

    _classCallCheck(this, BufferWrapper);

    this.buffer = buffer || Buffer.alloc(512);
    this.position = position;
  }

  _createClass(BufferWrapper, [{
    key: 'readUInt8',
    value: function readUInt8() {
      var value = this.buffer.readUInt8(this.position);
      this.position += 1;
      return value;
    }
  }, {
    key: 'writeUInt8',
    value: function writeUInt8(value) {
      this._checkLength(1);
      this.buffer.writeUInt8(value, this.position);
      this.position += 1;
    }
  }, {
    key: 'readUInt16BE',
    value: function readUInt16BE() {
      var value = this.buffer.readUInt16BE(this.position);
      this.position += 2;
      return value;
    }
  }, {
    key: 'writeUInt16BE',
    value: function writeUInt16BE(value) {
      this._checkLength(2);
      this.buffer.writeUInt16BE(value, this.position);
      this.position += 2;
    }
  }, {
    key: 'readUInt32BE',
    value: function readUInt32BE() {
      var value = this.buffer.readUInt32BE(this.position);
      this.position += 4;
      return value;
    }
  }, {
    key: 'writeUInt32BE',
    value: function writeUInt32BE(value) {
      this._checkLength(4);
      this.buffer.writeUInt32BE(value, this.position);
      this.position += 4;
    }
  }, {
    key: 'readUIntBE',
    value: function readUIntBE(len) {
      var value = this.buffer.readUIntBE(this.position, len);
      this.position += len;
      return value;
    }
  }, {
    key: 'writeUIntBE',
    value: function writeUIntBE(value, len) {
      this._checkLength(len);
      this.buffer.writeUIntBE(value, this.position, len);
      this.position += len;
    }
  }, {
    key: 'readString',
    value: function readString(len) {
      var str = this.buffer.toString('utf8', this.position, this.position + len);
      this.position += len;
      return str;
    }
  }, {
    key: 'writeString',
    value: function writeString(str) {
      var len = Buffer.byteLength(str);
      this._checkLength(len);
      this.buffer.write(str, this.position);
      this.position += len;
    }

    /**
     * Returns a sub portion of the wrapped buffer
     * @param  {integer} len
     * @return {Buffer}
     */

  }, {
    key: 'read',
    value: function read(len) {
      var buf = Buffer.alloc(len).fill(0);
      this.buffer.copy(buf, 0, this.position);
      this.position += len;
      return buf;
    }

    /**
     * Writes another buffer onto the wrapped buffer
     * @param {Buffer} buffer
     */

  }, {
    key: 'add',
    value: function add(buffer) {
      this._checkLength(buffer.length);
      buffer.copy(this.buffer, this.position);
      this.position += buffer.length;
    }
  }, {
    key: 'seek',
    value: function seek(position) {
      this.position = position;
    }
  }, {
    key: 'skip',
    value: function skip(len) {
      this.position += len;
    }
  }, {
    key: 'tell',
    value: function tell() {
      return this.position;
    }
  }, {
    key: 'remaining',
    value: function remaining() {
      return this.buffer.length - this.position;
    }
  }, {
    key: 'unwrap',
    value: function unwrap() {
      return this.buffer.slice(0, this.position);
    }
  }, {
    key: '_checkLength',
    value: function _checkLength(len) {
      var needed = len - this.remaining();
      var amount = needed > 512 ? needed * 1.5 : 512;

      if (needed > 0) this._grow(amount);
    }
  }, {
    key: '_grow',
    value: function _grow(amount) {
      this.buffer = Buffer.concat([this.buffer, Buffer.alloc(amount).fill(0)]);
    }
  }, {
    key: 'indexOf',
    value: function indexOf(needle) {
      // limit indexOf search up to current position in buffer, no need to
      // search for stuff after this.position
      var haystack = this.buffer.slice(0, this.position);

      if (!haystack.length || !needle.length) return -1;
      if (needle.length > haystack.length) return -1;

      // use node's indexof if this version has it
      if (typeof Buffer.prototype.indexOf === 'function') {
        return haystack.indexOf(needle);
      }

      // otherwise do naive search
      var maxIndex = haystack.length - needle.length;
      var index = 0;
      var pos = 0;

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

  }, {
    key: 'readFQDN',
    value: function readFQDN() {
      var labels = [];
      var len = void 0,
          farthest = void 0;

      while (this.remaining() >= 0 && (len = this.readUInt8())) {
        // Handle dns compression. If the length is > 192, it means its a pointer.
        // The pointer points to a previous position in the buffer to move to and
        // read from. Pointer (a int16be) = 0xC000 + position
        if (len < 192) {
          labels.push(this.readString(len));
        } else {
          var position = (len << 8) + this.readUInt8() - 0xC000;

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

  }, {
    key: 'writeFQDN',
    value: function writeFQDN(name) {
      var _this = this;

      // convert name into an array of buffers
      var labels = name.split('.').filter(function (s) {
        return !!s;
      }).map(function (label) {
        var len = Buffer.byteLength(label);
        var buf = Buffer.alloc(1 + len);

        buf.writeUInt8(len, 0);
        buf.write(label, 1);

        return buf;
      });

      // add root label (a single ".") to the end (zero length label = 0)
      labels.push(Buffer.alloc(1));

      // compress
      var compressed = this._getCompressedLabels(labels);
      compressed.forEach(function (label) {
        return _this.add(label);
      });
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

  }, {
    key: '_getCompressedLabels',
    value: function _getCompressedLabels(labels) {
      var copy = [].concat(_toConsumableArray(labels));
      var wrapper = this;

      function compress(lastPointer) {
        // re-loop on each compression attempt
        copy.forEach(function (label, index) {
          // if a pointer was found on the last compress call, don't bother trying
          // to find a previous instance of a pointer, it doesn't do any good.
          // no need to change [0xC000 + 54] pointer to a [0xC000 + 23] pointer
          if (lastPointer && label === lastPointer) return;
          if (label.length === 1 && label[0] === 0) return;

          var subset = copy.slice(index);
          var pos = wrapper.indexOf(Buffer.concat(subset));

          if (!!~pos) {
            var pointer = Buffer.alloc(2);
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
  }]);

  return BufferWrapper;
}();

module.exports = BufferWrapper;