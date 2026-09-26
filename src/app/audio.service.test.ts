import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import type {MusicButton, Playlist} from "./models";
import {AudioService} from "./audio.service";

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = "";
  paused = true;
  currentTime = 0;
  duration = 120;
  volume = 1;
  src = "";
  readyState = 1;

  constructor() {
    super();
    FakeAudio.instances.push(this);
  }

  load(): void {
    this.dispatchEvent(new Event("durationchange"));
  }

  async play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

const button = (id: string): MusicButton => ({
  id,
  name: `Musique ${id}`,
  tag: `musique-${id}`,
  description: "",
  sortOrder: 10,
  categoryId: "category-1",
  categoryName: "Cérémonie",
  audioAssetId: `audio-${id}`,
  audioName: `${id}.mp3`,
  audioUrl: `/api/media/audio-${id}`,
  imageAssetId: null,
  imageUrl: null,
});

const playlist = (...ids: string[]): Playlist => ({
  id: "playlist-1",
  name: "Ambiance",
  description: "",
  sortOrder: 10,
  buttons: ids.map(button),
});

describe("lecteur audio", () => {
  beforeAll(() => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
    });
  });

  beforeEach(() => {
    FakeAudio.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("démarre et borne un extrait", async () => {
    const service = new AudioService();
    await service.toggle(button("a"), 30, 45);

    expect(service.playbackStart()).toBe(30);
    expect(service.playbackEnd()).toBe(45);
    expect(service.currentTime()).toBe(30);
    expect(service.excerpt()).toBe(true);
    expect(service.playing()).toBe(true);
  });

  it("applique un fondu descendant avant la fin", async () => {
    const service = new AudioService();
    await service.toggle(button("a"), 30, 45);
    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 44;
    audio.dispatchEvent(new Event("timeupdate"));

    expect(audio.volume).toBeCloseTo(0.5, 1);
  });

  it("reboucle au début exact de l’extrait", async () => {
    const service = new AudioService();
    await service.toggle(button("a"), 30, 45);
    const audio = FakeAudio.instances[0]!;
    service.toggleLoop();
    audio.currentTime = 45;
    audio.dispatchEvent(new Event("ended"));
    await Promise.resolve();

    expect(service.looping()).toBe(true);
    expect(audio.currentTime).toBe(30);
    expect(service.playing()).toBe(true);
  });

  it("change de morceau après le fondu de transition", async () => {
    vi.useFakeTimers();
    const service = new AudioService();
    await service.toggle(button("a"));
    const switching = service.toggle(button("b"));
    await vi.advanceTimersByTimeAsync(750);
    await switching;

    expect(service.activeButton()?.id).toBe("b");
    expect(service.looping()).toBe(false);
    expect(service.playing()).toBe(true);
  });

  it("applique un fondu avant l’arrêt complet", async () => {
    vi.useFakeTimers();
    const service = new AudioService();
    await service.toggle(button("a"));
    const audio = FakeAudio.instances[0]!;
    const stopping = service.stop();

    await vi.advanceTimersByTimeAsync(375);
    expect(audio.volume).toBeGreaterThan(0);
    expect(audio.volume).toBeLessThan(1);

    await vi.advanceTimersByTimeAsync(400);
    await stopping;
    expect(service.activeButton()).toBeNull();
    expect(service.playing()).toBe(false);
  });

  it("enchaîne les morceaux d’une playlist avec un fondu entrant", async () => {
    vi.useFakeTimers();
    const service = new AudioService();
    const starting = service.togglePlaylist(playlist("a", "b"));
    await vi.advanceTimersByTimeAsync(750);
    await starting;

    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 120;
    audio.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(750);

    expect(service.activePlaylist()?.id).toBe("playlist-1");
    expect(service.playlistIndex()).toBe(1);
    expect(service.activeButton()?.id).toBe("b");
    expect(service.playing()).toBe(true);
    expect(audio.volume).toBe(1);
  });
});
