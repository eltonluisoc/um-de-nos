import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    onSnapshot, 
    orderBy, 
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
        escutarParticipantes();
    }
}

async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'aberto'));
    
    try {
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
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
        
        console.log('Jogo ativo:', jogoId, jogoAtual);
        
        document.getElementById('statusJogo').innerHTML = `
            <span class="status-badge">🎯 JOGO EM ANDAMENTO</span>
        `;
        
        if (jogoAtual.ultimosNumerosSorteados) {
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

async function carregarSorteios() {
    const sorteiosRef = collection(db, 'sorteios_quina');
    const q = query(sorteiosRef, orderBy('concurso', 'desc'));
    
    const querySnapshot = await getDocs(q);
    sorteiosRealizados = [];
    
    const container = document.getElementById('listaSorteios');
    if (querySnapshot.empty) {
        container.innerHTML = '<div>Nenhum sorteio importado ainda.</div>';
        return;
    }
    
    let html = '';
    querySnapshot.forEach(doc => {
        const s = doc.data();
        sorteiosRealizados.push(s);
        html += `
            <div class="sorteio-item">
                <span>#${s.concurso}</span> ${s.numeros.join(', ')}
            </div>
        `;
    });
    container.innerHTML = html;
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
    
    let html = '<div class="grid-numeros" style="display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px;">';
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
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoId), orderBy('acertos', 'desc'));
    
    onSnapshot(q, (snapshot) => {
        participantes = [];
        snapshot.forEach((doc) => {
            participantes.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        atualizarRanking(participantes);
        verificarVencedor(participantes);
        
    }, (error) => {
        console.error('Erro ao escutar participantes:', error);
    });
}

// FUNÇÃO PRINCIPAL DO RANKING - COM FORMATAÇÃO CORRETA
function atualizarRanking(participantes) {
    const container = document.getElementById('listaParticipantes');
    const totalSpan = document.getElementById('totalParticipantes');
    const maiorSpan = document.getElementById('maiorPontuacao');
    
    if (participantes.length === 0) {
        container.innerHTML = '<div class="loading">📋 Nenhum participante cadastrado ainda...</div>';
        if (totalSpan) totalSpan.textContent = '0';
        if (maiorSpan) maiorSpan.textContent = '0';
        return;
    }
    
    // Atualizar estatísticas
    const maiorAcertos = Math.max(...participantes.map(p => p.acertos || 0));
    if (totalSpan) totalSpan.textContent = participantes.length;
    if (maiorSpan) maiorSpan.textContent = `${maiorAcertos}`;
    
    // Ordenar por acertos (decrescente)
    const ordenados = [...participantes].sort((a, b) => (b.acertos || 0) - (a.acertos || 0));
    const ultimoIndex = ordenados.length - 1;
    
    let html = '';
    
    ordenados.forEach((p, index) => {
        const posicao = index + 1;
        const progressoPercent = ((p.acertos || 0) / 17) * 100;
        const isChampion = p.acertouTodos === true;
        const isFirst = posicao === 1;
        const isSecond = posicao === 2;
        const isLast = index === ultimoIndex;
        
        // Definir classe especial
        let rowClass = '';
        let medalhaIcon = '';
        
        if (isFirst) {
            rowClass = 'first-place';
            medalhaIcon = '👑';
        } else if (isSecond) {
            rowClass = 'second-place';
            medalhaIcon = '🥈';
        } else if (isLast && ordenados.length > 2) {
            rowClass = 'last-place';
            medalhaIcon = '🎯';
        }
        
        if (isChampion) rowClass += ' champion';
        
        // Texto da posição
        let posText = '';
        if (isFirst) {
            posText = `${medalhaIcon} 1º`;
        } else if (isSecond) {
            posText = `${medalhaIcon} 2º`;
        } else if (isLast && ordenados.length > 2) {
            posText = `${medalhaIcon} ${posicao}º`;
        } else {
            posText = `${posicao}º`;
        }
        
        // Gerar números do participante
        let numerosHtml = '<div class="player-numbers">';
        if (p.numeros && Array.isArray(p.numeros)) {
            for (const num of p.numeros) {
                const acertou = numerosSorteadosAcumulados && numerosSorteadosAcumulados.includes(num);
                numerosHtml += `<span class="number-badge ${acertou ? 'hit' : ''}">${num}</span>`;
            }
        }
        numerosHtml += '</div>';
        
        // Badge de menos acertos
        let lastBadge = '';
        if (isLast && ordenados.length > 2) {
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
    const q = query(historicoRef, orderBy('dataVitoria', 'desc'));
    
    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const ultimoVencedor = querySnapshot.docs[0].data();
            document.getElementById('vencedorInfo').style.display = 'block';
            document.getElementById('vencedorNome').innerHTML = `🏆 Último vencedor: ${ultimoVencedor.participanteNome}`;
            document.getElementById('vencedorData').innerHTML = `Vitória em ${new Date(ultimoVencedor.dataVitoria).toLocaleDateString('pt-BR')}`;
        }
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
    }
}

// Recarregar a página a cada 2 minutos para garantir dados atualizados
let ultimoRecarregamento = Date.now();
setInterval(() => {
    const agora = Date.now();
    if (agora - ultimoRecarregamento > 120000) {
        console.log('🔄 Auto-recarregamento para atualizar dados...');
        ultimoRecarregamento = agora;
        window.location.reload();
    }
}, 30000);