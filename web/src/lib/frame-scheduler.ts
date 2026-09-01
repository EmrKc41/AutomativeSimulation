/**
 * Ne zaman ekrana çizileceğine karar veren zamanlayıcı.
 *
 * Motor saniyede birden fazla çerçeve yayınlayabilir; hepsini ayrı ayrı çizmek
 * gereksiz. Bu yüzden gelen çerçeveler tek bir çizime toplanır.
 *
 * Toplama işini `requestAnimationFrame` yapıyordu ve **buradaki hata da oydu**:
 * çerçeve geldiği anda sekme görünürse rAF kuruluyor, sekme sonradan
 * arka plana düşerse rAF *hiç* ateşlenmiyordu. Elde kalan dolu tutamak,
 * "zaten bir çizim bekliyor" sanılıp sonraki bütün çerçevelerin sessizce
 * atılmasına yol açıyordu. Soket açık kalıyor, bağlantı "canlı" görünüyor,
 * ekran ise donuyordu — komuta merkezi için en kötü arıza bu: pano
 * kendinden emin bir şekilde eski fabrikayı gösteriyor.
 *
 * Çözüm, rAF'a güvenmemek. Her çizim isteğinde **hem** rAF **hem de** bir
 * güvenlik zamanlayıcısı kuruluyor; hangisi önce gelirse çizim onunla oluyor,
 * diğeri iptal ediliyor. rAF hiç gelmezse pano yavaşlar ama durmaz.
 *
 * Zamanlayıcı işlevleri dışarıdan veriliyor, çünkü asıl kusur "rAF ateşlenmedi"
 * hâliydi ve tarayıcıya o hâli gerçek bir testte yaptıramazsınız.
 */

export interface SchedulerClock {
  readonly requestFrame: (run: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly setTimer: (run: () => void, ms: number) => number;
  readonly clearTimer: (handle: number) => void;
}

/**
 * rAF'ın gelmesi için beklenecek en uzun süre.
 *
 * Görünür bir sekmede rAF ~16 ms'de gelir, yani bu süre normalde hiç dolmaz.
 * Dolduğunda sekme ya arka planda ya da tarayıcı çizimi kısıyordur; her iki
 * durumda da saniyede iki güncelleme, donmuş bir panodan iyidir.
 */
export const FRAME_WATCHDOG_MS = 400;

export class FrameScheduler {
  #frameHandle: number | null = null;
  #timerHandle: number | null = null;
  #flushes = 0;

  constructor(
    private readonly clock: SchedulerClock,
    private readonly flush: () => void,
    private readonly watchdogMs: number = FRAME_WATCHDOG_MS,
  ) {}

  /** Kaç kez çizim yapıldığı — testin tek ölçtüğü şey. */
  get flushes(): number {
    return this.#flushes;
  }

  get pending(): boolean {
    return this.#frameHandle !== null || this.#timerHandle !== null;
  }

  /** Bir çizim iste. Zaten bekleyen bir çizim varsa yeni bir şey kurulmaz. */
  schedule(): void {
    if (this.pending) return;
    this.#frameHandle = this.clock.requestFrame(() => {
      // Tutamağı önce boşalt: iptal sırası, çalışmış olan zamanlayıcıyı
      // iptal etmeye kalkmasın.
      this.#frameHandle = null;
      this.#run();
    });
    this.#timerHandle = this.clock.setTimer(() => {
      this.#timerHandle = null;
      this.#run();
    }, this.watchdogMs);
  }

  /**
   * Bekleyen çizimi hemen yap.
   *
   * Sekme yeniden görünür olduğunda çağrılıyor: kullanıcı panoya döndüğünde
   * ilk baktığı an güncel olmalı, bir sonraki çerçeveyi beklemeden.
   */
  flushNow(): void {
    if (!this.pending) return;
    this.#run();
  }

  /** Bileşen sökülürken: bekleyen ne varsa iptal et. */
  cancel(): void {
    if (this.#frameHandle !== null) {
      this.clock.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
    if (this.#timerHandle !== null) {
      this.clock.clearTimer(this.#timerHandle);
      this.#timerHandle = null;
    }
  }

  #run(): void {
    this.cancel();
    this.#flushes += 1;
    this.flush();
  }
}

/** Tarayıcının kendi zamanlayıcıları. */
export const browserClock: SchedulerClock = {
  requestFrame: (run) => requestAnimationFrame(run),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (handle) => window.clearTimeout(handle),
};
