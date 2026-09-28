/**
 * mockDataChannel.js
 * In-memory Virtual WebRTC RTCDataChannel Mock for Headless Testing.
 * Simulates a connected bidirectional DataChannel pair without browser or WebRTC stack.
 */

import { EventEmitter } from 'node:events';

export class MockDataChannel extends EventEmitter {
  /**
   * @param {string} label Channel label
   * @param {object} [options] Channel options
   */
  constructor(label = 'gameChannel', options = {}) {
    super();
    this.label = label;
    this.options = {
      latencyMs: 0,
      dropRate: 0,
      ...options
    };

    this.readyState = 'connecting';
    this.bufferedAmount = 0;
    this.peer = null;

    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;

    // Bridge EventListener API to EventEmitter
    this.addEventListener = (event, listener) => this.on(event, listener);
    this.removeEventListener = (event, listener) => this.off(event, listener);
  }

  /**
   * Factory method to create a connected bidirectional pair of MockDataChannels.
   * @param {object} [options]
   * @returns {[MockDataChannel, MockDataChannel]} [localChannel, remoteChannel]
   */
  static createPair(options = {}) {
    const channelA = new MockDataChannel('hostChannel', options);
    const channelB = new MockDataChannel('clientChannel', options);

    channelA.peer = channelB;
    channelB.peer = channelA;

    // Open both channels
    channelA._open();
    channelB._open();

    return [channelA, channelB];
  }

  _open() {
    this.readyState = 'open';
    const evt = { type: 'open', target: this };
    if (typeof this.onopen === 'function') {
      this.onopen(evt);
    }
    this.emit('open', evt);
  }

  /**
   * Send data through the virtual channel to the peer.
   * @param {string|ArrayBuffer|Buffer} data
   */
  send(data) {
    if (this.readyState !== 'open') {
      throw new Error(`InvalidStateError: MockDataChannel is not open (state: ${this.readyState})`);
    }

    if (!this.peer || this.peer.readyState !== 'open') {
      return;
    }

    // Packet drop simulation
    if (this.options.dropRate > 0 && Math.random() < this.options.dropRate) {
      return;
    }

    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const messageEvent = {
      type: 'message',
      data: payload,
      origin: 'mock://webrtc',
      target: this.peer
    };

    if (this.options.latencyMs > 0) {
      setTimeout(() => {
        if (this.peer && this.peer.readyState === 'open') {
          this.peer._receive(messageEvent);
        }
      }, this.options.latencyMs);
    } else {
      // Immediate delivery via microtask queue
      queueMicrotask(() => {
        if (this.peer && this.peer.readyState === 'open') {
          this.peer._receive(messageEvent);
        }
      });
    }
  }

  _receive(event) {
    if (typeof this.onmessage === 'function') {
      this.onmessage(event);
    }
    this.emit('message', event);
  }

  /**
   * Close the channel and notify peer.
   */
  close() {
    if (this.readyState === 'closed' || this.readyState === 'closing') {
      return;
    }

    this.readyState = 'closed';
    const closeEvt = { type: 'close', target: this };
    if (typeof this.onclose === 'function') {
      this.onclose(closeEvt);
    }
    this.emit('close', closeEvt);

    if (this.peer && this.peer.readyState === 'open') {
      this.peer.close();
    }
  }
}
