import {Injectable, signal} from "@angular/core";
import type {MusicButton, Playlist} from "./models";

const END_EPSILON_SECONDS = 0.04;
const TRANSITION_FADE_MS = 700;
const STOP_FADE_MS = 750;

@Injectable({providedIn: "root"})
export class AudioService {
  private readonly element = new Audio();
  private requestedEnd: number | null = null;
  private monitorFrame: number | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private finishFade: (() => void) | null = null;
  private boundaryHandling = false;
  private switchId = 0;

  readonly activeButton = signal<MusicButton | null>(null);
  readonly activePlaylist = signal<Playlist | null>(null);
  readonly playlistIndex = signal(-1);
  readonly playing = signal(false);
  readonly looping = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly playbackStart = signal(0);
  readonly playbackEnd = signal(0);
  readonly excerpt = signal(false);
  readonly error = signal("");

  constructor() {
    this.element.preload = "metadata";
    this.element.addEventListener("play", () => {
      this.playing.set(true);
      this.startMonitor();
    });
    this.element.addEventListener("pause", () => {
      this.playing.set(false);
      this.stopMonitor();
    });
    this.element.addEventListener("ended", () => void this.finishOrLoop());
    this.element.addEventListener("timeupdate", () => {
      this.currentTime.set(this.element.currentTime || 0);
      this.updateEndFade();
    });
    this.element.addEventListener("durationchange", () => this.syncDuration());
    this.element.addEventListener("error", () => {
      this.error.set("La musique n’a pas pu être lue.");
      this.playing.set(false);
      this.stopMonitor();
    });
  }

  async toggle(
    button: MusicButton,
    startSeconds = 0,
    endSeconds: number | null = null,
  ): Promise<void> {
    const {start, end} = this.normalizeRange(startSeconds, endSeconds);
    this.error.set("");

    if (!this.activePlaylist() && this.isActive(button, start, end)) {
      await this.toggleActive();
      return;
    }

    const operation = ++this.switchId;
    await this.fadeCurrent(TRANSITION_FADE_MS);
    if (operation !== this.switchId) return;

    this.activePlaylist.set(null);
    this.playlistIndex.set(-1);
    this.looping.set(false);
    await this.loadAndPlay(button, start, end, operation, false);
  }

  async togglePlaylist(playlist: Playlist): Promise<void> {
    this.error.set("");
    if (!playlist.buttons.length) {
      this.error.set("Cette playlist ne contient aucune musique.");
      return;
    }
    if (this.activePlaylist()?.id === playlist.id) {
      await this.toggleActive();
      return;
    }

    const operation = ++this.switchId;
    await this.fadeCurrent(TRANSITION_FADE_MS);
    if (operation !== this.switchId) return;

    this.activePlaylist.set(playlist);
    this.playlistIndex.set(0);
    this.looping.set(false);
    await this.loadAndPlay(playlist.buttons[0]!, 0, null, operation, true);
  }

  async toggleActive(): Promise<void> {
    if (!this.activeButton()) return;
    this.error.set("");
    if (!this.element.paused) {
      this.element.pause();
      return;
    }
    const playlist = this.activePlaylist();
    if (
      playlist
      && this.playlistIndex() === playlist.buttons.length - 1
      && this.currentTime() >= this.playbackEnd()
    ) {
      const operation = ++this.switchId;
      this.playlistIndex.set(0);
      await this.loadAndPlay(playlist.buttons[0]!, 0, null, operation, true);
      return;
    }
    if (this.currentTime() < this.playbackStart() || this.currentTime() >= this.playbackEnd()) {
      this.element.currentTime = this.playbackStart();
      this.currentTime.set(this.playbackStart());
    }
    this.updateEndFade();
    try {
      await this.element.play();
    } catch {
      this.error.set("Appuie à nouveau pour autoriser la lecture audio.");
    }
  }

  isActive(button: MusicButton, startSeconds = 0, endSeconds: number | null = null): boolean {
    return this.activeButton()?.id === button.id
      && this.playbackStart() === startSeconds
      && this.requestedEnd === endSeconds;
  }

  isPlaylistActive(playlist: Playlist): boolean {
    return this.activePlaylist()?.id === playlist.id;
  }

  toggleLoop(): void {
    if (this.activeButton()) this.looping.update((value) => !value);
  }

  async stop(): Promise<void> {
    if (!this.activeButton()) return;
    const operation = ++this.switchId;
    this.error.set("");
    await this.fadeCurrent(STOP_FADE_MS);
    if (operation !== this.switchId) return;
    this.cancelFade(false);
    this.element.pause();
    this.element.currentTime = 0;
    this.element.volume = 1;
    this.clearPlaybackState();
  }

  seek(value: number): void {
    if (!Number.isFinite(value) || !this.activeButton()) return;
    const end = this.playbackEnd();
    const clamped = Math.min(Math.max(value, this.playbackStart()), end || value);
    this.element.currentTime = clamped;
    this.currentTime.set(clamped);
    this.updateEndFade();
  }

  private normalizeRange(startSeconds: number, endSeconds: number | null) {
    const start = Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0);
    const end = endSeconds !== null && Number.isFinite(endSeconds) && endSeconds > start
      ? endSeconds
      : null;
    return {start, end};
  }

  private async loadAndPlay(
    button: MusicButton,
    start: number,
    end: number | null,
    operation: number,
    fadeIn: boolean,
  ): Promise<void> {
    this.cancelFade(false);
    this.element.pause();
    this.element.src = button.audioUrl;
    this.element.load();
    this.activeButton.set(button);
    this.playbackStart.set(start);
    this.requestedEnd = end;
    this.playbackEnd.set(end ?? 0);
    this.excerpt.set(start > 0 || end !== null);
    this.currentTime.set(start);

    try {
      await this.waitForMetadata();
      if (operation !== this.switchId) return;
      this.syncDuration();
      if (this.duration() > 0 && start >= this.duration()) {
        this.clearPlaybackState();
        this.error.set("Le début de l’extrait dépasse la durée de la musique.");
        return;
      }
      if (this.playbackEnd() <= start) {
        this.clearPlaybackState();
        this.error.set("La fin de l’extrait dépasse les limites de la musique.");
        return;
      }
      this.element.currentTime = start;
      this.currentTime.set(start);
      this.element.volume = fadeIn ? 0 : 1;
      await this.element.play();
      if (fadeIn && operation === this.switchId) await this.fadeVolume(1, TRANSITION_FADE_MS);
    } catch {
      this.cancelFade();
      if (!this.error()) this.error.set("Appuie à nouveau pour autoriser la lecture audio.");
    }
  }

  private syncDuration(): void {
    const fullDuration = Number.isFinite(this.element.duration) ? this.element.duration : 0;
    this.duration.set(fullDuration);
    const requestedEnd = this.requestedEnd;
    this.playbackEnd.set(
      requestedEnd === null
        ? fullDuration
        : fullDuration > 0
          ? Math.min(requestedEnd, fullDuration)
          : requestedEnd,
    );
  }

  private waitForMetadata(): Promise<void> {
    if (this.element.readyState >= 1 && Number.isFinite(this.element.duration)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (callback: () => void) => {
        window.clearTimeout(timer);
        this.element.removeEventListener("loadedmetadata", loaded);
        this.element.removeEventListener("error", failed);
        callback();
      };
      const loaded = () => finish(resolve);
      const failed = () => finish(() => reject(new Error("media error")));
      const timer = window.setTimeout(() => finish(() => reject(new Error("metadata timeout"))), 8000);
      this.element.addEventListener("loadedmetadata", loaded, {once: true});
      this.element.addEventListener("error", failed, {once: true});
    });
  }

  private startMonitor(): void {
    this.stopMonitor();
    const tick = () => {
      if (this.element.paused) return;
      this.updateEndFade();
      const end = this.playbackEnd();
      if (end > 0 && this.element.currentTime >= end - END_EPSILON_SECONDS) {
        void this.finishOrLoop();
        return;
      }
      this.monitorFrame = window.requestAnimationFrame(tick);
    };
    this.monitorFrame = window.requestAnimationFrame(tick);
  }

  private stopMonitor(): void {
    if (this.monitorFrame !== null) window.cancelAnimationFrame(this.monitorFrame);
    this.monitorFrame = null;
  }

  private updateEndFade(): void {
    if (this.fadeTimer !== null) return;
    const end = this.playbackEnd();
    if (end <= 0) {
      this.element.volume = 1;
      return;
    }
    const remaining = end - this.element.currentTime;
    const length = Math.max(end - this.playbackStart(), 0.1);
    const fadeSeconds = Math.min(2, Math.max(0.4, length / 3));
    this.element.volume = remaining >= 0 && remaining <= fadeSeconds
      ? Math.max(0, Math.min(1, remaining / fadeSeconds))
      : 1;
  }

  private async finishOrLoop(): Promise<void> {
    if (this.boundaryHandling || !this.activeButton()) return;
    this.boundaryHandling = true;
    this.element.pause();
    try {
      const playlist = this.activePlaylist();
      if (playlist) {
        let nextIndex = this.playlistIndex() + 1;
        if (nextIndex >= playlist.buttons.length) {
          if (!this.looping()) {
            this.finishAtEnd();
            return;
          }
          nextIndex = 0;
        }
        const operation = ++this.switchId;
        this.playlistIndex.set(nextIndex);
        await this.loadAndPlay(playlist.buttons[nextIndex]!, 0, null, operation, true);
        return;
      }

      if (this.looping()) {
        const operation = ++this.switchId;
        this.element.currentTime = this.playbackStart();
        this.currentTime.set(this.playbackStart());
        this.element.volume = 0;
        await this.element.play();
        if (operation === this.switchId) await this.fadeVolume(1, TRANSITION_FADE_MS);
      } else {
        this.finishAtEnd();
      }
    } catch {
      this.error.set("La lecture suivante n’a pas pu démarrer automatiquement.");
    } finally {
      this.boundaryHandling = false;
    }
  }

  private finishAtEnd(): void {
    const end = this.playbackEnd();
    if (end > 0) this.element.currentTime = end;
    this.currentTime.set(end);
    this.element.volume = 1;
  }

  private async fadeCurrent(milliseconds: number): Promise<void> {
    if (!this.activeButton() || this.element.paused) return;
    this.stopMonitor();
    await this.fadeVolume(0, milliseconds);
  }

  private fadeVolume(targetVolume: number, milliseconds: number): Promise<void> {
    this.cancelFade(false);
    const initialVolume = this.element.volume;
    const startedAt = Date.now();
    return new Promise((resolve) => {
      this.finishFade = resolve;
      this.fadeTimer = setInterval(() => {
        const progress = Math.min(1, (Date.now() - startedAt) / milliseconds);
        this.element.volume = initialVolume + (targetVolume - initialVolume) * progress;
        if (progress >= 1) {
          this.element.volume = targetVolume;
          this.cancelFade(false);
        }
      }, 25);
    });
  }

  private cancelFade(resetVolume = true): void {
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    const finish = this.finishFade;
    this.finishFade = null;
    finish?.();
    if (resetVolume) this.element.volume = 1;
  }

  private clearPlaybackState(): void {
    this.stopMonitor();
    this.activeButton.set(null);
    this.activePlaylist.set(null);
    this.playlistIndex.set(-1);
    this.playing.set(false);
    this.looping.set(false);
    this.currentTime.set(0);
    this.duration.set(0);
    this.playbackStart.set(0);
    this.playbackEnd.set(0);
    this.excerpt.set(false);
    this.requestedEnd = null;
    this.boundaryHandling = false;
  }
}
