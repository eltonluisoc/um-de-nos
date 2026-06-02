import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    onSnapshot, 
    doc, 
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let jogoAtual = null;
let jogoId = null;
let participantes = [];
let numerosSorteadosAcumulados = [];
let sorteiosRealizados = [];

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Um de Nós - Página Pública iniciada');
    carregarDados();
});

async function carregarDados() {
    await carregarJogoAtivo();
    if (jogoId) {
        await carregarPremiacao();
        await carregarSorteios();
        await carregarNumerosSorteados();
        await carregarParticipantes();  // Carrega participantes IMEDIATAMENTE
        escutarParticipantes();          // Escuta mudanças em tempo real
        await atualizarStatusSorteio();
    }
}

async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'aberto'));
    
    try {
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            console.log('Nenhum jogo ativo');
            document.getElementById('listaParticipantes').innerHTML = `
                <div class="loading">⚡ Nenhum jogo em andamento. Aguarde o próximo!</div>
            `;
            document.getElementById('statusJogo').innerHTML = `
                <span class="status-badge" style="background:#888;">⏸️ AGUARDANDO PRÓXIMO JOGO</span>
            `;
            await carregarUltimoVencedor();
            return;
        }
        
        const jogoDoc = querySnapshot.docs[0];
        jogoAtual = jogoDoc.data();
        jogoId = jogoDoc.id;
        
        console.log('Jogo ativo encontrado:', jogoId, jogoAtual.nome);
        
        document.getElementById('statusJogo').innerHTML = `
            <span class="status-badge">🎯 JOGO EM ANDAMENTO</span>
        `;
        
        if (jogoAtual.ultimosNumerosSorteados && jogoAtual.ultimosNumerosSorteados.length > 0) {
            mostrarNumerosSorteados(jogoAtual.ultimosNumerosSorteados);
        }
        
    } catch (error) {
        console.error('Erro ao carregar jogo:', error);
    }
}

async function carregarPremiacao() {
    if (!jogoAtual) return;
    
    const valorInscricao = jogoAtual.valorInscricao || 50;
    const totalParticipantes = jogoAtual.totalParticipantes || 0;
    const premioTotal = valorInscricao * totalParticipantes;
    
    const premio1 = premioTotal * 0.63;
    const premio2 = premioTotal * 0.20;
    const premio3 = premioTotal * 0.05;
    
    document.getElementById('premio1').innerHTML = `R$ ${premio1.toFixed(2)}`;
    document.getElementById('premio2').innerHTML = `R$ ${premio2.toFixed(2)}`;
    document.getElementById('premio3').innerHTML = `R$ ${premio3.toFixed(2)}`;
    document.getElementById('premiacao').style.display = 'grid';
}

// FUNÇÃO PRINCIPAL - CARREGA PARTICIPANTES
async function carregarParticipantes() {
    if (!jogoId) {
        console.log('Sem jogoId, participantes não carregados');
        return;
    }
    
    console.log('🔍 Carregando participantes da competição:', jogoId);
    
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
        
        console.log(`✅ ${participantes.length} participantes encontrados`);
        
        // Atualizar estatísticas
        const totalSpan = document.getElementById('totalParticipantes');
        const maiorSpan = document.getElementById('maiorPontuacao');
        if (totalSpan) totalSpan.textContent = participantes.length;
        if (maiorSpan && participantes.length > 0) {
            const maiorAcertos = Math.max(...participantes.map(p => p.acertos || 0));
            maiorSpan.textContent = `${maiorAcertos}`;
        }
        
        // Atualizar ranking
        atualizarRanking(participantes);
        
    } catch (error) {
        console.error('Erro ao carregar participantes:', error);
        document.getElementById('listaParticipantes').innerHTML = '<div class="loading">❌ Erro ao carregar participantes</div>';
    }
}

async function carregarSorteios() {
    if (!jogoId) return;
    
    const sorteiosRef = collection(db, 'sorteios_quina');
    const q = query(sorteiosRef, where('competicaoId', '==', jogoId));
    const querySnapshot = await getDocs(q);
    sorteiosRealizados = [];
    
    const container = document.getElementById('listaSorteios');
    if (querySnapshot.empty) {
        container.innerHTML = '<div>Nenhum sorteio importado ainda.</div>';
        return;
    }
    
    const sorteios = [];
    querySnapshot.forEach(doc => {
        sorteios.push({ id: doc.id, ...doc.data() });
    });
    sorteios.sort((a, b) => b.concurso - a.concurso);
    
    let html = '';
    for (const s of sorteios) {
        sorteiosRealizados.push(s);
        html += `
            <div class="sorteio-item">
                <span>#${s.concurso}</span> ${s.numeros.join(', ')}
            </div>
        `;
    }
    container.innerHTML = html;
    console.log(`${sorteios.length} sorteios carregados`);
}

async function carregarNumerosSorteados() {
    const grid = document.getElementById('gridNumerosSorteados');
    numerosSorteadosAcumulados = [];
    
    for (const sorteio of sorteiosRealizados) {
        for (const num of sorteio.numeros) {
            if (!numerosSorteadosAcumulados.includes(num)) {
                numerosSorteadosAcumulados.push(num);
            }
        }
    }
    
    let html = '<div class="grid-numeros">';
    for (let i = 1; i <= 80; i++) {
        const foiSorteado = numerosSorteadosAcumulados.includes(i);
        html += `
            <div class="grid-numero ${foiSorteado ? 'sorteados' : ''}">
                ${i}
            </div>
        `;
    }
    html += '</div>';
    grid.innerHTML = html;
}

function escutarParticipantes() {
    if (!jogoId) return;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoId));
    
    onSnapshot(q, (snapshot) => {
        console.log('🔄 Atualização em tempo real dos participantes');
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
            maiorSpan.textContent = `${maiorAcertos}`;
        }
        
    }, (error) => {
        console.error('Erro ao escutar participantes:', error);
    });
}

function atualizarRanking(participantes) {
    const container = document.getElementById('listaParticipantes');
    
    if (participantes.length === 0) {
        container.innerHTML = '<div class="loading">📋 Nenhum participante cadastrado ainda...</div>';
        return;
    }
    
    const ordenados = [...participantes].sort((a, b) => (b.acertos || 0) - (a.acertos || 0));
    const maiorAcertos = ordenados[0]?.acertos || 0;
    const menorAcertos = ordenados[ordenados.length - 1]?.acertos || 0;
    
    const posicoes = [];
    let posicaoAtual = 1;
    
    for (let i = 0; i < ordenados.length; i++) {
        if (i > 0 && ordenados[i].acertos === ordenados[i-1].acertos) {
            posicoes.push(posicaoAtual);
        } else {
            posicaoAtual = i + 1;
            posicoes.push(posicaoAtual);
        }
    }
    
    const primeiroAcerto = ordenados[0]?.acertos || 0;
    const temEmpatePrimeiro = ordenados.filter(p => p.acertos === primeiroAcerto).length > 1;
    
    let html = '';
    
    ordenados.forEach((p, index) => {
        const posicao = posicoes[index];
        const progressoPercent = ((p.acertos || 0) / 17) * 100;
        const isChampion = p.acertouTodos === true;
        const isLastPlace = p.acertos === menorAcertos;
        
        let rowClass = '';
        let medalhaIcon = '';
        
        if (temEmpatePrimeiro && p.acertos === primeiroAcerto) {
            rowClass = 'first-place';
            medalhaIcon = '👑';
        } else if (posicao === 1 && !temEmpatePrimeiro) {
            rowClass = 'first-place';
            medalhaIcon = '👑';
        } else if (posicao === 2 && ordenados[0].acertos !== p.acertos) {
            rowClass = 'second-place';
            medalhaIcon = '🥈';
        } else if (isLastPlace && ordenados.length > 2) {
            rowClass = 'last-place';
            medalhaIcon = '🎯';
        }
        
        if (isChampion) rowClass += ' champion';
        
        let posText = '';
        if (temEmpatePrimeiro && p.acertos === primeiroAcerto) {
            posText = `👑 ${posicao}º`;
        } else if (posicao === 1 && !temEmpatePrimeiro) {
            posText = `👑 1º`;
        } else if (posicao === 2 && ordenados[0].acertos !== p.acertos) {
            posText = `🥈 2º`;
        } else if (isLastPlace && ordenados.length > 2) {
            posText = `🎯 ${posicao}º`;
        } else {
            posText = `${posicao}º`;
        }
        
        let numerosHtml = '<div class="player-numbers">';
        if (p.numeros && Array.isArray(p.numeros)) {
            for (const num of p.numeros) {
                const acertou = numerosSorteadosAcumulados && numerosSorteadosAcumulados.includes(num);
                numerosHtml += `<span class="number-badge ${acertou ? 'hit' : ''}">${num}</span>`;
            }
        }
        numerosHtml += '</div>';
        
        let lastBadge = '';
        if (isLastPlace && ordenados.length > 2 && !temEmpatePrimeiro) {
            lastBadge = '<span class="last-place-badge">🎯 MENOS ACERTOS</span>';
        }
        
        html += `
            <div class="ranking-row ${rowClass}" onclick="window.mostrarDetalhes('${p.id}')">
                <div class="ranking-pos">${posText}</div>
                <div class="ranking-player">
                    <div class="player-name">${p.nome} ${lastBadge}</div>
                    ${numerosHtml}
                </div>
                <div class="ranking-score">
                    ${p.acertos || 0}<small>/17</small>
                </div>
                <div class="ranking-progress">
                    <div class="progress-wrapper">
                        <div class="progress-bar-container">
                            <div class="progress-fill" style="width: ${progressoPercent}%"></div>
                        </div>
                        <div class="progress-percent">${Math.round(progressoPercent)}%</div>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

window.mostrarDetalhes = function(participanteId) {
    const participante = participantes.find(p => p.id === participanteId);
    if (participante) {
        let acertos = 0;
        let msg = `📋 ${participante.nome}\n\n🎯 Números Selecionados:\n`;
        for (const num of participante.numeros) {
            const acertou = numerosSorteadosAcumulados.includes(num);
            if (acertou) acertos++;
            msg += `${num} ${acertou ? '✅' : '❌'}  `;
        }
        msg += `\n\n✅ Acertos: ${acertos}/17`;
        msg += `\n📊 Progresso: ${Math.round((acertos/17)*100)}%`;
        alert(msg);
    }
};

function mostrarNumerosSorteados(numeros) {
    const container = document.getElementById('numerosSorteio');
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
    
    if (vencedor) {
        document.getElementById('statusJogo').innerHTML = `
            <span class="status-badge" style="background:#ff8c00;">🏆 JOGO ENCERRADO - VENCEDOR ENCONTRADO 🏆</span>
        `;
        
        document.getElementById('vencedorInfo').style.display = 'block';
        document.getElementById('vencedorNome').innerHTML = `🎉 ${vencedor.nome} 🎉`;
        document.getElementById('vencedorData').innerHTML = `Acertou 17 números primeiro!`;
    }
}

async function carregarUltimoVencedor() {
    const historicoRef = collection(db, 'historico_vencedores');
    const querySnapshot = await getDocs(historicoRef);
    
    const historico = [];
    querySnapshot.forEach(doc => {
        historico.push({ id: doc.id, ...doc.data() });
    });
    historico.sort((a, b) => b.dataVitoria?.toDate() - a.dataVitoria?.toDate());
    
    if (historico.length > 0) {
        const ultimoVencedor = historico[0];
        document.getElementById('vencedorInfo').style.display = 'block';
        document.getElementById('vencedorNome').innerHTML = `🏆 Último vencedor: ${ultimoVencedor.participanteNome}`;
        document.getElementById('vencedorData').innerHTML = `Vitória em ${new Date(ultimoVencedor.dataVitoria?.toDate()).toLocaleDateString('pt-BR')}`;
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
        
        if (concursoAPI === concursoImportado) {
            statusSpan.innerHTML = '✅ Atualizado';
            statusSpan.className = 'atualizado';
        } else {
            const horarioAtual = agora.getHours();
            if (horarioAtual >= 20 && horarioAtual <= 23) {
                statusSpan.innerHTML = '⏳ Aguardando sorteio de hoje';
            } else {
                statusSpan.innerHTML = '⏳ Aguardando horário (20h)';
            }
            statusSpan.className = 'aguardando';
        }
    } catch (error) {
        console.error('Erro ao verificar status:', error);
        statusSpan.innerHTML = '⚠️ Falha na verificação';
        statusSpan.className = 'erro';
    }
}