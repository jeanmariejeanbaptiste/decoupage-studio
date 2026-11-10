import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Music, Pause, Play, Upload } from 'lucide-react';
import { formatRange, formatTc } from '../../domain/timecode';
import type { ID, ProjectDoc } from '../../domain/types';
import { computePeaks, dragRange, secToX, ticks, xToSec } from '../../domain/waveform';
import { getBlob, putBlob } from '../../store/db';
import { pickFile } from '../../store/persistence';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { shotAtRow } from './actions';
import s from './TrackBar.module.css';

const BUCKETS = 900;

async function decode(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
}

/** Mode piste (§6.3) : forme d'onde, plages des actions, sélection par glisser, lecture d'extrait. */
export function TrackBar({ doc }: { doc: ProjectDoc }) {
  const track = doc.project.settings.audioTrack;
  const duration = track?.durationSec ?? 0;
  const selection = useUi((u) => u.selection);
  const toast = useUi((u) => u.toast);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  // Glissement en cours ; `moved` : au-delà de quelques pixels (en deçà, c'est un clic sur la piste).
  const [drag, setDrag] = useState<{ a: number; b: number; x0: number; moved: boolean } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);

  const shotId = selection ? shotAtRow(doc, selection.focus.row) : undefined;
  const blockId: ID | undefined = shotId ? doc.shots[shotId]?.actionBlockId : undefined;
  const block = blockId ? doc.blocks[blockId] : undefined;

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setPeaks(null);
    setUrl(null);
    if (!track?.blobKey) return;
    void getBlob(track.blobKey).then(async (blob) => {
      if (!blob || !alive) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      try {
        const buf = await decode(blob);
        if (alive) setPeaks(computePeaks(buf.getChannelData(0), BUCKETS));
      } catch {
        /* forme d'onde indisponible : la barre reste utilisable */
      }
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [track?.blobKey]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * devicePixelRatio;
    c.height = h * devicePixelRatio;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.clearRect(0, 0, w, h);
    const ink = getComputedStyle(c).color;
    g.fillStyle = ink;
    if (!peaks) {
      g.globalAlpha = 0.35;
      g.fillRect(0, h / 2, w, 1);
      return;
    }
    g.globalAlpha = 0.55;
    const step = w / peaks.length;
    peaks.forEach((p, i) => {
      const bh = Math.max(1, p * (h - 6));
      g.fillRect(i * step, (h - bh) / 2, Math.max(1, step - 0.4), bh);
    });
  }, [peaks]);

  const ranges = useMemo(
    () =>
      Object.values(doc.blocks)
        .filter((b) => b.tc && (b.tc.all || (b.tc.in !== undefined && b.tc.out !== undefined)))
        .map((b) => ({ id: b.id, in: b.tc!.all ? 0 : b.tc!.in!, out: b.tc!.all ? duration : b.tc!.out! })),
    [doc.blocks, duration],
  );

  const importAudio = async () => {
    const f = await pickFile('audio/*', false);
    if (!f) return;
    let buf: AudioBuffer;
    try {
      buf = await decode(f);
    } catch {
      toast({ message: 'Ce fichier audio n’a pas pu être lu.', tone: 'warn' });
      return;
    }
    let key: string;
    try {
      key = await putBlob(doc.project.id, f.name, f);
    } catch (e) {
      const quota = (e as { name?: string; inner?: { name?: string } } | null)?.name === 'QuotaExceededError' || (e as { inner?: { name?: string } } | null)?.inner?.name === 'QuotaExceededError';
      toast({ message: quota ? 'Stockage du navigateur plein : piste non importée.' : 'Piste non importée : le navigateur n’a pas pu l’enregistrer.', tone: 'warn' });
      return;
    }
    mutateDoc((d) => {
      d.project.settings.audioTrack = { name: f.name, durationSec: Math.round(buf.duration), blobKey: key };
    });
    toast({ message: `Piste « ${f.name} » importée (${formatTc(buf.duration)}).` });
  };

  const secAt = (e: PointerEvent) => {
    const r = areaRef.current!.getBoundingClientRect();
    return xToSec(e.clientX - r.left, r.width, duration);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = secAt(e);
    setDrag({ a: t, b: t, x0: e.clientX, moved: false });
  };
  const onMove = (e: PointerEvent) => drag && setDrag({ ...drag, b: secAt(e), moved: drag.moved || Math.abs(e.clientX - drag.x0) >= 4 });
  const onUp = () => {
    if (!drag) return;
    setDrag(null);
    // Simple clic : la tête de lecture se place, la plage calée ne change pas.
    if (!drag.moved) {
      const a = audioRef.current;
      if (a && url) {
        a.currentTime = drag.a;
        setPlayhead(drag.a);
      }
      return;
    }
    // Glisser sans plan sélectionné : rien à caler.
    if (!blockId) return;
    const r = dragRange(drag.a, drag.b, duration);
    mutateDoc((d) => {
      if (d.blocks[blockId]) d.blocks[blockId].tc = r;
    });
  };

  const play = (from: number, to: number | null) => {
    const a = audioRef.current;
    if (!a || !url) return;
    a.currentTime = from;
    stopAt.current = to;
    void a.play();
  };

  const playBlock = () => {
    if (!block?.tc) return;
    if (block.tc.all) play(0, null);
    else if (block.tc.in !== undefined) play(block.tc.in, block.tc.out ?? null);
  };

  const live = drag?.moved && blockId ? dragRange(drag.a, drag.b, duration) : null;

  return (
    <section className={s.bar} aria-label="Piste audio" data-testid="track-bar">
      <div className={s.head}>
        <Music size={15} strokeWidth={1.25} />
        <span className={s.name}>{track ? track.name : 'Aucune piste'}</span>
        {track && <span className="mono">{formatTc(duration)}</span>}
        <span className={s.hint}>
          {block && (
            <>
              action sélectionnée : <b>{block.text || 'sans texte'}</b> · <span className="mono">{formatRange(block.tc) || '—'}</span>
            </>
          )}
        </span>
        <span className={s.tools}>
          {url && (
            <>
              <Button size="sm" icon={<Play size={13} />} onClick={playBlock} disabled={!block?.tc} title="Écouter l’extrait de l’action">
                Extrait
              </Button>
              <Button
                size="sm"
                variant="icon"
                aria-label={playing ? 'Pause' : 'Lecture'}
                icon={playing ? <Pause size={13} /> : <Play size={13} />}
                onClick={() => (playing ? audioRef.current?.pause() : play(audioRef.current?.currentTime ?? 0, null))}
              />
            </>
          )}
          <Button size="sm" variant="outline" icon={<Upload size={13} />} onClick={importAudio}>
            {track?.blobKey ? 'Remplacer la piste' : 'Importer la piste'}
          </Button>
        </span>
      </div>
      {duration > 0 ? (
        <div
          ref={areaRef}
          className={s.area}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
          data-testid="waveform"
          role="slider"
          aria-label="Plage de l’action dans la piste"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={block?.tc?.in ?? 0}
          aria-valuetext={formatRange(block?.tc)}
          tabIndex={-1}
        >
          <canvas ref={canvasRef} className={s.canvas} />
          {ranges.map((r) => (
            <span
              key={r.id}
              className={[s.range, r.id === blockId ? s.current : ''].join(' ')}
              style={{ left: `${secToX(r.in, 100, duration)}%`, width: `${secToX(r.out - r.in, 100, duration)}%` }}
            />
          ))}
          {live && <span className={[s.range, s.live].join(' ')} style={{ left: `${secToX(live.in, 100, duration)}%`, width: `${secToX(live.out - live.in, 100, duration)}%` }} />}
          {playhead !== null && <span className={s.playhead} style={{ left: `${secToX(playhead, 100, duration)}%` }} />}
          {ticks(duration).map((t) => (
            <span key={t} className={s.tick} style={{ left: `${secToX(t, 100, duration)}%` }}>
              {formatTc(t)}
            </span>
          ))}
        </div>
      ) : null}
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setPlayhead(t);
            if (stopAt.current !== null && t >= stopAt.current) {
              e.currentTarget.pause();
              stopAt.current = null;
            }
          }}
        />
      )}
    </section>
  );
}
