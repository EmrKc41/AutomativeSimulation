import { describe, expect, it } from "vitest";

import { FrameScheduler, type SchedulerClock } from "./frame-scheduler";

/**
 * Sahte zamanlayıcı.
 *
 * Gerçek tarayıcıda "rAF hiç ateşlenmedi" hâlini kurmak mümkün değil, oysa
 * kusur tam olarak o hâlde ortaya çıkıyordu. Burada rAF'ı elle ateşliyoruz ya
 * da hiç ateşlemiyoruz.
 */
function sahteSaat() {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 1;

  const clock: SchedulerClock = {
    requestFrame: (run) => {
      const handle = next++;
      frames.set(handle, run);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
    setTimer: (run, ms) => {
      const handle = next++;
      timers.set(handle, { run, ms });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle);
    },
  };

  return {
    clock,
    get bekleyenCizim() {
      return frames.size;
    },
    get bekleyenZamanlayici() {
      return timers.size;
    },
    /** Tarayıcı bir kare çizdi. */
    kareCiz() {
      const [handle, run] = [...frames][0] ?? [];
      if (handle === undefined || !run) return false;
      frames.delete(handle);
      run();
      return true;
    },
    /** Süre doldu. */
    sureDoldu() {
      const [handle, entry] = [...timers][0] ?? [];
      if (handle === undefined || !entry) return false;
      timers.delete(handle);
      entry.run();
      return true;
    },
  };
}

describe("çerçeve zamanlayıcı", () => {
  it("görünür sekmede çizimi ekran karesiyle yapar", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.schedule();
    saat.kareCiz();

    expect(scheduler.flushes).toBe(1);
    // Kare geldiyse güvenlik zamanlayıcısı boşuna çalışmamalı.
    expect(saat.bekleyenZamanlayici).toBe(0);
  });

  /**
   * Kusurun kendisi.
   *
   * Sekme arka plana düştüğünde rAF ateşlenmiyor. Eski kod tek bir tutamak
   * tuttuğu için bu, bütün akışı kalıcı olarak kilitliyordu: motor çerçeve
   * yayınlamaya devam ediyor, pano ilk donduğu anı göstermeye devam ediyordu.
   */
  it("ekran karesi hiç gelmezse pano yine de güncellenir", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.schedule();
    expect(scheduler.flushes).toBe(0);

    // Tarayıcı hiç kare çizmiyor; yalnızca süre doluyor.
    saat.sureDoldu();

    expect(scheduler.flushes).toBe(1);
  });

  it("kare hiç gelmese bile ardışık çerçeveler birikmez", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    // Motorun on dakikası: her çerçeve bir çizim istiyor, tarayıcı hiç
    // çizmiyor. Eski kodda bu sayı 0'da kalıyordu.
    for (let i = 0; i < 10; i += 1) {
      scheduler.schedule();
      saat.sureDoldu();
    }

    expect(scheduler.flushes).toBe(10);
  });

  it("bir çizim beklerken gelen çerçeveler tek çizimde toplanır", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(saat.bekleyenCizim).toBe(1);
    saat.kareCiz();
    expect(scheduler.flushes).toBe(1);
  });

  it("çizim yapıldıktan sonra iki zamanlayıcıdan hiçbiri kalmaz", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.schedule();
    saat.sureDoldu();

    // Sızdırılan bir rAF, bir sonraki `schedule()` çağrısını "zaten bekliyor"
    // sanıp yutardı; kusrun kilitlenme mekanizması buydu.
    expect(saat.bekleyenCizim).toBe(0);
    expect(saat.bekleyenZamanlayici).toBe(0);
    expect(scheduler.pending).toBe(false);
  });

  it("iki zamanlayıcı da çalışsa çizim bir kez yapılır", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.schedule();
    saat.kareCiz();
    // Süre de dolmuş olsaydı: iptal edildiği için çalışacak bir şey yok.
    expect(saat.sureDoldu()).toBe(false);
    expect(scheduler.flushes).toBe(1);
  });

  it("sekmeye dönüldüğünde bekleyen çerçeve hemen çizilir", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.schedule();
    scheduler.flushNow();

    expect(scheduler.flushes).toBe(1);
    expect(scheduler.pending).toBe(false);
  });

  it("bekleyen çerçeve yokken sekmeye dönmek boşuna çizim yaptırmaz", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.flushNow();

    expect(scheduler.flushes).toBe(0);
  });

  it("iptal edilen çizim sonradan ateşlenmez", () => {
    const saat = sahteSaat();
    const scheduler = new FrameScheduler(saat.clock, () => {});

    scheduler.schedule();
    scheduler.cancel();

    expect(saat.kareCiz()).toBe(false);
    expect(saat.sureDoldu()).toBe(false);
    expect(scheduler.flushes).toBe(0);
  });
});
