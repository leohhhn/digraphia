import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type PublicClient,
} from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import {
  planCounterparts,
  verifyLink,
  LINK_KEY,
  type CounterpartPlan,
  type Candidate,
  type VerifyResult,
} from '@digraphia/core';

/* ------------------------------------------------------------------ chains */

// Public endpoints are the default so a fresh clone works with no setup, but
// they rate-limit - which is exactly what happens when a room full of people
// loads the same demo at once. Override per deployment.
const CHAINS = {
  sepolia: {
    chain: sepolia,
    rpc: import.meta.env.VITE_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  mainnet: {
    chain: mainnet,
    rpc: import.meta.env.VITE_MAINNET_RPC || 'https://eth.drpc.org',
  },
} as const;
type ChainKey = keyof typeof CHAINS;

let chainKey: ChainKey = 'sepolia';
const publicClient = (): PublicClient =>
  createPublicClient({
    chain: CHAINS[chainKey].chain,
    transport: http(CHAINS[chainKey].rpc),
  }) as PublicClient;

/* ------------------------------------------------------------------- state */

/** What the chain says about one name, independent of any link. */
interface Probe {
  resolver: Address | null;
  addr: Address | null;
  linkRecord: string | null;
}

interface State {
  input: string;
  plan: CounterpartPlan | null;
  planError: string | null;
  sourceProbe: Probe | null;
  probes: Map<string, Probe>;
  selected: string | null;
  result: VerifyResult | null;
  busy: string | null;
  account: Address | null;
  txNote: string | null;
  txError: string | null;
  lastChecked: Date | null;
  polling: boolean;
  /** Set for one render when the view should jump to the tool. */
  scrollToTool: boolean;
}

const state: State = {
  input: '',
  plan: null,
  planError: null,
  sourceProbe: null,
  probes: new Map(),
  selected: null,
  result: null,
  busy: null,
  account: null,
  txNote: null,
  txError: null,
  lastChecked: null,
  polling: false,
  scrollToTool: false,
};

/* ------------------------------------------------------------------- chain */

const ZERO = '0x0000000000000000000000000000000000000000';

/** Zero-address and empty-string are both "absent" - normalise them to null. */
const orNull = <T extends string>(v: T | null | undefined): T | null =>
  !v || v === ZERO ? null : v;

async function probe(client: PublicClient, name: string): Promise<Probe> {
  // getEnsResolver returns the ZERO ADDRESS for an unregistered name rather
  // than throwing or returning null, so a truthiness check is not enough.
  const [resolver, addr, linkRecord] = await Promise.all([
    client.getEnsResolver({ name }).catch(() => null),
    client.getEnsAddress({ name }).catch(() => null),
    client.getEnsText({ name, key: LINK_KEY }).catch(() => null),
  ]);
  return {
    resolver: orNull(resolver),
    addr: orNull(addr),
    linkRecord: linkRecord || null,
  };
}

const SET_TEXT_ABI = [
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
] as const;

/* ------------------------------------------------------------------ polling */

/**
 * Records land a block or two after the wallet returns, and a link may also be
 * completed from somewhere else entirely - the other half of a pair is often
 * held in a different wallet. So once a pair is under inspection we re-read it
 * on a timer instead of making the user retype the name.
 *
 * Two rules keep this cheap and non-disruptive:
 *   - a tick that finds nothing changed does NOT re-render, it only updates
 *     the timestamp, so typing and selection are never interrupted
 *   - polling stops the moment the link verifies; there is nothing left to see
 */
const POLL_MS = 12_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Compact fingerprint of a result, to detect real change. */
const signature = (r: VerifyResult | null) =>
  r ? `${r.linked}|${r.checks.map((c) => `${c.id}:${c.ok}`).join(',')}` : '';

function stopPolling() {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  state.polling = false;
}

function startPolling() {
  stopPolling();
  state.polling = true;
  pollTimer = setInterval(tick, POLL_MS);
}

async function tick() {
  // Skip while a write is in flight, or while the tab is in the background.
  if (!state.plan || !state.selected || state.busy || document.hidden) return;
  if (state.result?.linked) return stopPolling();

  const client = publicClient();
  const a = state.plan.normalized;
  const b = state.selected;
  try {
    const [result, src, cand] = await Promise.all([
      verifyLink(client, a, b),
      probe(client, a),
      probe(client, b),
    ]);
    // A stale response from a poll issued before the user moved on.
    if (state.plan?.normalized !== a || state.selected !== b) return;

    const changed = signature(result) !== signature(state.result);
    state.result = result;
    state.sourceProbe = src;
    state.probes.set(b, cand);
    state.lastChecked = new Date();
    if (result.linked) stopPolling();
    if (changed) render();
    else updateStamp();
  } catch {
    // A dropped RPC read is not worth surfacing - the next tick retries.
  }
}

function pollStampText(): string {
  if (state.result?.linked) return 'Linked — polling stopped.';
  const at = state.lastChecked
    ? ` · last checked ${state.lastChecked.toLocaleTimeString()}`
    : '';
  return state.polling ? `Auto-checking every ${POLL_MS / 1000}s${at}` : `Not polling${at}`;
}

function updateStamp() {
  const el = document.getElementById('poll-stamp');
  if (el) el.textContent = pollStampText();
}

/* ------------------------------------------------------------------ actions */

async function analyze() {
  stopPolling();
  state.lastChecked = null;
  state.planError = null;
  state.plan = null;
  state.selected = null;
  state.result = null;
  state.probes = new Map();
  state.sourceProbe = null;
  state.txNote = state.txError = null;

  const raw = state.input.trim().replace(/\.$/, '');
  if (!raw) return render();
  // A bare label has no resolver - every name in ENS needs a TLD. Assume .eth
  // rather than silently planning against names that cannot resolve.
  const qualified = raw.includes('.') ? raw : `${raw}.eth`;

  try {
    state.plan = planCounterparts(qualified);
  } catch (err) {
    state.planError = err instanceof Error ? err.message : String(err);
    return render();
  }

  state.busy = 'Reading the chain…';
  state.scrollToTool = true;
  render();

  const client = publicClient();
  const plan = state.plan!;
  try {
    const [src, ...rest] = await Promise.all([
      probe(client, plan.normalized),
      ...plan.candidates
        .filter((c) => c.registrable)
        .map((c) => probe(client, c.name).then((p) => [c.name, p] as const)),
    ]);
    state.sourceProbe = src as Probe;
    for (const entry of rest as ReadonlyArray<readonly [string, Probe]>) {
      state.probes.set(entry[0], entry[1]);
    }
    // If exactly one candidate actually resolves, pre-select it.
    const live = [...state.probes.entries()].filter(([, p]) => p.resolver);
    if (live.length === 1) {
      state.selected = live[0][0];
      await runVerify();
      return;
    }
  } catch (err) {
    state.planError = err instanceof Error ? err.message : String(err);
  }
  state.busy = null;
  render();
}

async function select(name: string) {
  state.selected = name;
  state.txNote = state.txError = null;
  await runVerify();
}

async function runVerify() {
  if (!state.plan || !state.selected) return;
  state.busy = 'Verifying the link…';
  state.result = null;
  render();
  try {
    state.result = await verifyLink(publicClient(), state.plan.normalized, state.selected);
  } catch (err) {
    state.planError = err instanceof Error ? err.message : String(err);
  }
  state.lastChecked = new Date();
  state.busy = null;
  if (!state.result?.linked) startPolling();
  render();
}

async function connect() {
  const eth = (window as any).ethereum;
  if (!eth) {
    state.txError = 'No injected wallet found. Install MetaMask, or set the records in the ENS app.';
    return render();
  }
  try {
    const accounts: Address[] = await eth.request({ method: 'eth_requestAccounts' });
    state.account = accounts[0] ?? null;
    const want = CHAINS[chainKey].chain.id;
    const current = Number(await eth.request({ method: 'eth_chainId' }));
    if (current !== want) {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + want.toString(16) }],
      });
    }
    state.txError = null;
  } catch (err: any) {
    state.txError = err?.shortMessage ?? err?.message ?? String(err);
  }
  render();
}

/** Write one half of the assertion: `on` gets a record pointing at `to`. */
async function assert(on: string, to: string) {
  const eth = (window as any).ethereum;
  if (!eth || !state.account) return connect();

  state.busy = `Writing the link record on ${on}…`;
  state.txNote = state.txError = null;
  render();

  try {
    const client = publicClient();
    const resolver = orNull(await client.getEnsResolver({ name: on }).catch(() => null));
    if (!resolver) {
      throw new Error(
        `${on} has no resolver on ${chainKey} — it is probably not registered there. ` +
        `Note that a bare label needs a TLD: "djordje" is not a name, "djordje.eth" is.`,
      );
    }

    const { namehash } = await import('viem/ens');
    const wallet = createWalletClient({
      chain: CHAINS[chainKey].chain,
      transport: custom(eth),
      account: state.account,
    });
    const hash = await wallet.writeContract({
      address: resolver,
      abi: SET_TEXT_ABI,
      functionName: 'setText',
      args: [namehash(on), LINK_KEY, to],
    });
    state.busy = 'Waiting for confirmation…';
    render();
    await client.waitForTransactionReceipt({ hash });
    state.txNote = `${on} now asserts ${to}. (tx ${hash.slice(0, 10)}…)`;
    await runVerify();
    return;
  } catch (err: any) {
    state.txError = err?.shortMessage ?? err?.message ?? String(err);
  }
  state.busy = null;
  render();
}

/* ------------------------------------------------------------------ render */

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The library names the concrete record key in its evidence strings, which is
 * right for a developer reading a terminal. On the page it is noise - the
 * reader cares that a link record exists, not what it is called.
 */
const humanise = (s: string) => s.split(LINK_KEY).join('link record');
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

function candidateRow(c: Candidate, plan: CounterpartPlan): string {
  if (!c.registrable) {
    return `<div class="cand dead">
      <div>
        <div class="name">${esc(c.label)}${plan.suffix ? '.' + esc(plan.suffix) : ''}</div>
        <div class="meta">ENSIP-15 rejects this: ${esc(c.error ?? '')}</div>
      </div>
      <div class="right"><span class="pill bad">unregistrable</span></div>
    </div>`;
  }

  const p = state.probes.get(c.name);
  const live = !!p?.resolver;
  const sameAddr =
    !!p?.addr && !!state.sourceProbe?.addr &&
    p.addr.toLowerCase() === state.sourceProbe.addr.toLowerCase();

  const pills = [
    live ? `<span class="pill ok">resolves</span>` : `<span class="pill dim">no resolver</span>`,
    sameAddr ? `<span class="pill ok">same address</span>` : '',
    p?.linkRecord ? `<span class="pill note">has link record</span>` : '',
  ].filter(Boolean).join(' ');

  return `<div class="cand" data-name="${esc(c.name)}" aria-selected="${state.selected === c.name}">
    <div>
      <div class="name">${esc(c.name)}</div>
      <div class="meta">${esc(c.script ?? '')} · addr ${esc(short(p?.addr))}${
        p?.linkRecord ? ` · links to ${esc(p.linkRecord)}` : ''
      }</div>
    </div>
    <div class="right">${pills}</div>
  </div>`;
}

function planPanel(): string {
  const plan = state.plan;
  if (!plan) return '';

  const ambiguous = !plan.deterministic;
  const usable = plan.candidates.filter((c) => c.registrable);

  let head = '';
  if (plan.direction === 'cyrillic-to-latin') {
    head = `<div class="callout info">
      <b>Cyrillic → Latin is a total function.</b> Exactly one reading exists, so this
      direction can be computed. The reverse cannot — which is why the link still has to
      be asserted on-chain rather than derived.
    </div>`;
    if (plan.canonicalLatinRegistrable === false) {
      head += `<div class="callout">
        <b>The true Latin spelling is <span class="mono">${esc(plan.canonicalLatin)}</span>, and ENS will not accept it.</b><br />
        ${esc(plan.canonicalLatinError ?? '')}<br /><br />
        You are forced onto the ASCII fallback
        <span class="mono">${esc(usable[0]?.label ?? '')}</span> — and that fallback is
        itself ambiguous when read backwards. This is the gap the assertion closes.
      </div>`;
    }
  } else if (ambiguous) {
    head = `<div class="callout">
      <b>${usable.length} valid readings. The library will not choose for you.</b><br />
      <span class="mono">nj</span> / <span class="mono">lj</span> /
      <span class="mono">dž</span> / <span class="mono">dj</span> are each either one
      Cyrillic letter or two, decidable only by the word's morphology —
      <span class="mono">konj</span> → <span class="mono">коњ</span> but
      <span class="mono">injekcija</span> → <span class="mono">инјекција</span>.
      No client can tell them apart. Pick the one that is actually you.
    </div>`;
  } else {
    head = `<div class="callout info">
      No digraph in this label, so exactly one reading exists. The link is still asserted,
      not derived — a client must not assume the mapping holds for other names.
    </div>`;
  }

  return `<div class="panel">
    <h2>Step 2 · possible twins of ${esc(plan.normalized)}</h2>
    <dl class="kv">
      <dt>normalized</dt><dd>${esc(plan.normalized)}</dd>
      <dt>script group</dt><dd>${esc(plan.script)}</dd>
      <dt>namehash</dt><dd>${esc(plan.node)}</dd>
      <dt>addr()</dt><dd>${esc(state.sourceProbe?.addr ?? '— not set —')}</dd>
    </dl>
    ${head}
    ${plan.candidates.map((c) => candidateRow(c, plan)).join('')}
  </div>`;
}

function resultPanel(): string {
  const r = state.result;
  if (!r || !state.plan || !state.selected) return '';

  const rows = r.checks.map((c) => {
    const tag = c.ok ? 'PASS' : c.severity === 'advisory' ? 'note' : 'FAIL';
    const cls = c.ok ? 'pass' : c.severity === 'advisory' ? 'note' : 'fail';
    return `<div class="check">
      <div class="tag ${cls}">${tag}</div>
      <div class="id">${esc(c.id)}</div>
      <div>${esc(humanise(c.detail))}</div>
    </div>`;
  }).join('');

  const a = state.plan.normalized;
  const b = state.selected;
  const aOk = r.checks.find((c) => c.id === 'record-a-to-b')?.ok;
  const bOk = r.checks.find((c) => c.id === 'record-b-to-a')?.ok;

  const verdict = r.linked
    ? `<span class="pill ok">LINKED</span>`
    : `<span class="pill bad">NOT LINKED</span>`;

  const oneSided = (aOk && !bOk) || (!aOk && bOk);

  // A record can only be written to a resolver that exists. Unregistered names
  // report the zero address, so check explicitly rather than letting the
  // transaction revert.
  const aLive = !!state.sourceProbe?.resolver;
  const bLive = !!state.probes.get(b)?.resolver;
  const dead = [!aLive ? a : null, !bLive ? b : null].filter(Boolean) as string[];

  return `<div class="panel">
    <h2>Step 3 · verification ${verdict}</h2>
    ${rows}
    <div class="small dim" id="poll-stamp" style="margin-top:12px">${esc(pollStampText())}</div>
    ${oneSided ? `<div class="callout">
      <b>One-sided assertion — this proves nothing.</b> Anyone may point a text record at
      any name. Only the counter-assertion, which requires control of the other name's
      resolver, completes the proof.
    </div>` : ''}
    <h2 style="margin-top:22px">Step 4 · write the assertion</h2>
    <div class="row">
      <button class="ghost" data-assert="a" ${aOk || !aLive ? 'disabled' : ''}>
        ${aOk ? '✓ ' : ''}${esc(a)} → ${esc(b)}
      </button>
      <button class="ghost" data-assert="b" ${bOk || !bLive ? 'disabled' : ''}>
        ${bOk ? '✓ ' : ''}${esc(b)} → ${esc(a)}
      </button>
      ${state.account
        ? `<span class="small dim">signing as ${esc(short(state.account))}</span>`
        : `<button data-connect>Connect wallet</button>`}
    </div>
    <pre>setText(namehash("${esc(a)}"), "${esc(LINK_KEY)}"<span class="fn">*</span>, "${esc(b)}")
setText(namehash("${esc(b)}"), "${esc(LINK_KEY)}", "${esc(a)}")</pre>
    <p class="footnote">
      <span class="fn">*</span> <span class="mono">${esc(LINK_KEY)}</span> is the
      <b>record key</b> — the label this declaration is filed under on each name, sitting
      alongside familiar ones like <span class="mono">avatar</span> and
      <span class="mono">url</span>. ENS keeps plain, unprefixed keys for its own
      standards, so anything application-specific is namespaced. <i>Dvopis</i> is Serbian
      for digraphia.
    </p>
    ${dead.length ? `<div class="callout">
      <b>Not registered on ${esc(chainKey)}: ${esc(dead.join(', '))}.</b><br />
      A text record is stored on a name's resolver, and an unregistered name has none.
      Register it first, then come back — nothing here can be written until it exists.
    </div>` : ''}
    ${state.txNote ? `<div class="callout info">${esc(state.txNote)}</div>` : ''}
    ${state.txError ? `<div class="callout"><b>Transaction failed.</b><br />${esc(state.txError)}</div>` : ''}
  </div>`;
}

function heroPanel(): string {
  return `<header class="hero">
    <div class="brand">
      <span class="tile"><span class="a">&#x434;</span><span class="b">d</span></span>
      <span class="name"><i>&#x434;</i>igraphia</span>
    </div>

    <div class="eyebrow">Cross-script identity for ENS</div>
    <h1>Two spellings.<br /><span class="muted">One person.</span></h1>

    <p class="lede">
      Serbian is written in two alphabets at once — and so are Kazakh, Uzbek,
      Japanese, Chinese and Punjabi. <b>ENS treats each spelling as a different
      stranger.</b> This makes them one identity, provably.
    </p>

    <div class="pair">
      <span class="chip cyr">&#x43D;&#x438;&#x43A;&#x43E;&#x43B;&#x430;.eth</span>
      <span class="link-glyph">&#8596;</span>
      <span class="chip">nikola.eth</span>
    </div>
    <p class="pair-note">The same name. The same person. Two unrelated ENS identities.</p>
  </header>`;
}

function whyPanel(): string {
  return `<div class="section-title">Why it matters</div>
  <div class="cards">
    <div class="card">
      <h3>Your identity splits in half</h3>
      <p>Reputation, history, avatar, profile — all of it attaches to whichever
      spelling you registered. The other one is a <b>stranger wearing your name</b>,
      and nothing in ENS can say otherwise.</p>
    </div>
    <div class="card">
      <h3>Someone else can hold your name</h3>
      <p>Not a lookalike — <b>your actual name</b>, in the other alphabet. On mainnet
      today both spellings of <span class="mono">никола</span> are registered, to two
      different people. Neither can prove any relationship to the other.</p>
    </div>
    <div class="card">
      <h3>No one can safely link them</h3>
      <p>A wallet could guess two names are the same person. But guessing wrong shows
      <b>one person's balance under another person's name</b>. Without proof, the safe
      choice is to show them as strangers — so everyone does.</p>
    </div>
    <div class="card">
      <h3>The fix needs no permission</h3>
      <p>The holder of both names declares each one from the other. That mutual
      declaration is <b>the entire protocol</b> — no issuer, no oracle, nothing new
      deployed, and clients that ignore it lose nothing.</p>
    </div>
  </div>`;
}

function render() {
  const app = document.getElementById('app')!;

  // render() replaces the whole tree, which would drop the caret if a poll
  // fired while the user was typing. Remember where it was.
  const active = document.activeElement as HTMLInputElement | null;
  const activeId = active && 'selectionStart' in active ? active.id : null;
  const selStart = activeId ? active!.selectionStart : null;
  const selEnd = activeId ? active!.selectionEnd : null;

  app.innerHTML = `
    ${heroPanel()}
    ${whyPanel()}

    <div class="section-title" id="tool">See it work</div>
    <div class="tool-intro">
      <p>Enter a name you hold. It finds the possible twins, verifies the link live
      against Ethereum, and writes the declaration.</p>
    </div>

    <div class="panel">
      <h2>Step 1 · a name you hold</h2>
      <div class="row">
        <div class="grow">
          <input type="text" id="name" placeholder="ђорђе.eth" value="${esc(state.input)}"
                 autocomplete="off" spellcheck="false" />
        </div>
        <select id="chain">
          ${Object.keys(CHAINS).map((k) =>
            `<option value="${k}" ${k === chainKey ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
        <button id="go">Find twin</button>
      </div>
      <div class="small dim" style="margin-top:12px">
        Try <span class="mono">ђорђе.eth</span>, or <span class="mono">djordje.eth</span>
        to see why the link cannot simply be calculated.
      </div>
      ${state.planError ? `<div class="err" style="margin-top:12px">${esc(state.planError)}</div>` : ''}
      ${state.busy ? `<div class="spin" style="margin-top:12px">${esc(state.busy)}</div>` : ''}
    </div>

    ${planPanel()}
    ${resultPanel()}
  `;

  if (state.scrollToTool) {
    state.scrollToTool = false;
    document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (activeId) {
    const el = document.getElementById(activeId) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (selStart !== null) {
        try { el.setSelectionRange(selStart, selEnd ?? selStart); } catch { /* not a text input */ }
      }
    }
  }

  const input = document.getElementById('name') as HTMLInputElement;
  input.addEventListener('input', () => { state.input = input.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
  document.getElementById('go')!.addEventListener('click', analyze);
  document.getElementById('chain')!.addEventListener('change', (e) => {
    chainKey = (e.target as HTMLSelectElement).value as ChainKey;
    if (state.plan) analyze();
  });

  app.querySelectorAll<HTMLElement>('.cand[data-name]').forEach((el) =>
    el.addEventListener('click', () => select(el.dataset.name!)));
  app.querySelector('[data-connect]')?.addEventListener('click', connect);
  app.querySelectorAll<HTMLElement>('[data-assert]').forEach((el) =>
    el.addEventListener('click', () => {
      const a = state.plan!.normalized, b = state.selected!;
      return el.dataset.assert === 'a' ? assert(a, b) : assert(b, a);
    }));
}

render();
