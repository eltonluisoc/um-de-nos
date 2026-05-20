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

// Variáveis globais
let jogoAtual = null;
let jogoId = null;

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Um de Nós - Página Pública iniciada');
    carregarJogoAtivo();
});

// Buscar jogo ativo
async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'aberto'));
    
    try {
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            // Nenhum jogo ativo, tentar pegar o último encerrado
            console.log('Nenhum jogo ativo');
            document.getElementById('listaParticipantes').innerHTML = `
                <div class="loading">⚡ Nenhum jogo em andamento. Aguarde o próximo!</div>
            `;
            document.getElementById('statusJogo').innerHTML = `
                <span class="status-badge" style="background:#888;">⏸️ JOGO ENCERRADO</span>
            `;
            carregarUltimoVencedor();
            return;
        }
        
        // Pega o primeiro jogo ativo
        const jogoDoc = querySnapshot.docs[0];
        jogoAtual = jogoDoc.data();
        jogoId = jogoDoc.id;
        
        console.log('Jogo ativo:', jogoId, jogoAtual);
        
        // Atualizar status
        document.getElementById('statusJogo').innerHTML = `
            <span class="status-badge">🎯 JOGO EM ANDAMENTO</span>
        `;
        
        // Mostrar últimos números sorteados se existir
        if (jogoAtual.ultimosNumerosSorteados) {
            mostrarNumerosSorteados(jogoAtual.ultimosNumerosSorteados);
        }
        
        // Iniciar escuta em tempo real dos participantes
        escutarParticipantes();
        
    } catch (error) {
        console.error('Erro ao carregar jogo:', error);
        document.getElementById('listaParticipantes').innerHTML = `
            <div class="loading">❌ Erro ao carregar dados. Tente novamente.</div>
        `;
    }
}

// Escutar participantes em tempo real (atualiza automático)
function escutarParticipantes() {
    const participantesRef = collection(db, 'participantes');
    const q = query(
        participantesRef, 
        where('jogoId', '==', jogoId),
        orderBy('acertos', 'desc')
    );
    
    onSnapshot(q, (snapshot) => {
        const participantes = [];
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

// Atualizar ranking na tela
function atualizarRanking(participantes) {
    const container = document.getElementById('listaParticipantes');
    
    if (participantes.length === 0) {
        container.innerHTML = '<div class="loading">📋 Nenhum participante cadastrado ainda...</div>';
        return;
    }
    
    let html = '';
    participantes.forEach((p, index) => {
        const posicao = index + 1;
        const progressoPercent = (p.acertos / 17) * 100;
        const destaque = p.acertouTodos ? 'destaque' : '';
        
        let medalha = '';
        if (posicao === 1) medalha = '🥇 ';
        else if (posicao === 2) medalha = '🥈 ';
        else if (posicao === 3) medalha = '🥉 ';
        else medalha = `${posicao}º `;
        
        html += `
            <div class="linha-participante ${destaque}">
                <span>${medalha}</span>
                <span><strong>${p.nome}</strong></span>
                <span>${p.acertos}/17</span>
                <div class="barra-progresso">
                    <div class="barra-progresso-fill" style="width: ${progressoPercent}%"></div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Verificar se alguém venceu
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

// Mostrar últimos números sorteados
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

// Carregar último vencedor do histórico
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