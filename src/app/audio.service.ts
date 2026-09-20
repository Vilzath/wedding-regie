import {Injectable, signal} from "@angular/core";
import type {MusicButton} from "./models";

const END_EPSILON_SECONDS = 0.04;
const SWITCH_FADE_MS = 550;

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
      this.updateFadeVolume();
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
    const start = Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0);
    const end = endSeconds !== null && Number.isFinite(endSeconds) && endSeconds > start
      ? endSeconds
      : null;
    this.error.set("");

    if (this.isActive(button, start, end)) {
      await this.toggleActive();
      return;
    }

    const currentSwitch = ++this.switchId;
    if (this.activeButton() && !this.element.paused) {
      this.stopMonitor();
      await this.fadeOut(SWITCH_FADE_MS);
      if (currentSwitch !== this.switchId) return;
    }

    this.cancelFade();
    this.element.pause();
    this.element.src = button.audioUrl;
    this.element.load();
    this.activeButton.set(button);
    this.playbackStart.set(start);
    this.requestedEnd = end;
    this.playbackEnd.set(end ?? 0);
    this.excerpt.set(start > 0 || end !== null);
    this.looping.set(false);
    this.currentTime.set(start);

    try {
      await this.waitForMetadata();
      if (currentSwitch !== this.switchId) return;
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
      this.element.volume = 1;
      await this.element.play();
    } catch {
      if (!this.error()) this.error.set("Appuie à nouveau pour autoriser la lecture audio.");
    }
  }

  async toggleActive(): Promise<void> {
    if (!this.activeButton()) return;
    this.error.set("");
    if (!this.element.paused) {
      this.element.pause();
      return;
    }
    if (this.currentTime() < this.playbackStart() || this.currentTime() >= this.playbackEnd()) {
      this.element.currentTime = this.playbackStart();
      this.currentTime.set(this.playbackStart());
    }
    this.updateFadeVolume();
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

  toggleLoop(): void {
    if (this.activeButton()) this.looping.update((value) => !value);
  }

  stop(): void {
    this.switchId += 1;
    this.cancelFade();
    this.element.pause();
    this.element.currentTime = 0;
    this.clearPlaybackState();
    this.error.set("");
  }

  seek(value: number): void {
    if (!Number.isFinite(value) || !this.activeButton()) return;
    const end = this.playbackEnd();
    const clamped = Math.min(Math.max(value, this.playbackStart()), end || value);
    this.element.currentTime = clamped;
    this.currentTime.set(clamped);
    this.updateFadeVolume();
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
      this.updateFadeVolume();
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

  private updateFadeVolume(): void {
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
    if (this.looping()) {
      this.element.currentTime = this.playbackStart();
      this.currentTime.set(this.playbackStart());
      this.element.volume = 1;
      try {
        await this.element.play();
      } catch {
        this.error.set("La boucle n’a pas pu redémarrer automatiquement.");
      }
    } else {
      const end = this.playbackEnd();
      if (end > 0) this.element.currentTime = end;
      this.currentTime.set(end);
      this.element.volume = 1;
    }
    this.boundaryHandling = false;
  }

  private fadeOut(milliseconds: number): Promise<void> {
    this.cancelFade(false);
    const initialVolume = this.element.volume;
    const startedAt = Date.now();
    return new Promise((resolve) => {
      this.finishFade = resolve;
      this.fadeTimer = setInterval(() => {
        const progress = Math.min(1, (Date.now() - startedAt) / milliseconds);
        this.element.volume = initialVolume * (1 - progress);
        if (progress >= 1) this.cancelFade(false);
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
