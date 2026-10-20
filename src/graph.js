import { safeText } from './contract.js';

/**
 * A Mermaid view over the provenance facts `euthyna history` already emits.
 *
 * It measures nothing. A commit subject is whatever an author wrote, and it
 * lands inside a `"..."` label, so every label goes through the same control-byte
 * escape the terminal boundary uses before it reaches the graph source.
 */
export function provenanceGraph(report) {
  const { subject, facts } = report;
  const short = (hash) => (hash ?? '').slice(0, 8);
  // The id is the full hash: two commits that share a prefix are two commits,
  // and a merged node would say otherwise without saying anything.
  const id = (hash) => `C_${hash ?? ''}`;
  // `&` first, so the entities added next are not doubled into nothing.
  const escapeLabel = (text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // `detail.commitSubject` belongs to `evidence.commit`, which is the origin
  // commit on a pickaxe fact and the owning commit on a blame fact.
  const subjects = new Map();
  for (const fact of facts) {
    if (fact.detail?.commitSubject) subjects.set(fact.evidence?.commit, fact.detail.commitSubject);
  }
  const label = (hash, count, fact) => {
    const text = escapeLabel(safeText(subjects.get(hash) ?? ''));
    const byFile = fact?.detail?.byFile ?? [];
    const rest = byFile.length > 1 ? ` +${byFile.length - 1}` : '';
    const where = byFile.length ? ` ${byFile[0].file}${rest}` : '';
    return `"${short(hash)} (${count})${where}${text ? ` ${text}` : ''}"`;
  };

  const range = `${subject.base ?? '?'}..${subject.head ?? 'HEAD'}`;
  const out = ['graph TD', `  R["${range}"]`];

  for (const fact of facts) {
    const detail = fact.detail ?? {};
    const origin = detail.originMethod === 'pickaxe' ? detail.originCommit : null;
    // The deleted lines hang off whoever last touched them inside the audited
    // range; the origin commit is where the content came from.
    const blamed = origin ? detail.blameCommit : fact.evidence?.commit;
    const count = detail.blamedLines ?? 0;

    out.push(`  R --> ${id(blamed)}[${label(blamed, count, fact)}]`);
    if (origin) out.push(`  ${id(blamed)} --> ${id(origin)}[${label(origin, count, fact)}]`);
  }

  // Dotted, and named by kind: `nothing here was deleted` and `this could not be
  // measured` look the same once the facts are gone.
  for (const [n, item] of (report.coverage?.notEvaluated ?? []).entries()) {
    out.push(`  R -.-> U_${n}["${escapeLabel(safeText(`${item.kind}: ${item.reason}`))}"]`);
  }

  return out.join('\n');
}
