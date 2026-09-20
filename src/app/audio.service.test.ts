import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import type {MusicButton} from "./models";
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
    await vi.advanceTimersByTimeAsync(600);
    await switching;

    expect(service.activeButton()?.id).toBe("b");
    expect(service.looping()).toBe(false);
    expect(service.playing()).toBe(true);
  });
});
