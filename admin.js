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
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Configurações
const SENHA_ADMIN = "172163";
let jogoAtualId = null;
let intervaloBusca = null;
let ultimoConcursoBuscado = null;

// Aguardar DOM carregar
document.getElementById('btnEntrarAdmin')?.addEventListener('click', verificarSenha);
// Adicionar suporte para tecla Enter
document.getElementById('senhaInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') verificarSenha();
});

function inicializarEventos() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('ativo'));
            tab.classList.add('ativo');
            document.getElementById(tabId).classList.add('ativo');
        });
    });
    
    document.getElementById('btnSalvarParticipante')?.addEventListener('click', salvarParticipante);
    document.getElementById('btnBuscarSorteio')?.addEventListener('click', buscarSorteioQuina);
    document.getElementById('btnEncerrarJogo')?.addEventListener('click', encerrarJogo);
    document.getElementById('btnNovoJogo')?.addEventListener('click', iniciarNovoJogo);
    document.getElementById('btnResetarTudo')?.addEventListener('click', resetarTudo);
    
    criarGridNumeros();
}

function verificarSenha() {
    const senha = document.getElementById('senhaInput').value;
    const btn = document.getElementById('btnEntrarAdmin');
    const loading = document.getElementById('msgLoading');
    const msgErro = document.getElementById('msgErro');
    
    if (!senha) {
        msgErro.textContent = '⚠️ Digite a senha';
        return;
    }
    
    msgErro.textContent = '';
    loading.style.display = 'block';
    btn.disabled = true;
    btn.textContent = '⏳ VERIFICANDO...';
    
    // Simular delay para feedback
    setTimeout(() => {
        if (senha === SENHA_ADMIN) {
            loading.style.display = 'none';
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('adminContent').style.display = 'block';
            carregarDados();
        } else {
            loading.style.display = 'none';
            msgErro.textContent = '❌ Senha incorreta! Tente novamente.';
            btn.disabled = false;
            btn.textContent = '🔐 ENTRAR';
            document.getElementById('senhaInput').value = '';
            document.getElementById('senhaInput').focus();
        }
    }, 500);
}

function logout() {
    if (intervaloBusca) clearInterval(intervaloBusca);
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('adminContent').style.display = 'none';
    document.getElementById('senhaInput').value = '';
}

async function carregarDados() {
    await carregarJogoAtivo();
    if (jogoAtualId) {
        await carregarRanking();
        await carregarTodosParticipantes();
    }
    iniciarBuscaAutomatica();
}

async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'aberto'));
    
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const jogoDoc = querySnapshot.docs[0];
        jogoAtualId = jogoDoc.id;
        ultimoConcursoBuscado = jogoDoc.data().ultimoConcursoImportado;
        
        const statusDiv = document.getElementById('statusAdmin');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <p>✅ Jogo ativo: ${jogoDoc.data().nome || 'Edição atual'}</p>
                <p>📅 Criado em: ${jogoDoc.data().createdAt?.toDate()?.toLocaleString('pt-BR') || 'Nova'}</p>
                <p>🎲 Último sorteio: ${jogoDoc.data().ultimoConcursoImportado || 'Nenhum ainda'}</p>
            `;
        }
    } else {
        await iniciarNovoJogo();
    }
}

function isHorarioSorteios() {
    const agora = new Date();
    const hora = agora.getHours();
    return (hora >= 20 && hora <= 23);
}

function iniciarBuscaAutomatica() {
    if (intervaloBusca) clearInterval(intervaloBusca);
    
    console.log('🔄 Busca automática configurada');
    
    setTimeout(() => {
        if (isHorarioSorteios() && jogoAtualId) {
            buscarSorteioQuina();
        }
    }, 3000);
    
    intervaloBusca = setInterval(() => {
        if (jogoAtualId && isHorarioSorteios()) {
            console.log('⏰ Busca automática...');
            buscarSorteioQuina();
        }
    }, 300000);
}

async function carregarRanking() {
    if (!jogoAtualId) {
        console.log('Sem jogoAtualId');
        return;
    }
    
    const container = document.getElementById('listaRankingAdmin');
    if (!container) return;
    
    container.innerHTML = '<div>Carregando ranking...</div>';
    
    try {
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            container.innerHTML = '<div>Nenhum participante cadastrado.</div>';
            return;
        }
        
        const participantes = [];
        querySnapshot.forEach(doc => {
            participantes.push({ id: doc.id, ...doc.data() });
        });
        participantes.sort((a, b) => (b.acertos || 0) - (a.acertos || 0));
        
        let html = '';
        let pos = 1;
        for (const p of participantes) {
            const progresso = ((p.acertos || 0) / 17) * 100;
            const medalha = pos === 1 ? '🥇 ' : (pos === 2 ? '🥈 ' : (pos === 3 ? '🥉 ' : ''));
            html += `
                <div class="linha-participante">
                    <span>${medalha}${pos++}º</span>
                    <span><strong>${p.nome}</strong></span>
                    <span>${p.acertos || 0}/17</span>
                    <div class="barra-progresso">
                        <div class="barra-progresso-fill" style="width: ${progresso}%"></div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erro ranking:', error);
        container.innerHTML = '<div>Erro ao carregar ranking</div>';
    }
}

async function carregarTodosParticipantes() {
    if (!jogoAtualId) return;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const querySnapshot = await getDocs(q);
    const tbody = document.getElementById('corpoTabela');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    for (const docSnap of querySnapshot.docs) {
        const p = docSnap.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${p.nome}</td>
            <td>${p.numeros.join(', ')}</td>
            <td>${p.acertos || 0}/17</td>
            <td><button class="btn-danger" onclick="window.excluirParticipante('${docSnap.id}')">Excluir</button></td>
        `;
        tbody.appendChild(tr);
    }
}

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
    
    const contador = document.getElementById('contadorNumeros');
    if (contador) contador.innerHTML = `${numerosSelecionados.length}/17 números selecionados`;
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
        
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
        const querySnapshot = await getDocs(q);
        
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        await updateDoc(jogoRef, { totalParticipantes: querySnapshot.size });
        
        alert('Participante cadastrado com sucesso!');
        
        document.getElementById('nomeParticipante').value = '';
        document.querySelectorAll('.numero-btn.selecionado').forEach(btn => {
            btn.classList.remove('selecionado');
        });
        numerosSelecionados = [];
        document.getElementById('contadorNumeros').innerHTML = '0/17 números selecionados';
        
        await carregarTodosParticipantes();
        await carregarRanking();
        
    } catch (error) {
        console.error('Erro ao salvar:', error);
        alert('Erro ao salvar participante: ' + error.message);
    }
}

async function buscarSorteioQuina() {
    console.log('🔍 Função buscarSorteioQuina iniciada');
    
    if (!jogoAtualId) {
        console.log('❌ Sem jogo ativo');
        alert('Nenhum jogo ativo encontrado!');
        return;
    }
    
    const btn = document.getElementById('btnBuscarSorteio');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Buscando...';
    }
    
    try {
        console.log('📡 Buscando API da Quina...');
        const response = await fetch('https://loteriascaixa-api.herokuapp.com/api/quina/latest');
        console.log('📡 Resposta recebida:', response.status);
        
        const dados = await response.json();
        console.log('📡 Dados recebidos:', dados);
        
        if (!dados || !dados.dezenas) {
            throw new Error('Não foi possível obter os números da Quina');
        }
        
        const numerosSorteados = dados.dezenas.map(Number);
        const concurso = dados.concurso;
        
        console.log(`🎲 Sorteio ${concurso}:`, numerosSorteados);
        
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        const jogoDoc = await getDoc(jogoRef);
        const jogoData = jogoDoc.data();
        
        if (jogoData.status !== 'aberto') {
            console.log('⚠️ Jogo já encerrado');
            alert('Jogo já encerrado!');
            return;
        }
        
        if (ultimoConcursoBuscado === concurso) {
            console.log(`⚠️ Sorteio ${concurso} já foi importado`);
            alert(`Sorteio ${concurso} já foi importado anteriormente!`);
            return;
        }
        
        let dataSorteio = null;
        if (dados.data) {
            dataSorteio = new Date(dados.data);
            if (isNaN(dataSorteio.getTime())) dataSorteio = null;
        }
        
        await addDoc(collection(db, 'sorteios_quina'), {
            concurso: concurso,
            numeros: numerosSorteados,
            data: dataSorteio || new Date(),
            importadoEm: new Date()
        });
        
        await updateDoc(jogoRef, {
            ultimosNumerosSorteados: numerosSorteados,
            ultimoConcursoImportado: concurso
        });
        
        ultimoConcursoBuscado = concurso;
        await atualizarAcertosParticipantes(numerosSorteados);
        
        alert(`✅ Sorteio ${concurso} importado! Números: ${numerosSorteados.join(', ')}`);
        await carregarRanking();
        
    } catch (error) {
        console.error('❌ Erro:', error);
        alert('Erro ao buscar sorteio: ' + error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📢 Buscar Último Sorteio da Quina';
        }
    }
}

async function atualizarAcertosParticipantes(novosNumeros) {
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const querySnapshot = await getDocs(q);
    
    for (const docSnap of querySnapshot.docs) {
        const participante = docSnap.data();
        if (participante.acertouTodos) continue;
        
        let novosAcertos = 0;
        for (const num of novosNumeros) {
            if (participante.numeros.includes(num)) novosAcertos++;
        }
        
        const novoTotal = (participante.acertos || 0) + novosAcertos;
        
        await updateDoc(doc(db, 'participantes', docSnap.id), { acertos: novoTotal });
        
        if (novoTotal >= 17) {
            await declararVencedor(docSnap.id, participante.nome);
            return;
        }
    }
    await carregarRanking();
}

async function declararVencedor(participanteId, nome) {
    const jogoRef = doc(db, 'jogos', jogoAtualId);
    const jogoDoc = await getDoc(jogoRef);
    
    if (jogoDoc.data().status !== 'aberto') return;
    
    await updateDoc(jogoRef, {
        status: 'encerrado',
        vencedorId: participanteId,
        vencedorNome: nome,
        encerradoEm: new Date()
    });
    
    await updateDoc(doc(db, 'participantes', participanteId), {
        acertouTodos: true,
        ordemVitoria: 1
    });
    
    await addDoc(collection(db, 'historico_vencedores'), {
        jogoId: jogoAtualId,
        participanteId: participanteId,
        participanteNome: nome,
        dataVitoria: new Date()
    });
    
    if (intervaloBusca) clearInterval(intervaloBusca);
    
    alert(`🏆 VENCEDOR! ${nome} acertou 17 números primeiro! 🏆`);
    setTimeout(() => window.location.reload(), 2000);
}

async function encerrarJogo() {
    if (confirm('Encerrar jogo atual?')) {
        if (intervaloBusca) clearInterval(intervaloBusca);
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        await updateDoc(jogoRef, { status: 'encerrado' });
        alert('Jogo encerrado!');
        await carregarJogoAtivo();
        iniciarBuscaAutomatica();
    }
}

async function iniciarNovoJogo() {
    const nomeJogo = prompt('Nome da edição:', `Um de Nós - ${new Date().toLocaleDateString('pt-BR')}`);
    if (nomeJogo) {
        if (intervaloBusca) clearInterval(intervaloBusca);
        
        const docRef = await addDoc(collection(db, 'jogos'), {
            nome: nomeJogo,
            status: 'aberto',
            createdAt: new Date(),
            ultimoConcursoImportado: null,
            ultimosNumerosSorteados: null,
            totalParticipantes: 0
        });
        
        jogoAtualId = docRef.id;
        ultimoConcursoBuscado = null;
        
        alert('Novo jogo criado!');
        await carregarJogoAtivo();
        await carregarRanking();
        await carregarTodosParticipantes();
        iniciarBuscaAutomatica();
    }
}

async function resetarTudo() {
    if (confirm('⚠️ ATENÇÃO! Isso vai apagar TODOS os dados. Tem certeza?')) {
        const confirmacao = prompt('Digite "SIM" para confirmar');
        if (confirmacao === 'SIM') {
            if (intervaloBusca) clearInterval(intervaloBusca);
            
            const participantes = await getDocs(collection(db, 'participantes'));
            const jogos = await getDocs(collection(db, 'jogos'));
            const sorteios = await getDocs(collection(db, 'sorteios_quina'));
            const historico = await getDocs(collection(db, 'historico_vencedores'));
            
            const batch = writeBatch(db);
            participantes.forEach(doc => batch.delete(doc.ref));
            jogos.forEach(doc => batch.delete(doc.ref));
            sorteios.forEach(doc => batch.delete(doc.ref));
            historico.forEach(doc => batch.delete(doc.ref));
            
            await batch.commit();
            alert('Todos os dados foram apagados!');
            window.location.reload();
        }
    }
}

window.excluirParticipante = async function(id) {
    if (confirm('Excluir este participante?')) {
        await deleteDoc(doc(db, 'participantes', id));
        await carregarTodosParticipantes();
        await carregarRanking();
        alert('Participante excluído!');
    }
};
window.buscarSorteioQuina = buscarSorteioQuina; 
window.verificarSenha = verificarSenha;
window.logout = logout;