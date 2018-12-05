const WritableAsyncIterableStream = require('../index');
const assert = require('assert');

let pendingTimeoutSet = new Set();

function wait(duration) {
  return new Promise((resolve) => {
    let timeout = setTimeout(() => {
      pendingTimeoutSet.clear(timeout);
      resolve();
    }, duration);
    pendingTimeoutSet.add(timeout);
  });
}

function cancelAllPendingWaits() {
  for (let timeout of pendingTimeoutSet) {
    clearTimeout(timeout);
  }
}

describe('WritableAsyncIterableStream', () => {
  let stream;

  describe('for-await-of loop', () => {
    beforeEach(async () => {
      stream = new WritableAsyncIterableStream();
    });

    afterEach(async () => {
      cancelAllPendingWaits();
      stream.end();
    });

    it('should receive packets asynchronously', async () => {
      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(10);
          stream.write('hello' + i);
        }
        stream.end();
      })();

      let receivedPackets = [];
      for await (let packet of stream) {
        receivedPackets.push(packet);
      }
      assert.equal(receivedPackets.length, 10);
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should receive packets asynchronously if multiple packets are written sequentially', async () => {
      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(10);
          stream.write('a' + i);
          stream.write('b' + i);
          stream.write('c' + i);
        }
        stream.end();
      })();

      let receivedPackets = [];
      for await (let packet of stream) {
        receivedPackets.push(packet);
      }
      assert.equal(receivedPackets.length, 30);
      assert.equal(receivedPackets[0], 'a0');
      assert.equal(receivedPackets[1], 'b0');
      assert.equal(receivedPackets[2], 'c0');
      assert.equal(receivedPackets[3], 'a1');
      assert.equal(receivedPackets[4], 'b1');
      assert.equal(receivedPackets[5], 'c1');
      assert.equal(receivedPackets[29], 'c9');
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should receive packets if stream is written to from inside a consuming for-await-of loop', async () => {
      (async () => {
        for (let i = 0; i < 3; i++) {
          await wait(10);
          stream.write('a' + i);
        }
      })();

      let count = 0;
      let receivedPackets = [];
      for await (let packet of stream) {
        receivedPackets.push(packet);
        stream.write('nested' + count);
        if (++count > 10) {
          break;
        }
      }
      assert.equal(receivedPackets[0], 'a0');
      assert.equal(receivedPackets.some(message => message === 'nested0'), true);
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should only consume messages which were written after the consumer was created', async () => {
      stream.write('one');
      stream.write('two');

      let receivedPackets = [];

      let doneConsumingPromise = (async () => {
        for await (let packet of stream) {
          receivedPackets.push(packet);
        }
      })();

      stream.write('three');
      stream.write('four');
      stream.write('five');
      stream.end();

      await doneConsumingPromise;

      assert.equal(receivedPackets.length, 3);
      assert.equal(receivedPackets[0], 'three');
      assert.equal(receivedPackets[1], 'four');
      assert.equal(receivedPackets[2], 'five');
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should not miss packets if it awaits inside a for-await-of loop', async () => {
      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(2);
          stream.write('a' + i);
        }
        stream.end();
      })();

      let receivedPackets = [];
      for await (let packet of stream) {
        receivedPackets.push(packet);
        await wait(50);
      }

      assert.equal(receivedPackets.length, 10);
      for (let i = 0; i < 10; i++) {
        assert.equal(receivedPackets[i], 'a' + i);
      }
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should not miss packets if it awaits inside two concurrent for-await-of loops', async () => {
      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(10);
          stream.write('a' + i);
        }
        stream.end();
      })();

      let receivedPacketsA = [];
      let receivedPacketsB = [];

      await Promise.all([
        (async () => {
          for await (let packet of stream) {
            receivedPacketsA.push(packet);
            await wait(5);
          }
        })(),
        (async () => {
          for await (let packet of stream) {
            receivedPacketsB.push(packet);
            await wait(50);
          }
        })()
      ]);

      assert.equal(receivedPacketsA.length, 10);
      for (let i = 0; i < 10; i++) {
        assert.equal(receivedPacketsA[i], 'a' + i);
      }

      assert.equal(receivedPacketsB.length, 10);
      for (let i = 0; i < 10; i++) {
        assert.equal(receivedPacketsB[i], 'a' + i);
      }
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should be able to resume consumption after the stream has been ended', async () => {
      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(10);
          stream.write('a' + i);
        }
        stream.end();
      })();

      let receivedPacketsA = [];
      for await (let packet of stream) {
        receivedPacketsA.push(packet);
      }

      assert.equal(receivedPacketsA.length, 10);

      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(10);
          stream.write('b' + i);
        }
        stream.end();
      })();

      let receivedPacketsB = [];
      for await (let packet of stream) {
        receivedPacketsB.push(packet);
      }

      assert.equal(receivedPacketsB.length, 10);
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should be able to resume consumption of messages written within the same stack frame after the stream has been ended', async () => {
      stream.write('one');
      stream.write('two');

      let receivedPackets = [];

      let doneConsumingPromiseA = (async () => {
        for await (let packet of stream) {
          receivedPackets.push(packet);
        }
      })();

      stream.write('three');
      stream.write('four');
      stream.write('five');
      stream.end();

      await doneConsumingPromiseA;

      let doneConsumingPromiseB = (async () => {
        for await (let packet of stream) {
          receivedPackets.push(packet);
        }
      })();

      stream.write('six');
      stream.write('seven');
      stream.end();

      await doneConsumingPromiseB;

      assert.equal(receivedPackets.length, 5);
      assert.equal(receivedPackets[0], 'three');
      assert.equal(receivedPackets[1], 'four');
      assert.equal(receivedPackets[2], 'five');
      assert.equal(receivedPackets[3], 'six');
      assert.equal(receivedPackets[4], 'seven');

      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });
  });

  describe('await once', () => {
    beforeEach(async () => {
      stream = new WritableAsyncIterableStream();
    });

    afterEach(async () => {
      cancelAllPendingWaits();
      stream.end();
    });

    it('should receive next packet asynchronously when once() method is used', async () => {
      (async () => {
        for (let i = 0; i < 3; i++) {
          await wait(10);
          stream.write('a' + i);
        }
      })();

      let nextPacket = await stream.once();
      assert.equal(nextPacket, 'a0');

      nextPacket = await stream.once();
      assert.equal(nextPacket, 'a1');

      nextPacket = await stream.once();
      assert.equal(nextPacket, 'a2');

      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should not resolve once() call when stream.end() is called', async () => {
      (async () => {
        await wait(10);
        stream.end();
      })();

      let receivedPackets = [];

      (async () => {
        let nextPacket = await stream.once();
        receivedPackets.push(nextPacket);
      })();

      await wait(100);
      assert.equal(receivedPackets.length, 0);

      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should not resolve previous once() call after stream.end() is called', async () => {
      (async () => {
        await wait(10);
        stream.end();
        await wait(10);
        stream.write('foo');
      })();

      let receivedPackets = [];

      (async () => {
        let nextPacket = await stream.once();
        receivedPackets.push(nextPacket);
      })();

      await wait(100);
      assert.equal(receivedPackets.length, 0);

      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should resolve once() if it is called after stream.end() is called and then a new packet is written', async () => {
      (async () => {
        await wait(10);
        stream.end();
        await wait(10);
        stream.write('foo');
      })();

      let receivedPackets = [];

      (async () => {
        let nextPacket = await stream.once();
        receivedPackets.push(nextPacket);
      })();

      await wait(100);

      assert.equal(receivedPackets.length, 0);

      (async () => {
        await wait(10);
        stream.write('bar');
      })();

      let packet = await stream.once();
      assert.equal(packet, 'bar');

      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });
  });

  describe('while loop with await inside', () => {
    beforeEach(async () => {
      stream = new WritableAsyncIterableStream();
    });

    afterEach(async () => {
      cancelAllPendingWaits();
      stream.end();
    });

    it('should receive packets asynchronously', async () => {
      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(10);
          stream.write('hello' + i);
        }
        stream.end();
      })();

      let receivedPackets = [];
      // for await (let packet of stream) {
      //   receivedPackets.push(packet);
      // }
      let asyncIterator = stream.createAsyncIterator();
      while (true) {
        let packet = await asyncIterator.next();
        if (packet.done) break;
        receivedPackets.push(packet.value);
      }
      assert.equal(receivedPackets.length, 10);
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });

    it('should receive packets asynchronously if multiple packets are written sequentially', async () => {
      (async () => {
        for (let i = 0; i < 10; i++) {
          await wait(10);
          stream.write('a' + i);
          stream.write('b' + i);
          stream.write('c' + i);
        }
        stream.end();
      })();

      let receivedPackets = [];
      let asyncIterator = stream.createAsyncIterator();
      while (true) {
        let packet = await asyncIterator.next();
        if (packet.done) break;
        receivedPackets.push(packet.value);
      }
      assert.equal(receivedPackets.length, 30);
      assert.equal(receivedPackets[0], 'a0');
      assert.equal(receivedPackets[1], 'b0');
      assert.equal(receivedPackets[2], 'c0');
      assert.equal(receivedPackets[3], 'a1');
      assert.equal(receivedPackets[4], 'b1');
      assert.equal(receivedPackets[5], 'c1');
      assert.equal(receivedPackets[29], 'c9');
      assert.equal(stream._consumers.length, 0); // Check internal cleanup.
    });
  });
});
