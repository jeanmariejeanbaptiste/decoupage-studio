import { parseFountain } from './fountain';

/**
 * Scénario en Markdown, pour qu'une IA le lise sans peine : séquences numérotées en titres, actions en
 * paragraphes, répliques sous le nom du personnage. Notes et surlignages de révision (« [[…]] ») ne
 * passent pas, comme à l'impression.
 */
export function scriptToMarkdown(source: string, title?: string): string {
  const clean = (t: string) => t.replace(/\[\[[^\]]*\]\]/g, '').replace(/[ \t]+/g, ' ').trim();
  const out: string[] = [];
  if (title?.trim()) out.push(`# ${title.trim()}`, '');
  let n = 0;
  let speaking = false;
  for (const el of parseFountain(source)) {
    const text = clean(el.text);
    if (el.type === 'note' || el.type === 'synopsis' || el.type === 'section' || el.type === 'title' || el.type === 'pagebreak') continue;
    if (!text) continue;
    if (el.type !== 'dialogue' && el.type !== 'parenthetical' && speaking) {
      out.push('');
      speaking = false;
    }
    switch (el.type) {
      case 'heading':
        out.push(`## ${++n}. ${text.toUpperCase()}`, '');
        break;
      case 'character':
        out.push(`**${text.toUpperCase()}**`);
        speaking = true;
        break;
      case 'parenthetical':
        out.push(`> ${text.startsWith('(') ? text : `(${text})`}`);
        break;
      case 'dialogue':
        out.push(`> ${text.replace(/\n/g, '\n> ')}`);
        break;
      case 'transition':
        out.push(`*${text.toUpperCase()}*`, '');
        break;
      default:
        out.push(text, '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
