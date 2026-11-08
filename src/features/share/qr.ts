import qrcode from 'qrcode-generator';

/** QR code en tracé SVG (un carré par module sombre), avec sa marge de silence de 4 modules. */
export function qrPath(text: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let path = '';
  for (let r = 0; r < n; r++) {
    // Modules sombres consécutifs d'une ligne réunis en un seul rectangle.
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let k = c;
      while (k + 1 < n && qr.isDark(r, k + 1)) k++;
      path += `M${c + quiet} ${r + quiet}h${k - c + 1}v1h${-(k - c + 1)}z`;
      c = k;
    }
  }
  return { size: n + quiet * 2, path };
}
