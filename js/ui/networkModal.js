/**
 * networkModal.js — WebRTC Connection Modal, Signaling Exchange & Mode Selection
 * Three Kingdoms KARDS (Milestone 4)
 *
 * Implements:
 * 1. Mode Select: Solo vs Bot, Bot vs Bot sandbox, LAN WebRTC Host, LAN WebRTC Join.
 * 2. Host Modal: Token generation (TKCO:), 1-click copy, answer input, BroadcastChannel auto-broadcaster.
 * 3. Join Modal: Manual offer input, token generation (TKCA:), BroadcastChannel auto-discovery list.
 * 4. Zero-Click LAN Pairing via BroadcastChannel.
 */

import {
  createHostOfferSession,
  createClientAnswerSession,
  LobbyDiscovery
} from '../network/signaling.js';
import { PeerConnection, PEER_STATE } from '../network/peerConnection.js';
import { RoomLobby } from './roomLobby.js';

export class NetworkModalController {
  /**
   * @param {object} options
   * @param {HTMLElement} [options.modalEl] - #modal-network
   * @param {Function} [options.onStartSolo] - ({ faction, difficulty, firstPlayer }) => void
   * @param {Function} [options.onStartSandbox] - ({ stepSpeedMs }) => void
   * @param {Function} [options.onP2PConnected] - ({ peerConnection, isHost, localFaction }) => void
   */
  constructor(options = {}) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;

    this.modalEl = options.modalEl || (doc?.getElementById('modal-network'));
    this.onStartSolo = options.onStartSolo || (() => {});
    this.onStartSandbox = options.onStartSandbox || (() => {});
    this.onP2PConnected = options.onP2PConnected || (() => {});

    this.discovery = new LobbyDiscovery('tk-lan-discovery');
    this.activeHostSession = null;
    this.activeClientSession = null;

    this.discoveredRooms = new Map(); // roomId -> roomInfo

    if (this.modalEl) {
      this._bindEvents();
      this.lobby = new RoomLobby({
        root: this.modalEl.querySelector('#net-room-panel'),
        onConnected: (cfg) => { this.hide(); this.onP2PConnected(cfg); }
      });
    }
  }

  /** 通过邀请链接进入：打开面板并自动加入房间 */
  showAndJoin(code, mode) {
    this.lobby?.joinWhenReady(code, mode);
    this.show('tab-host');
  }

  show(defaultTab = 'tab-bot') {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('hidden');
    this.switchTab(defaultTab === 'tab-bot' ? 'tab-host' : defaultTab);
    this.lobby?.activate();
  }

  hide() {
    if (!this.modalEl) return;
    this.modalEl.classList.add('hidden');
    this.discovery.stop();
    this.lobby?.deactivate();
  }

  _bindEvents() {
    if (!this.modalEl) return;

    // Close buttons
    this.modalEl.querySelectorAll('[data-close="modal-network"], .modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => this.hide());
    });

    // Tab buttons
    this.modalEl.querySelectorAll('.network-tabs .tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const tabId = tabBtn.dataset.tab;
        this.switchTab(tabId);
      });
    });

    // --- Host Room Actions ---
    const btnGenOffer = this.modalEl.querySelector('#btn-generate-offer');
    if (btnGenOffer) {
      btnGenOffer.addEventListener('click', () => this._handleGenerateOffer());
    }

    const btnCopyOffer = this.modalEl.querySelector('#btn-copy-offer');
    if (btnCopyOffer) {
      btnCopyOffer.addEventListener('click', () => {
        const txt = this.modalEl.querySelector('#text-offer-token');
        this._copyToClipboard(txt?.value, btnCopyOffer, '已复制主机联机码！');
      });
    }

    const btnApplyAnswer = this.modalEl.querySelector('#btn-apply-answer');
    if (btnApplyAnswer) {
      btnApplyAnswer.addEventListener('click', () => this._handleApplyAnswer());
    }

    // --- Join Room Actions ---
    const btnGenAnswer = this.modalEl.querySelector('#btn-generate-answer');
    if (btnGenAnswer) {
      btnGenAnswer.addEventListener('click', () => this._handleGenerateAnswer());
    }

    const btnCopyAnswer = this.modalEl.querySelector('#btn-copy-answer');
    if (btnCopyAnswer) {
      btnCopyAnswer.addEventListener('click', () => {
        const txt = this.modalEl.querySelector('#text-answer-token-output');
        this._copyToClipboard(txt?.value, btnCopyAnswer, '已复制客机应答码！');
      });
    }

    // --- Local Auto-Pairing Button ---
    const btnAutoPair = this.modalEl.querySelector('#btn-auto-pair');
    if (btnAutoPair) {
      btnAutoPair.addEventListener('click', () => this._handleAutoPairDiscovery());
    }

    // --- Solo & Sandbox Actions ---
    const btnStartVsBot = this.modalEl.querySelector('#btn-start-vs-bot');
    if (btnStartVsBot) {
      btnStartVsBot.addEventListener('click', () => {
        this.hide();
        this.onStartSolo({ faction: 'WEI', difficulty: 'NORMAL', firstPlayer: 'RANDOM' });
      });
    }
    const btnStartVsBotShu = this.modalEl.querySelector('#btn-start-vs-bot-shu');
    if (btnStartVsBotShu) {
      btnStartVsBotShu.addEventListener('click', () => {
        this.hide();
        this.onStartSolo({ faction: 'SHU', difficulty: 'NORMAL', firstPlayer: 'RANDOM' });
      });
    }

    const btnStartSandbox = this.modalEl.querySelector('#btn-start-bot-vs-bot');
    if (btnStartSandbox) {
      btnStartSandbox.addEventListener('click', () => {
        this.hide();
        this.onStartSandbox({ stepSpeedMs: 400 });
      });
    }
  }

  switchTab(tabId) {
    if (!this.modalEl) return;

    // Toggle Tab Buttons
    this.modalEl.querySelectorAll('.network-tabs .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Toggle Panes
    this.modalEl.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });

    // Start auto-listener if entering local pairing tab
    if (tabId === 'tab-local-pairing') {
      this._startAutoDiscoveryListener();
    } else {
      this.discovery.stop();
    }
  }

  // ==========================================
  // Host Offer Generation
  // ==========================================
  async _handleGenerateOffer() {
    const offerTxt = this.modalEl.querySelector('#text-offer-token');
    const statusBox = this._getOrCreateStatusBox('#tab-host');
    statusBox.textContent = '⏳ 正在初始化 WebRTC 并收集局域网 ICE 候选...';

    try {
      this.activeHostSession = await createHostOfferSession();
      if (offerTxt) {
        offerTxt.value = this.activeHostSession.offerToken;
      }
      statusBox.innerHTML = '✅ 联机码生成完毕！已启动局域网自动广播。<br>若对手在同机或同网打开，可自动识别；亦可直接复制上方代码发送给好友。';

      // Start BroadcastChannel Broadcaster
      const roomId = `TK-${Math.floor(1000 + Math.random() * 9000)}`;
      this.discovery.startHost({
        roomId,
        hostFaction: 'WEI',
        hostName: '房主 (魏军)',
        offerToken: this.activeHostSession.offerToken,
        onJoinReceived: async (answerToken, clientMsg) => {
          statusBox.innerHTML = `🎉 检测到客机 (${clientMsg?.clientName || '蜀军'}) 加入！正在自动完成握手直连...`;
          try {
            await this.activeHostSession.applyAnswer(answerToken);
          } catch (err) {
            console.error('Auto applyAnswer error:', err);
          }
        }
      });

      // Bind DataChannel Open
      const dc = this.activeHostSession.dc;
      const peer = new PeerConnection({
        isHost: true,
        channel: dc,
        pc: this.activeHostSession.pc
      });

      const onHostReady = () => {
        statusBox.textContent = '🎉 P2P 通道已连接！正在进入战场...';
        setTimeout(() => {
          this.hide();
          this.onP2PConnected({ peerConnection: peer, isHost: true, localFaction: 'WEI' });
        }, 600);
      };

      if (peer.state === PEER_STATE.OPEN || peer.channel?.readyState === 'open') {
        onHostReady();
      } else {
        peer.once('open', onHostReady);
      }
    } catch (err) {
      statusBox.textContent = `❌ 创建房间失败: ${err.message}`;
    }
  }

  async _handleApplyAnswer() {
    const answerTxt = this.modalEl.querySelector('#text-answer-token-input');
    const token = answerTxt?.value?.trim();
    if (!token || !this.activeHostSession) return;

    const statusBox = this._getOrCreateStatusBox('#tab-host');
    statusBox.textContent = '⏳ 正在应用客机应答并完成握手...';

    try {
      await this.activeHostSession.applyAnswer(token);
      statusBox.textContent = '✅ 应答已应用，等待 P2P 通道就绪...';
    } catch (err) {
      statusBox.textContent = `❌ 应用应答失败: ${err.message}`;
    }
  }

  // ==========================================
  // Client Answer Generation
  // ==========================================
  async _handleGenerateAnswer() {
    const offerInput = this.modalEl.querySelector('#text-offer-token-input');
    const answerOutput = this.modalEl.querySelector('#text-answer-token-output');
    const statusBox = this._getOrCreateStatusBox('#tab-join');

    const offerToken = offerInput?.value?.trim();
    if (!offerToken) {
      statusBox.textContent = '⚠️ 请先粘贴房主的联机码 (TKCO:...)！';
      return;
    }

    statusBox.textContent = '⏳ 正在解析联机码并生成应答...';

    try {
      this.activeClientSession = await createClientAnswerSession(offerToken);
      if (answerOutput) {
        answerOutput.value = this.activeClientSession.answerToken;
      }
      statusBox.textContent = '✅ 应答码已生成！请点击下方按钮复制并发送给房主。';

      // Wait for incoming DataChannel
      const dc = await this.activeClientSession.waitForChannel();
      const peer = new PeerConnection({
        isHost: false,
        channel: dc,
        pc: this.activeClientSession.pc
      });

      const onClientReady = () => {
        statusBox.textContent = '🎉 P2P 通道已连接！正在进入战场...';
        setTimeout(() => {
          this.hide();
          this.onP2PConnected({ peerConnection: peer, isHost: false, localFaction: 'SHU' });
        }, 600);
      };

      if (peer.state === PEER_STATE.OPEN || peer.channel?.readyState === 'open') {
        onClientReady();
      } else {
        peer.once('open', onClientReady);
      }
    } catch (err) {
      statusBox.textContent = `❌ 生成应答失败: ${err.message}`;
    }
  }

  // ==========================================
  // Auto-Discovery Lobby
  // ==========================================
  _startAutoDiscoveryListener() {
    const pane = this.modalEl.querySelector('#tab-local-pairing');
    if (!pane) return;

    let roomListEl = pane.querySelector('.auto-rooms-list');
    if (!roomListEl) {
      const doc = typeof document !== 'undefined' ? document : globalThis.document;
      roomListEl = doc.createElement('div');
      roomListEl.className = 'auto-rooms-list';
      pane.appendChild(roomListEl);
    }
    roomListEl.innerHTML = '<div class="room-searching-hint">🔍 正在扫描局域网 / 同浏览器活跃房间...</div>';

    this.discoveredRooms.clear();

    this.discovery.startListener((roomInfo) => {
      if (roomInfo?.roomId && !this.discoveredRooms.has(roomInfo.roomId)) {
        this.discoveredRooms.set(roomInfo.roomId, roomInfo);
        this._renderRoomCard(roomInfo, roomListEl);
      }
    });
  }

  _renderRoomCard(roomInfo, listContainer) {
    const existingHint = listContainer.querySelector('.room-searching-hint');
    if (existingHint) existingHint.remove();

    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const card = doc.createElement('div');
    card.className = 'discovered-room-card';
    card.innerHTML = `
      <div class="room-info">
        <span class="room-id">🏰 房间: ${roomInfo.roomId}</span>
        <span class="room-host">房主: ${roomInfo.hostName || "房主"}</span>
      </div>
      <button class="modal-btn btn-primary btn-quick-join">一键加入对决</button>
    `;

    card.querySelector('.btn-quick-join')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = '连接中...';

      try {
        const session = await createClientAnswerSession(roomInfo.offerToken);
        this.discovery.sendJoin({
          roomId: roomInfo.roomId,
          clientFaction: 'SHU',
          clientName: '客机 (蜀军)',
          answerToken: session.answerToken
        });

        const dc = await session.waitForChannel();
        const peer = new PeerConnection({
          isHost: false,
          channel: dc,
          pc: session.pc
        });

        peer.once('open', () => {
          btn.textContent = '已连接！';
          setTimeout(() => {
            this.hide();
            this.onP2PConnected({ peerConnection: peer, isHost: false, localFaction: 'SHU' });
          }, 400);
        });
      } catch (err) {
        btn.textContent = '连接失败';
        console.error('Quick join error:', err);
      }
    });

    listContainer.appendChild(card);
  }

  async _handleAutoPairDiscovery() {
    if (typeof window !== 'undefined' && window.open) {
      window.open(window.location.href, '_blank');
    }
    this.switchTab('tab-host');
    await this._handleGenerateOffer();
  }

  // ==========================================
  // Utilities
  // ==========================================
  _copyToClipboard(text, btnEl, successMsg = '已复制！') {
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        const orig = btnEl.textContent;
        btnEl.textContent = `✅ ${successMsg}`;
        setTimeout(() => { btnEl.textContent = orig; }, 2000);
      }).catch(() => {
        btnEl.textContent = '❌ 复制失败，请手动选择复制';
      });
    } else {
      btnEl.textContent = `✅ ${successMsg}`;
    }
  }

  _getOrCreateStatusBox(parentSelector) {
    const parent = this.modalEl.querySelector(parentSelector);
    let box = parent?.querySelector('.network-status-box');
    if (!box && parent) {
      const doc = typeof document !== 'undefined' ? document : globalThis.document;
      box = doc.createElement('div');
      box.className = 'network-status-box';
      parent.appendChild(box);
    }
    return box || { textContent: '', innerHTML: '' };
  }
}

export default NetworkModalController;
