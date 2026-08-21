import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    onSnapshot, 
    doc, 
    getDoc,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let jogoAtual = null;
let jogoId = null;
let participantes = [];
let numerosSorteadosAcumulados = [];
let sorteiosRealizados = [];

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Um de Nós - Página Pública iniciada - v7');
    carregarDados();
});

async function carregarDados() {
    await carregarJogoAtivo();
}

import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    onSnapshot,  // ← ADICIONE ESTA LINHA
    doc, 
    getDoc,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================
// 🚀 FUNÇÃO CORRIGIDA - carregarJogoAtivo
// ============================================
async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    
    try {
        // 1. TENTAR BUSCAR JOGO ATIVO
        const qAtivo = query(jogosRef, where('status', '==', 'aberto'), limit(1));
        const ativoSnapshot = await getDocs(qAtivo);
        
        if (!ativoSnapshot.empty) {
            const jogoDoc = ativoSnapshot.docs[0];
            jogoAtual = jogoDoc.data();
            jogoId = jogoDoc.id;
            
            console.log('✅ Jogo ativo encontrado:', jogoId, jogoAtual.nome);
            
            document.getElementById('statusJogo').innerHTML = `
                <span class="status-badge">🎯 JOGO EM ANDAMENTO</span>
            `;
            
            if (jogoAtual.ultimosNumerosSorteados && jogoAtual.ultimosNumerosSorteados.length > 0) {
                mostrarNumerosSorteados(jogoAtual.ultimosNumerosSorteados);
            }
            
            await carregarPremiacao();
            await carregarSorteios();
            await carregarNumerosSorteadosGrid();
            await carregarParticipantesPorJogo(jogoId);
            escutarParticipantes();
            await atualizarStatusSorteio();
            return;
        }
        
        // 2. SE NÃO TEM JOGO ATIVO, BUSCAR O ÚLTIMO ENCERRADO
        console.log('📌 Nenhum jogo ativo. Buscando último encerrado...');
        
        const qEncerrado = query(jogosRef, where('status', '==', 'encerrado'));
        const encerradoSnapshot = await getDocs(qEncerrado);
        
        if (!encerradoSnapshot.empty) {
            // Ordenar manualmente
            const jogos = [];
            encerradoSnapshot.forEach(doc => {
                const data = doc.data();
                jogos.push({ 
                    id: doc.id, 
                    nome: data.nome,
                    encerradoEm: data.encerradoEm,
                    vencedorNome: data.vencedorNome,
                    vencedorId: data.vencedorId,
                    valorInscricao: data.valorInscricao || 50,
                    totalParticipantes: data.totalParticipantes || 0,
                    ultimosNumerosSorteados: data.ultimosNumerosSorteados || [],
                    ultimoConcursoImportado: data.ultimoConcursoImportado,
                    ...data
                });
            });
            
            jogos.sort((a, b) => {
                const dateA = a.encerradoEm?.toDate ? a.encerradoEm.toDate() : new Date(0);
                const dateB = b.encerradoEm?.toDate ? b.encerradoEm.toDate() : new Date(0);
                return dateB - dateA;
            });
            
            const jogoDoc = jogos[0];
            jogoAtual = jogoDoc;
            jogoId = jogoDoc.id;
            
            console.log(`📌 Último jogo encerrado: ${jogoDoc.nome} (${jogoDoc.id})`);
            console.log(`👑 Vencedor no jogo: ${jogoDoc.vencedorNome || 'Nenhum'}`);
            
            // Mostrar status
            document.getElementById('statusJogo').innerHTML = `
                <span class="status-badge" style="background:#ff8c00;">🏆 COMPETIÇÃO ENCERRADA 🏆</span>
            `;
            
            // Mostrar últimos números sorteados
            if (jogoAtual.ultimosNumerosSorteados && jogoAtual.ultimosNumerosSorteados.length > 0) {
                mostrarNumerosSorteados(jogoAtual.ultimosNumerosSorteados);
            }
            
            // Carregar dados
            await carregarPremiacao();
            await carregarSorteios();
            await carregarNumerosSorteadosGrid();
            await carregarParticipantesPorJogo(jogoId);
            
            // 🔥 CORREÇÃO: Buscar vencedor do histórico se não estiver no jogo
            let vencedorNome = jogoAtual.vencedorNome;
            
            // Se não tem vencedor no jogo, buscar do histórico
            if (!vencedorNome || vencedorNome === 'Nenhum') {
                console.log('🔍 Buscando vencedor no histórico...');
                const vencedorInfo = await buscarVencedorDoHistorico(jogoId);
                if (vencedorInfo) {
                    vencedorNome = vencedorInfo.nome;
                    console.log(`✅ Vencedor encontrado no histórico: ${vencedorNome}`);
                }
            }
            
            // Mostrar vencedor
            const vencedorDiv = document.getElementById('vencedorInfo');
            const vencedorNomeEl = document.getElementById('vencedorNome');
            const vencedorDataEl = document.getElementById('vencedorData');
            
            if (vencedorNome && vencedorNome !== 'Nenhum') {
                vencedorDiv.style.display = 'block';
                vencedorNomeEl.innerHTML = `🎉 ${vencedorNome} 🎉`;
                
                // Buscar prêmio do vencedor
                const premio = await buscarPremioVencedor(jogoId, vencedorNome);
                if (premio) {
                    vencedorDataEl.innerHTML = `🏆 Vencedor com R$ ${premio.toFixed(2)} de prêmio!`;
                } else {
                    vencedorDataEl.innerHTML = `🏆 Vencedor da competição "${jogoAtual.nome}"!`;
                }
            } else {
                // Se realmente não há vencedor
                vencedorDiv.style.display = 'block';
                vencedorNomeEl.innerHTML = `⚡ Sem vencedor`;
                vencedorDataEl.innerHTML = `Competição encerrada sem vencedor`;
            }
            
            const statusSpan = document.getElementById('statusSorteio');
            if (statusSpan) {
                statusSpan.innerHTML = `🏁 Competição finalizada em ${jogoAtual.encerradoEm?.toDate?.()?.toLocaleDateString('pt-BR') || '-'}`;
                statusSpan.className = 'encerrado';
            }
            
            return;
        }
        
        // 3. NENHUM JOGO ENCONTRADO
        console.log('⚠️ Nenhum jogo encontrado');
        document.getElementById('statusJogo').innerHTML = `
            <span class="status-badge" style="background:#888;">⏸️ AGUARDANDO PRÓXIMO JOGO</span>
        `;
        document.getElementById('listaParticipantes').innerHTML = `
            <div class="loading">⚡ Nenhum jogo em andamento. Aguarde o próximo!</div>
        `;
        document.getElementById('vencedorInfo').style.display = 'none';
        await carregarUltimoVencedor();
        
    } catch (error) {
        console.error('❌ Erro ao carregar jogo:', error);
        document.getElementById('listaParticipantes').innerHTML = `
            <div class="loading">❌ Erro ao carregar dados: ${error.message}</div>
        `;
    }
}

// ============================================
// 🔥 NOVAS FUNÇÕES PARA BUSCAR VENCEDOR
// ============================================

async function buscarVencedorDoHistorico(jogoId) {
    try {
        const historicoRef = collection(db, 'historico_vencedores');
        const q = query(historicoRef, where('jogoId', '==', jogoId));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) return null;
        
        // Buscar o primeiro vencedor (posição 1)
        let vencedor = null;
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.posicao === 1 || data.posicao === '1') {
                vencedor = {
                    nome: data.participanteNome,
                    premio: data.premio || 0,
                    posicao: data.posicao
                };
            }
        });
        
        // Se não achou posição 1, pega o primeiro da lista
        if (!vencedor && !snapshot.empty) {
            const firstDoc = snapshot.docs[0];
            const data = firstDoc.data();
            vencedor = {
                nome: data.participanteNome,
                premio: data.premio || 0,
                posicao: data.posicao
            };
        }
        
        return vencedor;
    } catch (error) {
        console.error('❌ Erro ao buscar vencedor no histórico:', error);
        return null;
    }
}

async function buscarPremioVencedor(jogoId, nomeVencedor) {
    try {
        const historicoRef = collection(db, 'historico_vencedores');
        const q = query(historicoRef, where('jogoId', '==', jogoId));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) return null;
        
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (data.participanteNome === nomeVencedor && data.premio > 0) {
                return data.premio;
            }
        }
        
        // Se não encontrou pelo nome, tenta achar o primeiro da lista
        const firstDoc = snapshot.docs[0];
        return firstDoc.data().premio || 0;
    } catch (error) {
        console.error('❌ Erro ao buscar prêmio:', error);
        return null;
    }
}

// ============================================
// FUNÇÃO CORRIGIDA - carregarParticipantesPorJogo
// ============================================
async function carregarParticipantesPorJogo(jogoId) {
    try {
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', jogoId));
        const querySnapshot = await getDocs(q);
        
        participantes = [];
        querySnapshot.forEach((doc) => {
            participantes.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        console.log(`📊 ${participantes.length} participantes encontrados`);
        
        const totalSpan = document.getElementById('totalParticipantes');
        const maiorSpan = document.getElementById('maiorPontuacao');
        if (totalSpan) totalSpan.textContent = participantes.length;
        
        if (participantes.length > 0) {
            const maiorAcertos = Math.max(...participantes.map(p => p.acertos || 0));
            if (maiorSpan) maiorSpan.textContent = `${maiorAcertos}/17`;
        } else {
            if (maiorSpan) maiorSpan.textContent = '0';
        }
        
        atualizarRanking(participantes);
        
    } catch (error) {
        console.error('❌ Erro ao carregar participantes:', error);
    }
}

// ============================================
// FUNÇÃO CORRIGIDA - atualizarRanking
// ============================================
function atualizarRanking(participantes) {
    const container = document.getElementById('listaParticipantes');
    if (!container) return;
    
    if (participantes.length === 0) {
        container.innerHTML = '<div class="loading">📋 Nenhum participante cadastrado nesta competição...</div>';
        return;
    }
    
    // 🔥 ORDENAÇÃO: primeiro quem acertou tudo, depois por acertos
    const ordenados = [...participantes].sort((a, b) => {
        if (a.acertouTodos && !b.acertouTodos) return -1;
        if (!a.acertouTodos && b.acertouTodos) return 1;
        return (b.acertos || 0) - (a.acertos || 0);
    });
    
    const menorAcertos = ordenados[ordenados.length - 1]?.acertos || 0;
    
    let html = '';
    let posicaoAtual = 1;
    
    for (let i = 0; i < ordenados.length; i++) {
        const p = ordenados[i];
        
        // Calcular posição (considerando empates)
        if (i > 0 && p.acertos === ordenados[i-1].acertos) {
            // Mesma posição do anterior
        } else {
            posicaoAtual = i + 1;
        }
        
        const progressoPercent = Math.min(((p.acertos || 0) / 17) * 100, 100);
        const isChampion = p.acertouTodos === true;
        const isLastPlace = p.acertos === menorAcertos && ordenados.length > 2 && !isChampion;
        
        // Determinar classe da linha
        let rowClass = '';
        let posText = '';
        let medalha = '';
        
        if (isChampion) {
            rowClass = 'first-place champion';
            medalha = '👑';
            posText = `${medalha} 1º`;
        } else if (posicaoAtual === 1 && !isChampion) {
            rowClass = 'first-place';
            medalha = '🏆';
            posText = `${medalha} 1º`;
        } else if (posicaoAtual === 2 && !isChampion && ordenados[0].acertos !== p.acertos) {
            rowClass = 'second-place';
            medalha = '🥈';
            posText = `${medalha} 2º`;
        } else if (posicaoAtual === 3 && !isChampion && ordenados[1]?.acertos !== p.acertos) {
            medalha = '🥉';
            posText = `${medalha} ${posicaoAtual}º`;
        } else if (isLastPlace) {
            rowClass = 'last-place';
            medalha = '🎯';
            posText = `${medalha} ${posicaoAtual}º`;
        } else {
            posText = `${posicaoAtual}º`;
        }
        
        // Números do participante
        let numerosHtml = '<div class="player-numbers">';
        if (p.numeros && Array.isArray(p.numeros)) {
            for (const num of p.numeros) {
                const acertou = numerosSorteadosAcumulados.includes(num);
                numerosHtml += `<span class="number-badge ${acertou ? 'hit' : ''}">${num}</span>`;
            }
        }
        numerosHtml += '</div>';
        
        // Badge de prêmio
        let premioBadge = '';
        if (p.premioGanho && p.premioGanho > 0) {
            premioBadge = `<span style="color:#ffd700;font-weight:bold;font-size:0.75em;margin-left:8px;">💰 R$ ${p.premioGanho.toFixed(2)}</span>`;
        }
        
        let lastBadge = '';
        if (isLastPlace && !isChampion) {
            lastBadge = '<span class="last-place-badge">🎯 MENOS ACERTOS</span>';
        }
        
        html += `<div class="ranking-row ${rowClass}" onclick="window.mostrarDetalhes('${p.id}')">
                    <div class="ranking-pos">${posText}</div>
                    <div class="ranking-player">
                        <div class="player-name">
                            ${p.nome} 
                            ${lastBadge}
                            ${premioBadge}
                            ${isChampion ? ' ⭐' : ''}
                        </div>
                        ${numerosHtml}
                    </div>
                    <div class="ranking-score">${p.acertos || 0}<small>/17</small></div>
                    <div class="ranking-progress">
                        <div class="progress-wrapper">
                            <div class="progress-bar-container">
                                <div class="progress-fill" style="width: ${progressoPercent}%; background: ${isChampion ? 'linear-gradient(90deg, #ffd700, #ff8c00)' : 'linear-gradient(90deg, #f1c40f, #ff8c00)'};"></div>
                            </div>
                            <div class="progress-percent">${Math.round(progressoPercent)}%</div>
                        </div>
                    </div>
                </div>`;
    }
    
    container.innerHTML = html;
    console.log(`✅ Ranking atualizado com ${ordenados.length} participantes`);
}

// ============================================
// FUNÇÕES AUXILIARES (mantidas iguais)
// ============================================

async function carregarPremiacao() {
    if (!jogoAtual) return;
    
    const valorInscricao = jogoAtual.valorInscricao || 50;
    const totalParticipantes = jogoAtual.totalParticipantes || 0;
    const premioTotal = valorInscricao * totalParticipantes;
    
    const premio1 = premioTotal * 0.63;
    const premio2 = premioTotal * 0.20;
    const premio3 = premioTotal * 0.05;
    
    const premio1El = document.getElementById('premio1');
    const premio2El = document.getElementById('premio2');
    const premio3El = document.getElementById('premio3');
    const premiacaoEl = document.getElementById('premiacao');
    
    if (premio1El) premio1El.innerHTML = `R$ ${premio1.toFixed(2)}`;
    if (premio2El) premio2El.innerHTML = `R$ ${premio2.toFixed(2)}`;
    if (premio3El) premio3El.innerHTML = `R$ ${premio3.toFixed(2)}`;
    if (premiacaoEl) premiacaoEl.style.display = 'grid';
}

async function carregarSorteios() {
    if (!jogoId) return;
    
    const sorteiosRef = collection(db, 'sorteios_quina');
    const q = query(sorteiosRef, where('competicaoId', '==', jogoId));
    const querySnapshot = await getDocs(q);
    sorteiosRealizados = [];
    numerosSorteadosAcumulados = [];
    
    const container = document.getElementById('listaSorteios');
    if (!container) return;
    
    if (querySnapshot.empty) {
        container.innerHTML = '<div style="color:rgba(255,255,255,0.4);">Nenhum sorteio importado ainda.</div>';
        return;
    }
    
    const sorteios = [];
    querySnapshot.forEach(doc => {
        const data = doc.data();
        sorteios.push({ id: doc.id, ...data });
        if (data.numeros) {
            numerosSorteadosAcumulados.push(...data.numeros);
        }
    });
    sorteios.sort((a, b) => b.concurso - a.concurso);
    sorteiosRealizados = sorteios;
    
    let html = '';
    for (const s of sorteios) {
        html += `<div class="sorteio-item"><span>#${s.concurso}</span> ${s.numeros.join(', ')}</div>`;
    }
    container.innerHTML = html;
    console.log(`${sorteios.length} sorteios carregados, ${numerosSorteadosAcumulados.length} números acumulados`);
}

async function carregarNumerosSorteadosGrid() {
    if (!jogoId) return;
    
    const container = document.getElementById('numerosSorteadosGrid');
    const totalSpan = document.getElementById('totalSorteados');
    
    if (!container) {
        console.log('Elemento numerosSorteadosGrid não encontrado');
        return;
    }
    
    const sorteiosRef = collection(db, 'sorteios_quina');
    const q = query(sorteiosRef, where('competicaoId', '==', jogoId));
    const querySnapshot = await getDocs(q);
    
    const frequencia = new Map();
    for (const doc of querySnapshot.docs) {
        const s = doc.data();
        if (s.numeros) {
            for (const num of s.numeros) {
                frequencia.set(num, (frequencia.get(num) || 0) + 1);
            }
        }
    }
    
    if (frequencia.size === 0) {
        container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.4);">Nenhum número sorteado ainda</div>';
        if (totalSpan) totalSpan.innerHTML = '';
        return;
    }
    
    let html = '<div class="numeros-grid" style="display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; margin-top: 10px;">';
    for (let i = 1; i <= 80; i++) {
        const qtd = frequencia.get(i) || 0;
        let classe = 'grid-numero';
        let estrela = '';
        
        if (qtd > 0) {
            classe += ' sorteados';
            if (qtd >= 2) {
                classe += ' repetido';
                estrela = ' ★';
            }
        }
        
        html += `<div class="${classe}" title="Saiu ${qtd} vez(es)">${i}${estrela}</div>`;
    }
    html += '</div>';
    
    container.innerHTML = html;
    
    const totalUnicos = frequencia.size;
    const totalRepetidos = Array.from(frequencia.values()).filter(v => v > 1).length;
    if (totalSpan) {
        totalSpan.innerHTML = `📊 ${totalUnicos} números sorteados | ${totalRepetidos} números repetidos`;
    }
}

function escutarParticipantes() {
    if (!jogoId) return;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoId));
    
    onSnapshot(q, (snapshot) => {
        console.log('🔄 Atualização em tempo real');
        participantes = [];
        snapshot.forEach((doc) => {
            participantes.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        atualizarRanking(participantes);
        verificarVencedor(participantes);
        
        const totalSpan = document.getElementById('totalParticipantes');
        const maiorSpan = document.getElementById('maiorPontuacao');
        if (totalSpan) totalSpan.textContent = participantes.length;
        if (maiorSpan && participantes.length > 0) {
            const maiorAcertos = Math.max(...participantes.map(p => p.acertos || 0));
            maiorSpan.textContent = `${maiorAcertos}/17`;
        }
        
    }, (error) => {
        console.error('❌ Erro ao escutar participantes:', error);
    });
}

function mostrarNumerosSorteados(numeros) {
    const container = document.getElementById('numerosSorteio');
    if (!container) return;
    
    if (!numeros || numeros.length === 0) {
        container.innerHTML = '<span>⏳ Aguardando primeiro sorteio...</span>';
        return;
    }
    
    let html = '';
    numeros.forEach(num => {
        html += `<span>${num}</span>`;
    });
    container.innerHTML = html;
}

function verificarVencedor(participantes) {
    const vencedor = participantes.find(p => p.acertouTodos === true);
    const statusDiv = document.getElementById('statusJogo');
    const vencedorDiv = document.getElementById('vencedorInfo');
    const vencedorNome = document.getElementById('vencedorNome');
    const vencedorData = document.getElementById('vencedorData');
    
    if (vencedor && jogoAtual?.status !== 'encerrado') {
        if (statusDiv) {
            statusDiv.innerHTML = `<span class="status-badge" style="background:#ff8c00;">🏆 JOGO ENCERRADO - VENCEDOR ENCONTRADO 🏆</span>`;
        }
        
        if (vencedorDiv) vencedorDiv.style.display = 'block';
        if (vencedorNome) vencedorNome.innerHTML = `🎉 ${vencedor.nome} 🎉`;
        if (vencedorData) vencedorData.innerHTML = `Acertou 17 números primeiro!`;
    }
}

async function carregarUltimoVencedor() {
    try {
        const historicoRef = collection(db, 'historico_vencedores');
        const querySnapshot = await getDocs(historicoRef);
        
        const historico = [];
        querySnapshot.forEach(doc => {
            historico.push({ id: doc.id, ...doc.data() });
        });
        historico.sort((a, b) => {
            const dateA = a.dataVitoria?.toDate?.() || new Date(0);
            const dateB = b.dataVitoria?.toDate?.() || new Date(0);
            return dateB - dateA;
        });
        
        if (historico.length > 0) {
            const ultimoVencedor = historico[0];
            const vencedorDiv = document.getElementById('vencedorInfo');
            const vencedorNome = document.getElementById('vencedorNome');
            const vencedorData = document.getElementById('vencedorData');
            
            if (vencedorDiv) vencedorDiv.style.display = 'block';
            if (vencedorNome) vencedorNome.innerHTML = `🏆 Último vencedor: ${ultimoVencedor.participanteNome}`;
            if (vencedorData) vencedorData.innerHTML = `Vitória em ${ultimoVencedor.dataVitoria?.toDate?.()?.toLocaleDateString('pt-BR') || '-'}`;
        }
    } catch (error) {
        console.error('❌ Erro ao carregar último vencedor:', error);
    }
}

async function atualizarStatusSorteio() {
    const statusSpan = document.getElementById('statusSorteio');
    const horaSpan = document.getElementById('ultimaVerificacao');
    
    if (!statusSpan) return;
    
    const agora = new Date();
    const horaStr = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dataStr = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    
    if (horaSpan) horaSpan.textContent = `${dataStr} ${horaStr}`;
    
    if (!jogoId) {
        statusSpan.innerHTML = '⏳ Sem jogo ativo';
        statusSpan.className = 'aguardando';
        return;
    }
    
    try {
        const response = await fetch('https://loteriascaixa-api.herokuapp.com/api/quina/latest');
        const dados = await response.json();
        const concursoAPI = dados.concurso;
        
        const jogoRef = doc(db, 'jogos', jogoId);
        const jogoDoc = await getDoc(jogoRef);
        const concursoImportado = jogoDoc.data()?.ultimoConcursoImportado;
        const hoje = new Date();
        const diaSemana = hoje.getDay();
        const hora = hoje.getHours();
        
        const temSorteioHoje = (diaSemana >= 1 && diaSemana <= 6);
        
        if (concursoAPI === concursoImportado) {
            statusSpan.innerHTML = '✅ Atualizado';
            statusSpan.className = 'atualizado';
        } else {
            if (!temSorteioHoje) {
                statusSpan.innerHTML = '📌 Hoje não há sorteio (domingo)';
                statusSpan.className = 'aguardando';
            } else if (hora < 20) {
                statusSpan.innerHTML = '⏳ Aguardando sorteio de hoje (20h)';
                statusSpan.className = 'aguardando';
            } else {
                statusSpan.innerHTML = '🔄 Buscando sorteio de hoje...';
                statusSpan.className = 'verificando';
            }
        }
    } catch (error) {
        console.error('Erro ao verificar status:', error);
        statusSpan.innerHTML = '⚠️ Falha na verificação';
        statusSpan.className = 'erro';
    }
}

// ============================================
// FUNÇÃO PARA MOSTRAR DETALHES DO PARTICIPANTE
// ============================================
window.mostrarDetalhes = function(participanteId) {
    const participante = participantes.find(p => p.id === participanteId);
    if (!participante) return;
    
    let acertos = 0;
    let msg = `📋 ${participante.nome}\n\n🎯 Números Selecionados (17):\n`;
    
    if (participante.numeros && Array.isArray(participante.numeros)) {
        for (const num of participante.numeros) {
            const acertou = numerosSorteadosAcumulados.includes(num);
            if (acertou) acertos++;
            msg += `${num} ${acertou ? '✅' : '❌'}  `;
        }
    }
    
    msg += `\n\n✅ Acertos: ${acertos}/17`;
    msg += `\n📊 Progresso: ${Math.round((acertos/17)*100)}%`;
    
    if (participante.acertouTodos) {
        msg += '\n\n🏆 VENCEDOR! Acertou todos os 17 números!';
    }
    
    alert(msg);
};

// EXPORTAR PARA O CONSOLE
window.carregarJogoAtivo = carregarJogoAtivo;
window.atualizarRanking = atualizarRanking;
window.participantes = participantes;
window.jogoAtual = jogoAtual;