/**
 * Live smoke test: run verifyLink() against a real chain.
 *
 *   node test/live.mjs                          # Sepolia demo pair
 *   node test/live.mjs mainnet никола.eth nikola.eth
 *
 * Reads are live `eth_call`s through the Universal Resolver on whichever
 * chain is selected. viem ships the UR address for both mainnet and Sepolia,
 * so verifyLink() itself is chain-agnostic - nothing in src/ changes.
 */
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { verifyLink, LINK_KEY } from '../src/verify.ts';
import { cyrillicToLatin, latinToCyrillicCandidates, isAmbiguousLatin } from '../src/translit.ts';

const CHAINS = {
  sepolia: { chain: sepolia, rpc: process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com' },
  mainnet: { chain: mainnet, rpc: process.env.MAINNET_RPC ?? 'https://eth.drpc.org' },
};

const [chainArg = 'sepolia', nameA = 'ђорђе.eth', nameB = 'djordje.eth'] = process.argv.slice(2);
const sel = CHAINS[chainArg];
if (!sel) {
  console.error(`unknown chain "${chainArg}" - expected one of: ${Object.keys(CHAINS).join(', ')}`);
  process.exit(1);
}

const client = createPublicClient({ chain: sel.chain, transport: http(sel.rpc) });

console.log(`chain    : ${sel.chain.name} (${sel.chain.id})`);
console.log(`resolver : ${sel.chain.contracts?.ensUniversalResolver?.address}`);
console.log(`LINK_KEY : ${LINK_KEY}\n`);

console.log(`--- verifyLink(${nameA}, ${nameB}) ---`);
const r = await verifyLink(client, nameA, nameB);
for (const c of r.checks) {
  const tag = c.ok ? 'PASS' : (c.severity === 'advisory' ? 'note' : 'FAIL');
  console.log(` ${tag.padEnd(4)}  ${c.id.padEnd(14)} ${c.detail}`);
}
console.log(`\nlinked: ${r.linked}`);
console.log(`scripts: ${r.a.script} / ${r.b.script}`);
console.log(`addr:    ${r.a.address} / ${r.b.address}`);

console.log('\n--- why the link cannot be derived ---');
for (const cyr of ['ђорђе', 'коњиц', 'инјекција']) {
  const lat = cyrillicToLatin(cyr);
  const back = latinToCyrillicCandidates(lat);
  console.log(` ${cyr.padEnd(10)} -> ${lat.padEnd(10)} -> ${back.length} reading(s): ${back.join(', ')}`);
}
console.log(`\n isAmbiguousLatin('djordje') = ${isAmbiguousLatin('djordje')}`);
console.log(` isAmbiguousLatin('nikola')  = ${isAmbiguousLatin('nikola')}`);
