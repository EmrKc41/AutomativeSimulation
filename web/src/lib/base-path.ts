/**
 * Sitenin kök yolu ve ona göre dosya adresi üreten yardımcı.
 *
 * GitHub Pages siteyi `/<depo>/` altında sunuyor. Next bazı yerlerde bu ön eki
 * kendisi ekliyor ama her yerde değil: `useGLTF` ham bir `fetch` yapıyor ve
 * `<Image>` de statik dışa aktarımda logoyu ön eksiz istedi — ikisi de yayında
 * 404 verdi.
 *
 * Tahmin etmek yerine ön eki **açıkça** koyuyoruz. Yerelde boş bir dizge, yani
 * geliştirme akışı değişmiyor.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function assetUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}
