import { downloadBlob } from '../../store/persistence';

/** Éléments exclus de l'image : boutons, champs et tout ce qui est marqué « no-print ». */
const clean = (n: Node) => !(n instanceof HTMLElement && (n.tagName === 'BUTTON' || n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.classList.contains('no-image')));

/** Exporte un élément de la page en PNG (2×), sans les commandes de l'interface. */
export async function nodeToPng(node: HTMLElement, name: string, background = '#ffffff'): Promise<void> {
  const { toBlob } = await import('html-to-image');
  await document.fonts.ready;
  const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: background, filter: clean });
  if (blob) downloadBlob(blob, name);
}

/** Convertit un SVG autonome en PNG (2×). */
export async function svgToPng(svg: string, name: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, ko) => {
      img.onload = () => ok();
      img.onerror = () => ko(new Error('SVG illisible'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * 2;
    canvas.height = img.naturalHeight * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    if (blob) downloadBlob(blob, name);
  } finally {
    URL.revokeObjectURL(url);
  }
}
