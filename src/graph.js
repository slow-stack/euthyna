import { KIND, safeText } from './contract.js';

/**
 * A Mermaid view over the provenance facts `euthyna history` already emits.
 *
 * It measures nothing. A commit subject is whatever an author wrote, and it
 * lands inside a `"..."` label, so every label goes through the same control-byte
 * escape the terminal boundary uses before it reaches the graph source.
 *
 * Line counts live on the edges: one commit can be attributed twice (the last
 * modifier of some lines, the origin of others), and a Mermaid node keeps only
 * the last label written for an id — a count in the node label would silently
 * delete the other one.
 */
export function provenanceGraph(report) {
  const { subject, facts } = report;
  const short = (hash) => (hash ?? '').slice(0, 8);
  // The id is the full hash: two commits that share a prefix are two commits,
  // and a merged node would say otherwise without saying anything.
  const id = (hash) => `C_${hash ?? ''}`;
  // `&` first, so the entities added next are not doubled into nothing; then `#`,
  // because Mermaid reads `#123;` and `#name;` inside a label as an entity.
  const escapeLabel = (text) =>
    text.replace(/&/g, '&amp;').replace(/#/g, '#35;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // `detail.commitSubject` belongs to `evidence.commit`, which is the origin
  // commit on a pickaxe fact and the owning commit on a blame fact. Only
  // deleted-line attribution counts: `audit` merges dependency facts in here too.
  const subjects = new Map();
  for (const fact of facts) {
    if (fact.kind === KIND.HISTORY && fact.detail?.commitSubject) subjects.set(fact.evidence?.commit, fact.detail.commitSubject);
  }

  const declared = new Set(['R']);
  const node = (hash, byFile) => {
    const key = id(hash);
    if (declared.has(key)) return key;
    declared.add(key);
    const text = subjects.get(hash) ?? '';
    const rest = byFile.length > 1 ? ` +${byFile.length - 1}` : '';
    const where = byFile.length ? ` ${byFile[0].file}${rest}` : '';
    // One pass over the whole label: the path is as much the repository's own
    // text as the commit subject is, and it may contain `"` or a control byte.
    return `${key}["${escapeLabel(safeText(`${short(hash)}${where}${text ? ` ${text}` : ''}`))}"]`;
  };

  const range = `${subject.base ?? '?'}..${subject.head ?? 'HEAD'}`;
  const out = ['graph TD', `  R["${escapeLabel(safeText(range))}"]`];

  for (const fact of facts) {
    // A dependency fact has no commit: drawing it would emit a node with an empty
    // id that reads as "a commit with no lines".
    if (fact.kind !== KIND.HISTORY) continue;
    const detail = fact.detail ?? {};
    const origin = detail.originMethod === 'pickaxe' ? detail.originCommit : null;
    // The deleted lines hang off whoever last touched them inside the audited
    // range; the origin commit is where the content came from.
    const blamed = origin ? detail.blameCommit : fact.evidence?.commit;
    const byFile = detail.byFile ?? [];
    const count = detail.blamedLines ?? 0;

    out.push(`  R -->|${count}| ${node(blamed, byFile)}`);
    if (origin) out.push(`  ${id(blamed)} -->|${count}| ${node(origin, byFile)}`);
  }

  // Dotted, and named by kind: `nothing here was deleted` and `this could not be
  // measured` look the same once the facts are gone.
  for (const [n, item] of (report.coverage?.notEvaluated ?? []).entries()) {
    out.push(`  R -.-> U_${n}["${escapeLabel(safeText(`${item.kind}: ${item.reason}`))}"]`);
  }

  return out.join('\n');
}
