import {Injectable, signal} from "@angular/core";

type WakeStatus = "active" | "inactive" | "unsupported";

@Injectable({providedIn: "root"})
export class WakeLockService {
  readonly status = signal<WakeStatus>("inactive");
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.wanted) void this.enable();
    });
  }

  async enable(): Promise<void> {
    this.wanted = true;
    if (!("wakeLock" in navigator)) {
      this.status.set("unsupported");
      return;
    }
    if (this.sentinel && !this.sentinel.released) {
      this.status.set("active");
      return;
    }
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.status.set("active");
      this.sentinel.addEventListener("release", () => {
        this.sentinel = null;
        this.status.set("inactive");
      });
    } catch {
      this.status.set("inactive");
    }
  }
}
