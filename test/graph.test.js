/**
 * The provenance graph is a view over facts `euthyna history` already emits
 * (`detail.originMethod`, `detail.blameCommit`/`detail.originCommit`,
 * `evidence.commit`). It adds no measurement, so the tests are shaped like the
 * producer's own output rather than like a renderer's wish list.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { KIND, STATUS, makeFact, makeReport, notEvaluated } from '../src/contract.js';
import { provenanceGraph } from '../src/graph.js';
import { edgeTargets } from './helpers.js';

function historyReport({ facts = [], notEvaluated: unevaluated = [] } = {}) {
  return makeReport({
    producer: 'euthyna history',
    subject: { repo: 'demo', base: 'one', head: 'two' },
    facts,
    notEvaluated: unevaluated
  });
}

function blameFact({ id, commit, lines = 3, classification = 'none', subject = 'touch up' }) {
  return makeFact({
    id,
    kind: KIND.HISTORY,
    statement: `This change deleted ${lines} lines of code from commit ${commit}`,
    status: STATUS.ESTABLISHED,
    evidence: { file: 'src/a.js', commit, files: ['src/a.js'] },
    method: 'command',
    command: `git blame --porcelain -L 10,12 two -- src/a.js`,
    detail: {
      classification,
      classificationBasis: 'none',
      originMethod: 'blame',
      commitSubject: subject,
      commitAuthor: 'a',
      commitDate: '2026-01-01',
      blamedLines: lines,
      byFile: [{ file: 'src/a.js', lines, ranges: [{ start: 10, end: 10 + lines - 1 }] }]
    }
  });
}

function originFact({ id, blameCommit, originCommit, lines = 2 }) {
  return makeFact({
    id,
    kind: KIND.HISTORY,
    statement: `This change deleted ${lines} lines whose content was first introduced by commit ${originCommit}`,
    status: STATUS.ESTABLISHED,
    evidence: { file: 'src/a.js', commit: originCommit, files: ['src/a.js'] },
    method: 'command',
    command: `git log --format=%H -S"if (x < 0) {" one -- src/a.js`,
    detail: {
      classification: 'security',
      classificationBasis: 'deleted-line',
      originMethod: 'pickaxe',
      blameCommit,
      originCommit,
      commitSubject: 'harden the bound',
      commitAuthor: 'a',
      commitDate: '2025-11-02',
      blamedLines: lines,
      byFile: [{ file: 'src/a.js', lines, ranges: [{ start: 10, end: 10 + lines - 1 }] }]
    }
  });
}

describe('a blame attribution becomes one edge from the range', () => {
  test('the range node links to the commit that owns the deleted lines', () => {
    const graph = provenanceGraph(historyReport({ facts: [blameFact({ id: 'history-1', commit: 'cafe1234beef5678' })] }));

    assert.match(graph, /^graph TD$/m, 'mermaid needs a direction declaration before any node');
    assert.match(graph, /one\.\.two/, 'the range is the root: a reader must see what was audited');
    assert.match(graph, /cafe1234/, 'the owning commit is a node');
    assert.match(graph, /-->/ , 'the attribution is an edge, not a loose list of nodes');
    assert.match(graph, /3/, 'the edge carries how many lines the attribution covers');
  });
});

describe('an origin fact becomes the lineage edge', () => {
  // The two hashes are the reason to draw a graph at all: `git blame` says who
  // last touched the deleted line, and the -S probe says who put that content
  // there. A list of facts shows both; only an edge shows that they are the
  // same line travelling from one commit to the other.
  test('the last modifier points at the commit that first introduced the content', () => {
    const graph = provenanceGraph(
      historyReport({ facts: [originFact({ id: 'history-1', blameCommit: 'aaaa1111bbbb2222', originCommit: 'cccc3333dddd4444' })] })
    );

    // Asserted as structure, not as node-id spelling: an earlier version of this
    // assertion matched `C_aaaa1111 -->`, which is a fact about how ids are
    // built, not about which commit the graph says is which.
    const lineage = edgeTargets(graph, 'aaaa1111bbbb2222').some((target) => target.includes('cccc3333dddd4444'));
    assert.equal(lineage, true, `the blame node must carry an edge to the commit that introduced the content:\n${graph}`);
    assert.equal(
      edgeTargets(graph, 'R').length,
      1,
      `the deleted lines hang off the last modifier, not off the introducer:\n${graph}`
    );
  });
});

describe('the commit subject goes into the label without breaking it', () => {
  // A git subject is attacker-influenced text in a real sense: it is whatever
  // the committed author wrote, and it lands inside a Mermaid `"..."` label.
  test('the label carries the subject', () => {
    const graph = provenanceGraph(
      historyReport({ facts: [blameFact({ id: 'history-1', commit: 'cafe1234beef5678', subject: 'touch up the parser' })] })
    );

    assert.match(graph, /touch up the parser/, 'a graph of hashes alone tells a reader nothing about why the line existed');
  });

  test('a double quote in the subject cannot open a second label', () => {
    const graph = provenanceGraph(
      historyReport({ facts: [blameFact({ id: 'history-1', commit: 'cafe1234beef5678', subject: 'add "auth" bypass check' })] })
    );

    assert.match(graph, /&quot;auth&quot;/, 'the quote is carried as an entity, so the label stays one label');
    for (const line of graph.split('\n')) {
      const quotes = (line.match(/"/g) ?? []).length;
      assert.equal(quotes % 2, 0, `every line opens as many quotes as it closes: ${line}`);
    }
  });

  test('a newline in the subject stays inside one line', () => {
    const graph = provenanceGraph(
      historyReport({ facts: [blameFact({ id: 'history-1', commit: 'cafe1234beef5678', subject: 'one line\nanother line' })] })
    );

    // header + range node + one edge. A raw newline would make the graph a
    // different graph, and Mermaid would fail the parse with no hint why.
    assert.equal(graph.split('\n').length, 3, `the subject must not add a line to the source:\n${graph}`);
    assert.match(graph, /one line\\nanother line/, 'the break is shown as \n, escaped the way the terminal boundary escapes it');
  });

  test('markup in the subject is not read as markup', () => {
    const graph = provenanceGraph(
      historyReport({ facts: [blameFact({ id: 'history-1', commit: 'cafe1234beef5678', subject: 'drop <script> & fix "x"' })] })
    );

    // Renderers that allow HTML labels turn a subject into a payload. The graph
    // carries text, so everything that opens a tag or starts an entity arrives
    // as an entity.
    assert.doesNotMatch(graph, /<script>/, 'no raw tag in the source');
    assert.match(graph, /&lt;script&gt;/, 'the angle brackets are shown, not applied');
    assert.match(graph, /&amp; fix/, 'an ampersand in the subject cannot spell an entity that was not there');
  });
});

describe('node identity', () => {
  test('two commits sharing a short prefix stay two nodes', () => {
    const graph = provenanceGraph(
      historyReport({
        facts: [
          blameFact({ id: 'history-1', commit: 'cafe1234beef5678', subject: 'first' }),
          blameFact({ id: 'history-2', commit: 'cafe1234ffff0000', subject: 'second' })
        ]
      })
    );

    // An 8-char id would merge them into one node and silently claim that two
    // commits are the same one — which is the exact failure a graph inherits from
    // a hand-written list it was supposed to replace.
    const ids = edgeTargets(graph, 'R').map((target) => target.split('[')[0]);
    assert.equal(new Set(ids).size, 2, `two commits, two nodes:\n${graph}`);
  });
});

describe('the graph says what was not measured', () => {
  // An empty graph reads as "nothing was deleted here". The producer's own
  // honesty surface is `coverage.notEvaluated`, and a reader must meet it in the
  // picture too, or the picture becomes the thing that hides the caveat.
  test('a notEvaluated entry becomes its own, visibly different edge', () => {
    const graph = provenanceGraph(
      historyReport({
        facts: [],
        notEvaluated: [notEvaluated('history-origins', 'blame 只给「最后修改」语义')]
      })
    );

    assert.match(graph, /-\.->/, 'a dotted edge separates "not measured" from an attribution');
    assert.match(graph, /history-origins/, 'the kind of the unmeasured surface is named');
    assert.match(graph, /最后修改/, 'and the reason reaches the reader instead of the count alone');
  });
});

describe('the graph says where the lines are', () => {
  test('a fact spanning several files says so', () => {
    const fact = makeFact({
      id: 'history-1',
      kind: KIND.HISTORY,
      statement: 'This change deleted 5 lines, spread across 2 files',
      status: STATUS.ESTABLISHED,
      evidence: { file: 'src/a.js', commit: 'cafe1234beef5678', files: ['src/a.js', 'src/b.js'] },
      method: 'command',
      command: 'git blame --porcelain -L 10,12 two -- src/a.js',
      detail: {
        classification: 'none',
        classificationBasis: 'none',
        originMethod: 'blame',
        commitSubject: 'spread them',
        blamedLines: 5,
        byFile: [
          { file: 'src/a.js', lines: 3, ranges: [{ start: 10, end: 12 }] },
          { file: 'src/b.js', lines: 2, ranges: [{ start: 4, end: 5 }] }
        ]
      }
    });

    const graph = provenanceGraph(historyReport({ facts: [fact] }));

    assert.match(graph, /src\/a\.js/, 'the file the pasted command reproduces');
    assert.match(graph, /\+1/, 'and how many more files the reader still has to look at');
  });
});

describe('one commit attributed twice keeps both counts', () => {
  // Found on real data, not on a fixture: a commit can be the last modifier of
  // several deleted lines in one fact and the origin of one more line in another.
  // When the count lives in the node label, Mermaid keeps the label from the last
  // declaration and silently drops the other count.
  test('the counts live on the edges and each node is declared once', () => {
    const graph = provenanceGraph(
      historyReport({
        facts: [
          blameFact({ id: 'history-1', commit: 'cafe1234beef5678', lines: 3 }),
          originFact({ id: 'history-2', blameCommit: 'ffff9999aaaa8888', originCommit: 'cafe1234beef5678', lines: 1 })
        ]
      })
    );

    assert.equal(
      (graph.match(/C_cafe1234beef5678\[/g) ?? []).length,
      1,
      `a node is declared once:\n${graph}`
    );
    assert.match(graph, /\|3\|/, 'the blame attribution carries its own count on its edge');
    assert.match(graph, /\|1\|/, 'and so does the lineage edge');
  });
});

describe('only deleted-line attribution is drawn', () => {
  // `audit` merges dependency facts into the same report, and a dependency fact
  // has no `evidence.commit`. Drawing them produced `R --> C_[""]` edges: an
  // empty node claiming to be a commit. Reproduced on `euthyna audit --graph`.
  test('a dependency fact and a reintroduction fact are not drawn', () => {
    const dependency = makeFact({
      id: 'deps-1',
      kind: KIND.DEPENDENCY,
      statement: 'left-pad is locked at 1.3.0',
      status: STATUS.ESTABLISHED,
      evidence: { file: 'package-lock.json' },
      detail: { name: 'left-pad', resolvedVersions: ['1.3.0'] }
    });
    const reintroduction = makeFact({
      id: 'history-2',
      kind: KIND.REINTRODUCTION,
      statement: 'this line was removed once and has returned',
      status: STATUS.ESTABLISHED,
      evidence: { file: 'src/a.js', commit: 'bbbb1111cccc2222' },
      detail: { commitSubject: 're-add the guard', byFile: [{ file: 'src/a.js', lines: 1, ranges: [{ start: 3, end: 3 }] }], blamedLines: 1 }
    });

    const graph = provenanceGraph(
      historyReport({ facts: [blameFact({ id: 'history-1', commit: 'cafe1234beef5678' }), dependency, reintroduction] })
    );

    assert.doesNotMatch(graph, /C_\[|C_\s|\bC_$/, 'no node with an empty commit id');
    assert.doesNotMatch(graph, /bbbb1111/, 'a reintroduced line is not a deleted-line attribution');
    assert.doesNotMatch(graph, /package-lock\.json/, 'a dependency fact is not provenance');
    assert.match(graph, /cafe1234/, 'the history fact is still drawn');
  });
});

describe('repo-controlled text in the label is neutralised wherever it appears', () => {
  // The commit subject was escaped; the file path next to it was not. Git allows
  // `"` and control bytes in a path, and a path is as much the repository's
  // content as its messages are.
  test('a double quote in a path cannot end the label early', () => {
    const fact = blameFact({ id: 'history-1', commit: 'cafe1234beef5678' });
    fact.detail.byFile = [{ file: 'src/we"ird.js', lines: 3, ranges: [{ start: 10, end: 12 }] }];
    fact.evidence.file = 'src/we"ird.js';

    const graph = provenanceGraph(historyReport({ facts: [fact] }));

    assert.match(graph, /we&quot;ird\.js/, 'the path is escaped the same way the subject is');
    for (const line of graph.split('\n')) {
      assert.equal((line.match(/"/g) ?? []).length % 2, 0, `no line may open more quotes than it closes: ${line}`);
    }
  });

  test('a control byte in a path does not reach the output', () => {
    const fact = blameFact({ id: 'history-1', commit: 'cafe1234beef5678' });
    fact.detail.byFile = [{ file: 'src/bel' + String.fromCharCode(7) + '.js', lines: 3, ranges: [{ start: 10, end: 12 }] }];

    const graph = provenanceGraph(historyReport({ facts: [fact] }));

    assert.doesNotMatch(graph, new RegExp(String.fromCharCode(7)), 'the graph is terminal output too');
  });

  test('a hash in the subject cannot spell a Mermaid entity', () => {
    // Mermaid reads `#123;` and `#name;` inside a label as an entity, so a subject
    // like `fix #123; the parser` would display a character nobody wrote. Not
    // measured against a Mermaid renderer here — the escape costs nothing.
    const graph = provenanceGraph(
      historyReport({ facts: [blameFact({ id: 'history-1', commit: 'cafe1234beef5678', subject: 'fix #123; the parser' })] })
    );

    assert.doesNotMatch(graph, /#123;/, 'the raw numeric entity must not appear');
    assert.match(graph, /#35;123;/, 'the hash arrives in the form Mermaid decodes back to a hash');
  });
});

describe('the graph carries states, not verdicts', () => {
  // A lock, not a discovery: the fact contract reserves severity, score and risk
  // for the adjudication layer (docs/fact-contract.md §3.3, enforced on facts by
  // src/contract.js FORBIDDEN_KEYS). A node coloured by "how dangerous" would
  // make that claim false in the one output a reader trusts most.
  test('no adjudication-layer attribute is emitted', () => {
    const graph = provenanceGraph(
      historyReport({
        facts: [
          blameFact({ id: 'history-1', commit: 'cafe1234beef5678', classification: 'security', subject: 'remove the check' }),
          blameFact({ id: 'history-2', commit: 'ffff0000beef5678', classification: 'none', subject: 'rename' })
        ]
      })
    );

    for (const forbidden of ['severity=', 'risk=', 'score=', 'confidence_score=', 'remediation=']) {
      assert.doesNotMatch(graph, new RegExp(forbidden.replace(/=/g, '\\=')), `the graph must not state ${forbidden}`);
    }
    assert.doesNotMatch(graph, /fillcolor/, 'and must not even colour a node by what it thinks');
  });
});
