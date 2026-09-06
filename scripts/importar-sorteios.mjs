// ============================================================================
//  Um de Nós — Motor de automação
//  Importa os sorteios da Quina que faltam, recalcula acertos, declara
//  vencedor e atualiza o resumo do jogo. Feito para rodar no GitHub Actions
//  (agendado) ou localmente para testar.
//
//  Uso:
//    node scripts/importar-sorteios.mjs            -> roda de verdade (grava)
//    node scripts/importar-sorteios.mjs --simular  -> só mostra o que faria
//
//  Credencial (uma das duas):
//    - variável de ambiente FIREBASE_SERVICE_ACCOUNT com o JSON em uma linha
//    - arquivo serviceAccountKey.json na raiz do projeto
// ============================================================================

import fs from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ----------------------------------------------------------------------------
// Configuração
// ----------------------------------------------------------------------------
const SIMULAR = process.argv.includes('--simular') || process.env.DRY_RUN === '1';
const EMAIL_DESTINO = process.env.EMAIL_DESTINO || 'eltonluisoc@gmail.com';
const FORMSUBMIT_ID = process.env.FORMSUBMIT_ID || '7323b499eb65357bcf8f13bdb5ac55bf';
const MAX_CONCURSOS = Number(process.env.MAX_CONCURSOS || 90);
const SITE_URL = 'https://eltonluisoc.github.io/um-de-nos/';

// APIs da Quina (tenta na ordem até uma responder).
// A 2ª é a própria Caixa — sem CORS, então só serve para o Node (não para o navegador).
const APIS_QUINA = [
  (c) => `https://loteriascaixa-api.herokuapp.com/api/quina/${c}`,
  (c) => `https://servicebus2.caixa.gov.br/portaldeloterias/api/quina/${c}`,
];
const API_LATEST = [
  'https://loteriascaixa-api.herokuapp.com/api/quina/latest',
  'https://servicebus2.caixa.gov.br/portaldeloterias/api/quina',
];

// Rateio dos prêmios (igual ao painel admin).
const PCT_1O = 0.63;
const PCT_2O = 0.20;
const PCT_MENOS_ACERTOS = 0.05;

const log = (...a) => console.log(...a);
const iso = () => new Date().toISOString();

// ----------------------------------------------------------------------------
// Firebase
// ----------------------------------------------------------------------------
function carregarCredencial() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    try { return JSON.parse(raw); }
    catch { throw new Error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido.'); }
  }
  const arquivo = new URL('../serviceAccountKey.json', import.meta.url);
  if (fs.existsSync(arquivo)) return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  throw new Error(
    'Sem credencial. Defina FIREBASE_SERVICE_ACCOUNT ou coloque serviceAccountKey.json na raiz.'
  );
}

initializeApp({ credential: cert(carregarCredencial()) });
const db = getFirestore();

// ----------------------------------------------------------------------------
// Helpers de API
// ----------------------------------------------------------------------------
async function buscarJson(url) {
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
  return resp.json();
}

function normalizarSorteio(dados) {
  let dezenas = dados.dezenas || dados.listaDezenas || dados.numeros;
  const concurso = Number(dados.concurso ?? dados.numero);
  const data = dados.data || dados.dataApuracao || null;
  const proximo = dados.dataProximoConcurso || dados.proximoConcurso || null;
  if (!Array.isArray(dezenas)) return null;
  dezenas = dezenas.map(Number).filter((n) => Number.isInteger(n));
  if (dezenas.length !== 5 || !concurso) return null;
  return { concurso, numeros: dezenas.sort((a, b) => a - b), data, proximo };
}

async function buscarUltimoConcurso() {
  for (const url of API_LATEST) {
    try {
      const s = normalizarSorteio(await buscarJson(url));
      if (s) { log(`📡 API: último concurso disponível = #${s.concurso} (${s.data || 's/ data'})`); return s; }
    } catch (e) { log(`⚠️  ${url} falhou: ${e.message}`); }
  }
  throw new Error('Nenhuma API respondeu para /latest.');
}

async function buscarConcurso(c) {
  for (const montar of APIS_QUINA) {
    try {
      const s = normalizarSorteio(await buscarJson(montar(c)));
      if (s && s.concurso === c) return s;
    } catch { /* tenta a próxima API */ }
  }
  return null;
}

// Converte "dd/mm/yyyy" no MOMENTO do sorteio (~20:05 em Brasília = 23:05 UTC).
function momentoDoSorteio(dataStr) {
  if (!dataStr) return null;
  const [d, m, y] = dataStr.split('/').map(Number);
  if (!d || !m || !y) return null;
  return new Date(Date.UTC(y, m - 1, d, 23, 5, 0));
}

// ----------------------------------------------------------------------------
// E-mail (formsubmit.co) — não crítico
// ----------------------------------------------------------------------------
async function enviarEmail(assunto, mensagem) {
  if (SIMULAR) { log(`✉️  [simulação] e-mail: "${assunto}"`); return; }
  try {
    const form = new FormData();
    form.append('email', EMAIL_DESTINO);
    form.append('subject', assunto);
    form.append('message', mensagem);
    const resp = await fetch(`https://formsubmit.co/ajax/${FORMSUBMIT_ID}`, { method: 'POST', body: form });
    log(resp.ok ? `✉️  e-mail enviado: "${assunto}"` : `⚠️  e-mail falhou: HTTP ${resp.status}`);
  } catch (e) { log(`⚠️  e-mail falhou: ${e.message}`); }
}

// ----------------------------------------------------------------------------
// Lógica principal
// ----------------------------------------------------------------------------
async function main() {
  log(`\n===== Um de Nós — importação ${SIMULAR ? '(SIMULAÇÃO)' : ''} — ${iso()} =====`);

  // 1) Competição ativa
  const snapJogo = await db.collection('jogos').where('status', '==', 'aberto').limit(1).get();
  if (snapJogo.empty) { log('ℹ️  Nenhuma competição ABERTA. Nada a fazer.'); return; }
  const jogoRef = snapJogo.docs[0].ref;
  const jogo = snapJogo.docs[0].data();
  const jogoId = jogoRef.id;
  log(`🏆 Competição ativa: "${jogo.nome}" (${jogoId})`);
  log(`   valor inscrição: R$ ${jogo.valorInscricao || 50} | último concurso importado: ${jogo.ultimoConcursoImportado ?? 'nenhum'}`);

  const dataInicio = jogo.dataInicio?.toDate?.() || jogo.createdAt?.toDate?.() || null;
  if (dataInicio) log(`   início da competição: ${dataInicio.toISOString()}`);

  // 2) Sorteios já importados desta competição
  const snapSorteios = await db.collection('sorteios_quina').where('competicaoId', '==', jogoId).get();
  const concursosExistentes = new Set();
  for (const d of snapSorteios.docs) concursosExistentes.add(Number(d.data().concurso));
  log(`   sorteios já no banco: ${concursosExistentes.size}`);

  // 3) Último concurso disponível na API
  const ultimo = await buscarUltimoConcurso();

  // 4) De qual concurso começar
  let inicio;
  if (jogo.ultimoConcursoImportado) {
    inicio = jogo.ultimoConcursoImportado + 1;
  } else {
    inicio = await descobrirPrimeiroConcurso(ultimo.concurso, dataInicio);
    log(`   primeiro concurso após o início da competição: #${inicio}`);
  }

  const alvo = [];
  for (let c = inicio; c <= ultimo.concurso && alvo.length < MAX_CONCURSOS; c++) {
    if (!concursosExistentes.has(c)) alvo.push(c);
  }

  if (alvo.length === 0) {
    log('✅ Nada faltando. Recalculando acertos por garantia...');
  } else {
    log(`📥 Concursos a importar (${alvo.length}): ${alvo.join(', ')}`);
  }

  // 5) Baixar os que faltam
  const novos = [];
  for (const c of alvo) {
    const s = await buscarConcurso(c);
    if (!s) { log(`   #${c}: ainda não disponível na API — paro aqui e continuo no próximo run.`); break; }
    // respeita "só conta após a ativação"
    const momento = momentoDoSorteio(s.data);
    if (dataInicio && momento && momento <= dataInicio) {
      log(`   #${c} (${s.data}): anterior ao início da competição — ignorado.`);
      continue;
    }
    log(`   #${c} (${s.data}): ${s.numeros.join(', ')}`);
    novos.push(s);
  }

  // 6) Gravar sorteios novos
  if (novos.length && !SIMULAR) {
    const batch = db.batch();
    for (const s of novos) {
      batch.set(db.collection('sorteios_quina').doc(`${jogoId}_${s.concurso}`), {
        concurso: s.concurso,
        numeros: s.numeros,
        data: momentoDoSorteio(s.data) ? Timestamp.fromDate(momentoDoSorteio(s.data)) : Timestamp.now(),
        importadoEm: Timestamp.now(),
        competicaoId: jogoId,
        origem: 'automacao',
      });
    }
    await batch.commit();
    log(`💾 ${novos.length} sorteio(s) gravado(s).`);
  }

  // 7) Conjunto acumulado de números (banco + novos)
  const numerosAcumulados = new Set();
  for (const d of snapSorteios.docs) for (const n of d.data().numeros || []) numerosAcumulados.add(Number(n));
  for (const s of novos) for (const n of s.numeros) numerosAcumulados.add(n);

  const frequencia = {};
  const contarFreq = (nums) => { for (const n of nums) frequencia[n] = (frequencia[n] || 0) + 1; };
  for (const d of snapSorteios.docs) contarFreq((d.data().numeros || []).map(Number));
  for (const s of novos) contarFreq(s.numeros);

  // 8) Recalcular acertos de todos os participantes
  const snapPart = await db.collection('participantes').where('jogoId', '==', jogoId).get();
  const participantes = snapPart.docs.map((d) => ({ id: d.id, ...d.data() }));
  const batchPart = db.batch();
  let mudancas = 0;
  const vencedores = [];

  for (const p of participantes) {
    const nums = (p.numeros || []).map(Number);
    const acertos = nums.filter((n) => numerosAcumulados.has(n)).length;
    if (acertos !== (p.acertos || 0)) {
      log(`   ${p.nome}: ${p.acertos || 0} -> ${acertos} acertos`);
      mudancas++;
      if (!SIMULAR) batchPart.update(db.collection('participantes').doc(p.id), { acertos });
    }
    p.acertos = acertos;
    if (acertos >= 17) vencedores.push(p);
  }
  if (mudancas && !SIMULAR) await batchPart.commit();
  log(`🔢 Acertos recalculados. ${mudancas} participante(s) mudaram.`);

  // 9) Vencedor?
  let houveVencedor = false;
  if (vencedores.length > 0) {
    houveVencedor = true;
    await declararVencedores({ jogoRef, jogo, jogoId, participantes, vencedores });
  }

  // 10) Resumo no doc do jogo (deixa o site público rápido)
  const ultimoImportadoAgora = novos.length ? novos[novos.length - 1].concurso
    : (jogo.ultimoConcursoImportado || (concursosExistentes.size ? Math.max(...concursosExistentes) : null));

  // dd/mm/yyyy a partir do Timestamp gravado (guardado como 23:05 UTC -> usar UTC).
  const fmtBR = (ts) => {
    const dt = ts && ts.toDate ? ts.toDate() : null;
    if (!dt) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
  };

  // Lista compacta de todos os sorteios da competição (para o site público
  // renderizar o histórico sem precisar ler a coleção sorteios_quina).
  const sorteiosResumo = [
    ...snapSorteios.docs.map((d) => ({ concurso: Number(d.data().concurso), numeros: (d.data().numeros || []).map(Number), data: fmtBR(d.data().data) })),
    ...novos.map((s) => ({ concurso: s.concurso, numeros: s.numeros, data: s.data || null })),
  ].sort((a, b) => b.concurso - a.concurso);

  const resumo = {
    ultimoConcursoImportado: ultimoImportadoAgora,
    ultimosNumerosSorteados: novos.length ? novos[novos.length - 1].numeros : (jogo.ultimosNumerosSorteados || []),
    ultimoSorteioData: sorteiosResumo[0]?.data || null,
    proximoSorteioData: ultimo.proximo || null,
    numerosAcumulados: [...numerosAcumulados].sort((a, b) => a - b),
    frequenciaNumeros: frequencia,
    sorteiosResumo,
    totalSorteios: concursosExistentes.size + novos.length,
    automacaoAtualizadaEm: Timestamp.now(),
  };
  if (!SIMULAR) await jogoRef.update(resumo);
  log(`📊 Resumo do jogo atualizado: ${resumo.totalSorteios} sorteios, ${resumo.numerosAcumulados.length} números acumulados.`);

  // 11) E-mail
  if (houveVencedor) {
    // e-mail de vencedor já é enviado dentro de declararVencedores()
  } else if (novos.length > 0) {
    const ranking = [...participantes].sort((a, b) => b.acertos - a.acertos).slice(0, 5)
      .map((p, i) => `${i + 1}. ${p.nome} — ${p.acertos}/17`).join('\n');
    const faixa = novos.length === 1 ? `#${novos[0].concurso}` : `#${novos[0].concurso}–#${novos[novos.length - 1].concurso}`;
    await enviarEmail(
      `🔔 Um de Nós — sorteio(s) ${faixa} importado(s)`,
      `Competição: ${jogo.nome}\n` +
      `Sorteios importados: ${novos.map((s) => `#${s.concurso} [${s.numeros.join(', ')}]`).join('\n')}\n\n` +
      `Ranking (top 5):\n${ranking}\n\n${SITE_URL}`
    );
  } else {
    log('ℹ️  Nada novo — nenhum e-mail enviado.');
  }

  log(`===== fim ${SIMULAR ? '(SIMULAÇÃO — nada foi gravado)' : ''} =====\n`);
}

// Anda para trás a partir do último concurso até achar o 1º após o início da competição.
async function descobrirPrimeiroConcurso(ultimoConcurso, dataInicio) {
  if (!dataInicio) return ultimoConcurso; // sem data: importa só o último
  let primeiro = ultimoConcurso;
  for (let c = ultimoConcurso; c > ultimoConcurso - MAX_CONCURSOS && c > 0; c--) {
    const s = await buscarConcurso(c);
    if (!s) break;
    const momento = momentoDoSorteio(s.data);
    if (momento && momento <= dataInicio) break;
    primeiro = c;
  }
  return primeiro;
}

async function declararVencedores({ jogoRef, jogo, jogoId, participantes, vencedores }) {
  log(`\n🏆 VENCEDOR(ES) detectado(s): ${vencedores.map((v) => v.nome).join(', ')}`);

  const valorInscricao = jogo.valorInscricao || 50;
  const total = participantes.length;
  const premioTotal = valorInscricao * total;
  const premio1 = premioTotal * PCT_1O;
  const premio2 = premioTotal * PCT_2O;
  const premio3 = premioTotal * PCT_MENOS_ACERTOS;

  vencedores.sort((a, b) => b.acertos - a.acertos);
  const empatadosTopo = vencedores.filter((v) => v.acertos === vencedores[0].acertos);

  const naoVencedores = participantes.filter((p) => !vencedores.includes(p));
  let perdedor = null;
  for (const p of naoVencedores) {
    if (!perdedor || (p.acertos || 0) < perdedor.acertos) perdedor = { id: p.id, nome: p.nome, acertos: p.acertos || 0 };
  }

  if (SIMULAR) {
    log(`   [simulação] 1º: ${vencedores[0].nome} (R$ ${premio1.toFixed(2)}${empatadosTopo.length > 1 ? ` / ${empatadosTopo.length} empatados` : ''})`);
    if (vencedores[1]) log(`   [simulação] 2º: ${vencedores[1].nome} (R$ ${premio2.toFixed(2)})`);
    if (perdedor && total >= 3) log(`   [simulação] menos acertos: ${perdedor.nome} (R$ ${premio3.toFixed(2)})`);
    log('   [simulação] jogo seria ENCERRADO.');
    return;
  }

  const batch = db.batch();
  for (let i = 0; i < vencedores.length && i < 2; i++) {
    const v = vencedores[i];
    let premio = i === 0 ? premio1 : premio2;
    if (i === 0 && empatadosTopo.length > 1) premio = premio1 / empatadosTopo.length;
    batch.update(db.collection('participantes').doc(v.id), {
      acertouTodos: true, ordemVitoria: i + 1, premioGanho: premio,
    });
    batch.set(db.collection('historico_vencedores').doc(`${jogoId}_${v.id}`), {
      jogoId, participanteId: v.id, participanteNome: v.nome,
      posicao: i + 1, premio, dataVitoria: Timestamp.now(),
    });
  }
  if (perdedor && total >= 3) {
    batch.update(db.collection('participantes').doc(perdedor.id), { premioMenosAcertos: premio3 });
    batch.set(db.collection('historico_vencedores').doc(`${jogoId}_${perdedor.id}_menos`), {
      jogoId, participanteId: perdedor.id, participanteNome: perdedor.nome,
      posicao: 'MENOS ACERTOS', premio: premio3, acertos: perdedor.acertos, dataVitoria: Timestamp.now(),
    });
  }
  batch.update(jogoRef, { status: 'encerrado', encerradoEm: Timestamp.now(), vencedorNome: vencedores[0].nome });
  await batch.commit();
  log('   jogo ENCERRADO e histórico gravado.');

  await enviarEmail(
    `🏆 Um de Nós — TEMOS VENCEDOR: ${vencedores[0].nome}`,
    `Competição "${jogo.nome}" encerrada!\n\n` +
    `🥇 1º: ${vencedores[0].nome} — R$ ${premio1.toFixed(2)}\n` +
    (vencedores[1] ? `🥈 2º: ${vencedores[1].nome} — R$ ${premio2.toFixed(2)}\n` : '') +
    (perdedor && total >= 3 ? `🎯 Menos acertos: ${perdedor.nome} (${perdedor.acertos}/17) — R$ ${premio3.toFixed(2)}\n` : '') +
    `\n${SITE_URL}`
  );
}

main().catch((e) => { console.error('\n❌ ERRO:', e.stack || e.message); process.exit(1); });
