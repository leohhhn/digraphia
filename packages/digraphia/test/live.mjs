import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { verifyLink, LINK_KEY } from '../src/verify.ts';
import { cyrillicToLatin, latinToCyrillicCandidates } from '../src/translit.ts';

const client = createPublicClient({ chain: mainnet, transport: http('https://eth.drpc.org') });

console.log('LINK_KEY:', LINK_KEY, '\n');
console.log('--- live verifyLink against the real chain (records not yet set) ---');
const r = await verifyLink(client, 'никола.leonh.eth', 'nikola.leonh.eth');
console.log('linked:', r.linked);
for (const c of r.checks) console.log(` ${c.ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(14)} ${c.detail}`);
console.log('\nscripts:', r.a.script, '/', r.b.script);

console.log('\n--- transliteration of the demo pair ---');
for (const cyr of ['никола','ђорђе','коњ']) {
  console.log(` ${cyr}  ->  ${cyrillicToLatin(cyr)}   | reverse candidates: ${latinToCyrillicCandidates(cyrillicToLatin(cyr)).join(', ')}`);
}
