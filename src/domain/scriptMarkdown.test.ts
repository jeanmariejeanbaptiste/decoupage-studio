import { describe, expect, it } from 'vitest';
import { scriptToMarkdown } from './scriptMarkdown';

describe('scénario en Markdown', () => {
  it('séquences numérotées, actions, répliques ; sans notes ni surlignage', () => {
    const md = scriptToMarkdown(['INT. GARE - JOUR', '', 'Léa entre. [[note privée]]', '', 'LÉA', '(bas)', 'Bonjour.', '', 'EXT. RUE - NUIT', '', 'Il pleut.', '', 'CUT TO:'].join('\n'), 'La Consigne');
    expect(md).toBe(['# La Consigne', '', '## 1. INT. GARE - JOUR', '', 'Léa entre.', '', '**LÉA**', '> (bas)', '> Bonjour.', '', '## 2. EXT. RUE - NUIT', '', 'Il pleut.', '', '*CUT TO:*', ''].join('\n'));
  });
});
