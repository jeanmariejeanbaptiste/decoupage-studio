import { useEffect, useState } from 'react';
import { Check, Copy, QrCode } from 'lucide-react';
import { REVIEW_ENABLED } from '../../app/config';
import { navigate, useLocation } from '../../app/router';
import type { ProjectDoc } from '../../domain/types';
import { activeVersion } from '../../domain/versions';
import { openReview, publishReview, reviewLink, setReviewLink, useReview } from '../../store/review';
import { Button } from '../../ui/Button';
import { QrScreen } from '../share/QrScreen';
import s from '../share/Share.module.css';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Relecture en ligne, dans le panneau Partager : publier la version courante dans Google Drive,
 * donner le lien (QR code), arrêter ou reprendre. N'apparaît que si Google est configuré.
 */
export function ReviewSection({ doc }: { doc: ProjectDoc }) {
  const st = useReview();
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  if (!REVIEW_ENABLED) return null;
  const pub = doc.review;
  const name = activeVersion(doc)?.name ?? doc.project.version ?? 'V1';
  const published = pub ? (doc.versions?.find((v) => v.id === pub.publishedVersionId)?.name ?? name) : '';
  const link = pub ? reviewLink(pub) : '';
  const busy = st.busy !== null;
  return (
    <section className={s.review} aria-label="Relecture en ligne" data-testid="review-section">
      <p className={s.sectionTitle}>Relecture en ligne</p>
      {pub && (
        <>
          <div className={[s.secret, s.linkRow].join(' ')}>
            <code className={pub.stopped ? s.off : undefined} data-testid="review-link">
              {link}
            </code>
            {!pub.stopped && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(link).catch(() => undefined);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  }}
                  aria-label="Copier le lien de relecture"
                  title="Copier"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <button type="button" onClick={() => setQr(true)} aria-label="QR code de la relecture" title="QR code" data-testid="review-qr">
                  <QrCode size={13} strokeWidth={1.25} />
                </button>
              </>
            )}
          </div>
          <p className={s.note} data-testid="review-state">
            {published} publiée le {dateFmt.format(new Date(pub.publishedAt))}
            {pub.stopped ? ' · lien arrêté' : ''}
          </p>
        </>
      )}
      {st.error && <p className={s.error}>{st.error}</p>}
      <div className={s.actions}>
        <Button size="sm" variant={pub ? 'outline' : 'primary'} disabled={busy} onClick={() => void publishReview()} data-testid="review-publish">
          {st.busy === 'publish' ? 'Publication…' : pub?.publishedVersionId === doc.activeVersionId ? `Mettre à jour ${name}` : `Publier ${name}`}
        </Button>
        {pub && (
          <Button size="sm" disabled={busy} onClick={() => void setReviewLink(!!pub.stopped)} data-testid="review-stop">
            {pub.stopped ? 'Reprendre' : 'Arrêter'}
          </Button>
        )}
      </div>
      {qr && pub && !pub.stopped && <QrScreen link={link} label="QR code de la relecture" onClose={() => setQr(false)} />}
    </section>
  );
}

/** Page d'arrivée d'un relecteur : le lien s'ouvre (sans compte), puis le découpage. */
export function ReviewPage() {
  const { params } = useLocation();
  const file = params.get('file') ?? '';
  const st = useReview();
  useEffect(() => {
    let alive = true;
    void openReview(file).then((ok) => alive && ok && navigate('grid'));
    return () => {
      alive = false;
    };
  }, [file]);
  const failed = st.phase === 'error';
  return (
    <div className="page">
      <div className={['card', s.join].join(' ')} role="status" data-testid="review-landing">
        <h1 className={s.joinTitle}>Relecture</h1>
        {failed ? <p className={s.error}>{st.loadError}</p> : <p className={s.note}>Ouverture…</p>}
        {failed && (
          <Button variant="outline" onClick={() => navigate('home')}>
            Aller à l’accueil
          </Button>
        )}
      </div>
    </div>
  );
}
