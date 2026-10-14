import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { applyProposal } from '../../domain/assistant';
import { sequenceHeading } from '../../domain/numbering';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc, undo } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { ask } from '../../ui/dialogStore';
import { currentShotId } from '../grid/actions';
import { getApiKey, proposeShots } from './aiClient';

/** « Proposer un découpage » : désactivé proprement sans clé API (§15.6). */
export function AssistantButton({ doc }: { doc: ProjectDoc }) {
  const [busy, setBusy] = useState(false);
  const hasKey = !!getApiKey();
  const toast = useUi((u) => u.toast);
  const run = async () => {
    const cur = currentShotId();
    const seqId = (cur && doc.shots[cur]?.sequenceId) || doc.project.sequenceIds[0];
    if (!seqId) return;
    const ok = await ask({
      title: `Proposer un découpage pour ${sequenceHeading(doc, seqId)} ?`,
      body: 'Le texte de la séquence est envoyé à l’API Claude avec votre clé. Les plans proposés sont ajoutés en fin de séquence (annulable).',
      confirmLabel: 'Proposer',
    });
    if (!ok.ok) return;
    setBusy(true);
    try {
      const shots = await proposeShots(doc, seqId);
      mutateDoc((d) => applyProposal(d, seqId, shots));
      toast({ message: `${shots.length} plans proposés ajoutés.`, actionLabel: 'Annuler', action: undo });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      icon={<Wand2 size={15} strokeWidth={1.25} />}
      onClick={run}
      disabled={!hasKey || busy}
      title={hasKey ? 'Proposer un découpage de départ (assistant facultatif)' : 'Assistant désactivé : ajoutez une clé API dans les Réglages'}
      data-testid="assistant"
    >
      {busy ? 'Proposition…' : 'Proposer'}
    </Button>
  );
}
