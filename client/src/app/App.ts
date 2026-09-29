import { Application } from 'pixi.js';
import type { MatchResult } from '@manhunt/shared';
import { AssetManager } from '../assets/AssetManager';
import { AudioEngine } from '../audio/AudioEngine';
import { Input } from '../input/Input';
import { GameView } from '../game/GameView';
import { parseRoomInput } from '../net/config';
import { downloadMatchLog, readMatchLog } from '../net/matchLog';
import { hostGame, joinGame, type Session } from '../net/session';
import { renderLanding, renderMessage } from '../ui/landing';
import { LobbyScreen } from '../ui/lobby';
import { renderResults } from '../ui/results';
import { loadVolumes, openSettings } from '../ui/settings';
import { sessionGet, sessionSet, storageGet, storageSet } from '../ui/dom';

type Screen = 'landing' | 'busy' | 'lobby' | 'match' | 'results' | 'message';

/** Top-level state machine: landing -> lobby -> match -> results -> lobby. */
export class App {
  private pixi!: Application;
  private assets!: AssetManager;
  private audio!: AudioEngine;
  private input!: Input;
  private readonly ui = document.getElementById('ui')!;
  private session: Session | null = null;
  private lobbyScreen: LobbyScreen | null = null;
  private game: GameView | null = null;
  private resultsEl: HTMLElement | null = null;
  private settingsEl: HTMLElement | null = null;
  private screen: Screen = 'landing';
  private leaving = false;
  private wakeLock: { release(): Promise<void> } | null = null;
  private unsub: (() => void)[] = [];

  async start(): Promise<void> {
    this.pixi = new Application();
    await this.pixi.init({ background: '#000000', resizeTo: window, preference: 'webgl', antialias: false, resolution: 1 });
    document.getElementById('game')!.appendChild(this.pixi.canvas);
    this.assets = await AssetManager.load();
    this.audio = new AudioEngine(this.assets);
    this.audio.setVolumes(loadVolumes());
    this.input = new Input(this.pixi.canvas);
    const resume = (): void => this.audio.resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.screen === 'match') this.toggleSettings();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.session?.isHost && this.screen === 'match') {
        this.game?.hud.feed('You are hosting: keep this tab in the foreground so nobody lags.');
      }
    });
    this.pixi.ticker.add((t) => {
      if (this.game) this.game.frame(t.deltaMS, performance.now());
      else this.input.endFrame();
    });
    (window as unknown as { __manhunt: unknown }).__manhunt = this;
    this.showLanding();
  }

  get client() {
    return this.session?.client ?? null;
  }

  get audioStats() {
    return this.audio?.stats() ?? null;
  }

  get state(): Screen {
    return this.screen;
  }

  private clearUi(): void {
    this.lobbyScreen?.destroy();
    this.lobbyScreen = null;
    this.resultsEl?.remove();
    this.resultsEl = null;
    this.settingsEl?.remove();
    this.settingsEl = null;
    if (this.screen !== 'match' && this.screen !== 'results') {
      this.game?.destroy();
      this.game = null;
    }
    this.ui.innerHTML = '';
  }

  showLanding(error = '', busy = ''): void {
    this.screen = busy ? 'busy' : 'landing';
    this.game?.destroy();
    this.game = null;
    this.clearUi();
    const params = new URLSearchParams(location.search);
    renderLanding(
      this.ui,
      { name: storageGet('manhunt.name') ?? '', room: params.get('room') ?? '', error, busy, hasLog: readMatchLog().length > 0 },
      {
        onCreate: (name) => void this.create(name),
        onJoin: (name, room) => void this.join(name, room),
        onDownloadLog: downloadMatchLog,
      },
    );
  }

  private async create(name: string): Promise<void> {
    storageSet('manhunt.name', name);
    this.showLanding('', 'Opening a room...');
    try {
      const s = await hostGame(name);
      this.bind(s);
    } catch (e) {
      this.showLanding(`Could not create a lobby: ${(e as Error).message ?? e}. Check your connection and try again.`);
    }
  }

  private async join(name: string, roomInput: string): Promise<void> {
    const room = parseRoomInput(roomInput);
    if (!room) {
      this.showLanding('Enter a 4-letter room code or paste an invite link.');
      return;
    }
    storageSet('manhunt.name', name);
    this.showLanding('', `Finding room ${room}...`);
    try {
      const s = await joinGame(room, name, sessionGet(`manhunt.token.${room}`) ?? undefined);
      this.bind(s);
    } catch (e) {
      this.showLanding(`${(e as Error).message ?? e}`);
    }
  }

  private bind(s: Session): void {
    this.session = s;
    this.leaving = false;
    const c = s.client;
    for (const f of this.unsub) f();
    this.unsub = [
      c.on('welcome', () => {
        sessionSet(`manhunt.token.${c.room}`, c.token);
        const url = new URL(location.href);
        url.searchParams.set('room', c.room);
        history.replaceState(null, '', url);
      }),
      c.on('lobby', () => {
        if (c.state === 'lobby' && this.screen !== 'lobby') this.showLobby();
      }),
      c.on('start', () => this.showMatch()),
      c.on('end', (r) => this.showResults(r as MatchResult)),
      c.on('error', (msg) => {
        if (c.closeReason) this.onClosed(String(msg));
      }),
      c.on('close', (reason) => this.onClosed(String(reason))),
    ];
    if (c.state === 'lobby' && c.lobby) this.showLobby();
  }

  private onClosed(reason: string): void {
    if (this.leaving) return;
    const wasHost = this.session?.isHost;
    this.session?.close();
    this.session = null;
    this.game?.destroy();
    this.game = null;
    this.releaseWakeLock();
    this.clearUi();
    this.screen = 'message';
    const hostLeft = /host (left|closed)|lost connection/i.test(reason);
    renderMessage(this.ui, hostLeft ? 'The host left' : 'Disconnected', hostLeft ? 'The match is over. The host closed their game.' : reason || 'The connection closed.', {
      label: 'Back',
      onClick: () => this.showLanding(),
    });
    if (wasHost) this.showLanding();
  }

  leave(): void {
    this.leaving = true;
    this.session?.close();
    this.session = null;
    this.releaseWakeLock();
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    this.showLanding();
  }

  private showLobby(): void {
    this.screen = 'lobby';
    this.game?.destroy();
    this.game = null;
    this.clearUi();
    this.releaseWakeLock();
    const s = this.session!;
    this.lobbyScreen = new LobbyScreen(this.ui, s.client, s.isHost, { onLeave: () => this.leave(), onDownloadLog: downloadMatchLog });
  }

  private showMatch(): void {
    this.clearUi();
    this.game?.destroy();
    this.screen = 'match';
    const s = this.session!;
    this.game = new GameView({ app: this.pixi, assets: this.assets, audio: this.audio, client: s.client, uiRoot: this.ui, input: this.input });
    if (s.isHost) void this.requestWakeLock();
  }

  private showResults(r: MatchResult): void {
    this.screen = 'results';
    this.settingsEl?.remove();
    this.settingsEl = null;
    const s = this.session!;
    this.resultsEl = renderResults(this.ui, r, {
      isOwner: s.client.isOwner,
      isHost: s.isHost,
      onRematch: () => s.client.send({ t: 'toLobby' }),
      onLeave: () => this.leave(),
      onDownloadLog: downloadMatchLog,
    });
  }

  private toggleSettings(): void {
    if (this.settingsEl) {
      this.settingsEl.remove();
      this.settingsEl = null;
      this.input.enabled = true;
      return;
    }
    const s = this.session;
    if (!s) return;
    this.input.enabled = false;
    const role = s.client.match?.role;
    this.settingsEl = openSettings(this.ui, {
      role: role === 'hunter' ? 'hunter' : role === 'survivor' ? 'survivor' : 'both',
      isOwner: s.client.isOwner,
      isHost: s.isHost,
      onVolumes: (v) => this.audio.setVolumes(v),
      onLeave: () => this.leave(),
      onEndMatch: () => s.client.send({ t: 'toLobby' }),
      onDownloadLog: downloadMatchLog,
      onClose: () => {
        this.settingsEl = null;
        this.input.enabled = true;
      },
    });
  }

  private async requestWakeLock(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  private releaseWakeLock(): void {
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }
}
