import { wordHtml, type DocPage } from '../../domain/documents';
import { downloadBlob } from '../../store/persistence';

/** Document Word (.doc) : HTML que Word, Pages et LibreOffice ouvrent directement. */
export function downloadWord(page: DocPage, fileBase: string, orientation?: 'portrait' | 'landscape'): void {
  downloadBlob(new Blob(['\uFEFF', wordHtml(page, orientation)], { type: 'application/msword' }), `${fileBase}.doc`);
}
