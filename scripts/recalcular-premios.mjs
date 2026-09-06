// ============================================================================
//  Recalcula o rateio de prêmios de uma competição JÁ ENCERRADA, usando a
//  regra atual (2º e menos-acertos dividem o prêmio quando há empate).
//  Não mexe em acertos nem em sorteios — só nos prêmios e no histórico.
//
//  Uso:  node scripts/recalcular-premios.mjs "003"
//        node scripts/recalcular-premios.mjs "003" --simular
// ============================================================================
import fs from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const ALVO = process.argv[2];
const SIMULAR = process.argv.includes('--simular');
if (!ALVO) { console.error('Informe o nome ou id da competição. Ex: node scripts/recalcular-premios.mjs "003"'); process.exit(1); }

const PCT = { p1: 0.63, p2: 0.20, p3: 0.05 };

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = getFirestore();

// Acha a competição por id ou por nome.
let jogoRef = db.collection('jogos').doc(ALVO);
let snap = await jogoRef.get();
if (!snap.exists) {
  const q = await db.collection('jogos').where('nome', '==', ALVO).get();
  if (q.empty) { console.error(`Competição "${ALVO}" não encontrada.`); process.exit(1); }
  jogoRef = q.docs[0].ref; snap = q.docs[0];
}
const jogo = snap.data();
const jogoId = jogoRef.id;
console.log(`Competição: "${jogo.nome}" (${jogoId}) — status ${jogo.status}`);

const ps = await db.collection('participantes').where('jogoId', '==', jogoId).get();
const participantes = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
const total = participantes.length;
const premioTotal = (jogo.valorInscricao || 50) * total;
const premio1 = premioTotal * PCT.p1;
const premio2 = premioTotal * PCT.p2;
const premio3 = premioTotal * PCT.p3;

const campeoes = participantes.filter((p) => (p.acertos || 0) >= 17).sort((a, b) => (b.acertos || 0) - (a.acertos || 0));
if (!campeoes.length) { console.error('Nenhum participante com 17 acertos — nada a ratear.'); process.exit(1); }
const idsCampeoes = new Set(campeoes.map((c) => c.id));
const naoCampeoes = participantes.filter((p) => !idsCampeoes.has(p.id));

let segundos = [], perdedores = [];
if (naoCampeoes.length) {
  const maxNC = Math.max(...naoCampeoes.map((p) => p.acertos || 0));
  const minNC = Math.min(...naoCampeoes.map((p) => p.acertos || 0));
  segundos = naoCampeoes.filter((p) => (p.acertos || 0) === maxNC);
  if (minNC < maxNC && total >= 3) perdedores = naoCampeoes.filter((p) => (p.acertos || 0) === minNC);
}

const p1c = premio1 / campeoes.length;
const p2c = segundos.length ? premio2 / segundos.length : 0;
const p3c = perdedores.length ? premio3 / perdedores.length : 0;

const fmt = (lst, v) => lst.map((p) => `${p.nome} (${p.acertos || 0}/17)`).join(', ') + ` → R$ ${v.toFixed(2)} cada`;
console.log(`\nBolão: R$ ${premioTotal.toFixed(2)}  (${total} × R$ ${jogo.valorInscricao || 50})`);
console.log(`🥇 1º lugar: ${fmt(campeoes, p1c)}`);
console.log(`🥈 2º lugar: ${segundos.length ? fmt(segundos, p2c) : '—'}`);
console.log(`🎯 Menos acertos: ${perdedores.length ? fmt(perdedores, p3c) : '—'}`);

if (SIMULAR) { console.log('\n[simulação] nada foi gravado.'); process.exit(0); }

const batch = db.batch();
for (const v of campeoes) {
  batch.update(db.collection('participantes').doc(v.id), { acertouTodos: true, ordemVitoria: 1, premioGanho: p1c });
  batch.set(db.collection('historico_vencedores').doc(`${jogoId}_${v.id}`), {
    jogoId, participanteId: v.id, participanteNome: v.nome, posicao: 1, premio: p1c, dataVitoria: Timestamp.now(),
  });
}
for (const s of segundos) {
  batch.update(db.collection('participantes').doc(s.id), { ordemVitoria: 2, premioGanho: p2c });
  batch.set(db.collection('historico_vencedores').doc(`${jogoId}_${s.id}`), {
    jogoId, participanteId: s.id, participanteNome: s.nome, posicao: 2, premio: p2c, acertos: s.acertos || 0, dataVitoria: Timestamp.now(),
  });
}
for (const p of perdedores) {
  batch.update(db.collection('participantes').doc(p.id), { premioMenosAcertos: p3c });
  batch.set(db.collection('historico_vencedores').doc(`${jogoId}_${p.id}_menos`), {
    jogoId, participanteId: p.id, participanteNome: p.nome, posicao: 'MENOS ACERTOS', premio: p3c, acertos: p.acertos || 0, dataVitoria: Timestamp.now(),
  });
}
await batch.commit();
console.log('\n✅ Prêmios recalculados e gravados.');
process.exit(0);
