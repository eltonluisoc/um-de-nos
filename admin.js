import { db } from './firebase-config.js';
import { 
    collection, 
    addDoc, 
    getDocs, 
    getDoc,
    updateDoc, 
    deleteDoc, 
    doc, 
    query, 
    where, 
    orderBy, 
    onSnapshot,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Configurações
const SENHA_ADMIN = "172163";
let jogoAtualId = null;

// Aguardar DOM carregar
document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin carregado');
    inicializarEventos();
});

function inicializarEventos() {
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('ativo'));
            tab.classList.add('ativo');
            document.getElementById(tabId).classList.add('ativo');
        });
    });
    
    // Botões
    document.getElementById('btnSalvarParticipante')?.addEventListener('click', salvarParticipante);
    document.getElementById('btnBuscarSorteio')?.addEventListener('click', buscarSorteioQuina);
    document.getElementById('btnEncerrarJogo')?.addEventListener('click', encerrarJogo);
    document.getElementById('btnNovoJogo')?.addEventListener('click', iniciarNovoJogo);
    document.getElementById('btnResetarTudo')?.addEventListener('click', resetarTudo);
    
    // Criar grid de números
    criarGridNumeros();
}

function verificarSenha() {
    const senha = document.getElementById('senhaInput').value;
    if (senha === SENHA_ADMIN) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('adminContent').style.display = 'block';
        carregarDados();
    } else {
        alert('Senha incorreta!');
    }
}

function logout() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('adminContent').style.display = 'none';
    document.getElementById('senhaInput').value = '';
}

function carregarDados() {
    carregarJogoAtivo();
    carregarRanking();
    carregarTodosParticipantes();
}

async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'aberto'));
    
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const jogoDoc = querySnapshot.docs[0];
        jogoAtualId = jogoDoc.id;
        const statusDiv = document.getElementById('statusAdmin');
        statusDiv.innerHTML = `
            <p>✅ Jogo ativo: ${jogoDoc.data().nome || 'Edição atual'}</p>
            <p>📅 Criado em: ${new Date(jogoDoc.data().createdAt?.toDate()).toLocaleString('pt-BR')}</p>
            <p>🎲 Último sorteio: ${jogoDoc.data().ultimoConcursoImportado || 'Nenhum ainda'}</p>
        `;
    } else {
        // Criar novo jogo se não existir
        await iniciarNovoJogo();
    }
}

async function carregarRanking() {
    if (!jogoAtualId) return;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId), orderBy('acertos', 'desc'));
    
    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('listaRankingAdmin');
        if (snapshot.empty) {
            container.innerHTML = '<div>Nenhum participante cadastrado.</div>';
            return;
        }
        
        let html = '';
        let pos = 1;
        snapshot.forEach((doc) => {
            const p = doc.data();
            const progresso = (p.acertos / 17) * 100;
            html += `
                <div class="linha-participante">
                    <span>${pos++}º</span>
                    <span><strong>${p.nome}</strong></span>
                    <span>${p.acertos}/17</span>
                    <div class="barra-progresso">
                        <div class="barra-progresso-fill" style="width: ${progresso}%"></div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    });
}

async function carregarTodosParticipantes() {
    if (!jogoAtualId) return;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    
    const querySnapshot = await getDocs(q);
    const tbody = document.getElementById('corpoTabela');
    tbody.innerHTML = '';
    
    for (const docSnap of querySnapshot.docs) {
        const p = docSnap.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${p.nome}</td>
            <td>${p.numeros.join(', ')}</td>
            <td>${p.acertos}/17</td>
            <td><button class="btn-danger" onclick="excluirParticipante('${docSnap.id}')">Excluir</button></td>
        `;
        tbody.appendChild(tr);
    }
}

// Criar grid de números 1-80
function criarGridNumeros() {
    const grid = document.getElementById('numerosGrid');
    if (!grid) return;
    
    for (let i = 1; i <= 80; i++) {
        const div = document.createElement('div');
        div.className = 'numero-btn';
        div.textContent = i;
        div.dataset.numero = i;
        div.addEventListener('click', () => toggleNumero(div));
        grid.appendChild(div);
    }
}

let numerosSelecionados = [];

function toggleNumero(element) {
    const num = parseInt(element.dataset.numero);
    const index = numerosSelecionados.indexOf(num);
    
    if (index === -1 && numerosSelecionados.length < 17) {
        numerosSelecionados.push(num);
        element.classList.add('selecionado');
    } else if (index !== -1) {
        numerosSelecionados.splice(index, 1);
        element.classList.remove('selecionado');
    }
    
    document.getElementById('contadorNumeros').innerHTML = `${numerosSelecionados.length}/17 números selecionados`;
}

async function salvarParticipante() {
    const nome = document.getElementById('nomeParticipante').value;
    
    if (!nome) {
        alert('Digite o nome do participante!');
        return;
    }
    
    if (numerosSelecionados.length !== 17) {
        alert(`Selecione exatamente 17 números! Você selecionou ${numerosSelecionados.length}`);
        return;
    }
    
    if (!jogoAtualId) {
        alert('Nenhum jogo ativo!');
        return;
    }
    
    try {
        await addDoc(collection(db, 'participantes'), {
            nome: nome,
            jogoId: jogoAtualId,
            numeros: numerosSelecionados.sort((a,b) => a-b),
            acertos: 0,
            acertouTodos: false,
            ordemVitoria: null,
            dataCadastro: new Date()
        });
        
        alert('Participante cadastrado com sucesso!');
        document.getElementById('nomeParticipante').value = '';
        numerosSelecionados.forEach(n => {
            const btns = document.querySelectorAll('.numero-btn');
            btns.forEach(btn => {
                if (parseInt(btn.dataset.numero) === n) {
                    btn.classList.remove('selecionado');
                }
            });
        });
        numerosSelecionados = [];
        document.getElementById('contadorNumeros').innerHTML = '0/17 números selecionados';
        carregarTodosParticipantes();
        
    } catch (error) {
        console.error('Erro ao salvar:', error);
        alert('Erro ao salvar participante!');
    }
}

async function buscarSorteioQuina() {
    alert('Buscando sorteio da Quina... (API será implementada)');
    // TODO: Implementar chamada à API
}

async function encerrarJogo() {
    if (confirm('Tem certeza que deseja encerrar o jogo atual?')) {
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        await updateDoc(jogoRef, { status: 'encerrado' });
        alert('Jogo encerrado!');
        carregarJogoAtivo();
    }
}

async function iniciarNovoJogo() {
    const nomeJogo = prompt('Nome da edição:', `Um de Nós - ${new Date().toLocaleDateString('pt-BR')}`);
    if (nomeJogo) {
        const docRef = await addDoc(collection(db, 'jogos'), {
            nome: nomeJogo,
            status: 'aberto',
            createdAt: new Date(),
            ultimoConcursoImportado: null,
            ultimosNumerosSorteados: null,
            totalParticipantes: 0
        });
        jogoAtualId = docRef.id;
        alert('Novo jogo criado!');
        carregarJogoAtivo();
    }
}

async function resetarTudo() {
    if (confirm('⚠️ ATENÇÃO! Isso vai apagar TODOS os dados. Tem certeza?')) {
        if (confirm('ÚLTIMA CONFIRMAÇÃO: Digite "SIM" para continuar')) {
            // Apagar participantes
            const participantes = await getDocs(collection(db, 'participantes'));
            const batch = writeBatch(db);
            participantes.forEach(doc => batch.delete(doc.ref));
            
            // Apagar jogos
            const jogos = await getDocs(collection(db, 'jogos'));
            jogos.forEach(doc => batch.delete(doc.ref));
            
            await batch.commit();
            alert('Todos os dados foram apagados!');
            window.location.reload();
        }
    }
}

window.excluirParticipante = async function(id) {
    if (confirm('Excluir este participante?')) {
        await deleteDoc(doc(db, 'participantes', id));
        carregarTodosParticipantes();
        alert('Participante excluído!');
    }
};

window.verificarSenha = verificarSenha;
window.logout = logout;