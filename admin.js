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
    writeBatch,
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const SENHA_ADMIN = "172163";
let jogoAtualId = null;
let jogoAtualStatus = null;
let intervaloBusca = null;
let jogoBloqueado = false;
let sorteioEncontradoHoje = false;

// MÚLTIPLAS APIs DA QUINA
const QUINA_APIS = [
    'https://loteriascaixa-api.herokuapp.com/api/quina/latest',
    'https://apiloteria.herokuapp.com/api/quina/latest',
    'https://loterias-api.vercel.app/api/quina/latest'
];

async function buscarSorteioMultiplasAPIs() {
    for (const api of QUINA_APIS) {
        try {
            console.log(`📡 Tentando API: ${api}`);
            const response = await fetch(api);
            if (!response.ok) continue;
            const dados = await response.json();
            
            let numeros, concurso, data;
            
            if (dados.dezenas) {
                numeros = dados.dezenas.map(Number);
                concurso = dados.concurso;
                data = dados.data;
            } else if (dados.listaDezenas) {
                numeros = dados.listaDezenas.map(Number);
                concurso = dados.numero;
                data = dados.dataApuracao;
            } else if (dados.numeros) {
                numeros = dados.numeros.map(Number);
                concurso = dados.concurso;
                data = dados.data;
            }
            
            if (numeros && numeros.length === 5 && concurso) {
                console.log(`✅ Sucesso na API: ${api} - Concurso ${concurso}`);
                return { numeros, concurso, data };
            }
        } catch (error) {
            console.warn(`❌ Falha na API: ${api}`, error.message);
        }
    }
    throw new Error('Todas as APIs falharam');
}

// ============================================
// INICIALIZAÇÃO E LOGIN
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin carregado');
    const btnEntrar = document.getElementById('btnEntrarAdmin');
    const senhaInput = document.getElementById('senhaInput');
    
    if (btnEntrar) {
        btnEntrar.addEventListener('click', verificarSenha);
    }
    if (senhaInput) {
        senhaInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') verificarSenha();
        });
    }
    
    document.getElementById('btnLogout')?.addEventListener('click', logout);
    document.getElementById('btnSalvarParametros')?.addEventListener('click', salvarParametros);
    document.getElementById('btnPrepararCompeticao')?.addEventListener('click', criarNovaCompeticaoPreparando);
    document.getElementById('btnSelecionarCompeticao')?.addEventListener('click', ativarCompeticaoSelecionada);
    document.getElementById('btnListarCompeticoes')?.addEventListener('click', mostrarCompeticoes);
    document.getElementById('btnSalvarParticipante')?.addEventListener('click', salvarParticipante);
    document.getElementById('btnBuscarSorteio')?.addEventListener('click', buscarSorteioQuina);
    document.getElementById('btnEncerrarJogo')?.addEventListener('click', encerrarJogo);
    document.getElementById('btnResetarTudo')?.addEventListener('click', resetarTudo);
    
    document.getElementById('btnExcluirCompeticao')?.addEventListener('click', async () => {
        const select = document.getElementById('selectExcluirCompeticao');
        const competicaoId = select.value;
        if (!competicaoId) {
            alert('Selecione uma competição para excluir!');
            return;
        }
        const selectedOption = select.options[select.selectedIndex];
        const competicaoNome = selectedOption.text.split(')')[0].split(' ').slice(1).join(' ').trim();
        const statusIcon = selectedOption.text.includes('🟢') ? 'aberto' : (selectedOption.text.includes('🟡') ? 'preparando' : 'encerrado');
        await excluirCompeticao(competicaoId, competicaoNome, statusIcon);
    });
    
    criarGridNumeros();
});

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
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ VERIFICANDO...';
    }
    
    setTimeout(async () => {
        if (senha === SENHA_ADMIN) {
            loading.style.display = 'none';
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('adminContent').style.display = 'block';
            await carregarDados();
        } else {
            loading.style.display = 'none';
            msgErro.textContent = '❌ Senha incorreta! Tente novamente.';
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔐 ENTRAR';
            }
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

// ============================================
// CARREGAMENTO DE DADOS PRINCIPAL
// ============================================

async function carregarDados() {
    await carregarJogoAtivo();
    await carregarSelectCompeticoes();
    await carregarSelectCompeticoesCadastro();
    await carregarRanking();
    await carregarTodosParticipantes();
    await carregarParametros();
    await carregarHistoricoSorteios();
    await carregarNumerosSorteadosAdmin();
    await verificarBloqueio();
    await atualizarContadorParticipantes();
    iniciarBuscaAutomaticaMelhorada();
    carregarTabs();
}

function carregarTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('ativo'));
            tab.classList.add('ativo');
            document.getElementById(tabId).classList.add('ativo');
            
            if (tabId === 'sorteios') {
                carregarNumerosSorteadosAdmin();
            }
            if (tabId === 'cadastro') {
                carregarSelectCompeticoesCadastro();
            }
        });
    });
}

// ============================================
// GERENCIAMENTO DE COMPETIÇÕES
// ============================================

async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'aberto'), limit(1));
    
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const jogoDoc = querySnapshot.docs[0];
        jogoAtualId = jogoDoc.id;
        jogoAtualStatus = jogoDoc.data().status;
        const jogoData = jogoDoc.data();
        
        const participantesRef = collection(db, 'participantes');
        const partQ = query(participantesRef, where('jogoId', '==', jogoAtualId));
        const partSnapshot = await getDocs(partQ);
        const totalParticipantesReal = partSnapshot.size;
        
        const statusDiv = document.getElementById('statusAdmin');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <p>✅ Competição ATIVA: ${jogoData.nome || 'Edição atual'}</p>
                <p>📅 Criado em: ${jogoData.createdAt?.toDate()?.toLocaleString('pt-BR') || 'Nova'}</p>
                <p>🎲 Status: 🟢 ATIVO (buscando sorteios)</p>
                <p>🎲 Último sorteio: ${jogoData.ultimoConcursoImportado || 'Nenhum ainda'}</p>
                <p>💰 Valor inscrição: R$ ${jogoData.valorInscricao || 50},00</p>
                <p>👥 Participantes: ${totalParticipantesReal}</p>
            `;
        }
        
        jogoBloqueado = jogoData.primeiraConferenciaRealizada === true;
        
    } else {
        // Verificar se tem competição em preparação
        const preparandoQuery = query(jogosRef, where('status', '==', 'preparando'), limit(1));
        const preparandoSnapshot = await getDocs(preparandoQuery);
        
        if (!preparandoSnapshot.empty) {
            const jogoDoc = preparandoSnapshot.docs[0];
            const statusDiv = document.getElementById('statusAdmin');
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <p>🟡 Nenhuma competição ATIVA no momento.</p>
                    <p>📋 Competição em PREPARAÇÃO: ${jogoDoc.data().nome}</p>
                    <p>💡 Para iniciar, vá em Configurações e clique em "Ativar Competição".</p>
                `;
            }
            jogoAtualId = null;
            jogoAtualStatus = null;
        } else {
            const statusDiv = document.getElementById('statusAdmin');
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <p>⚡ Nenhuma competição encontrada.</p>
                    <p>💡 Clique em "Preparar Nova Competição" na aba Configurações para começar.</p>
                `;
            }
        }
        
        if (intervaloBusca) clearInterval(intervaloBusca);
    }
}

async function carregarSelectCompeticoes() {
    const select = document.getElementById('selectCompeticao');
    const selectExcluir = document.getElementById('selectExcluirCompeticao');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const querySnapshot = await getDocs(jogosRef);
    
    const jogos = [];
    for (const doc of querySnapshot.docs) {
        const jogo = doc.data();
        jogos.push({ id: doc.id, ...jogo });
    }
    jogos.sort((a, b) => {
        const dateA = a.createdAt?.toDate() || new Date(0);
        const dateB = b.createdAt?.toDate() || new Date(0);
        return dateB - dateA;
    });
    
    // Select para ativação (apenas PREPARANDO)
    select.innerHTML = '<option value="">-- Selecione uma competição para ATIVAR --</option>';
    
    for (const jogo of jogos) {
        if (jogo.status === 'preparando') {
            const statusIcon = '🟡';
            select.innerHTML += `<option value="${jogo.id}">${statusIcon} ${jogo.nome} (PREPARANDO) - ${jogo.totalParticipantes || 0} participantes</option>`;
        }
    }
    
    if (select.options.length === 1) {
        select.innerHTML = '<option value="">-- Nenhuma competição em PREPARAÇÃO --</option>';
    }
    
    // Select para exclusão (todas)
    if (selectExcluir) {
        selectExcluir.innerHTML = '<option value="">-- Selecione uma competição para excluir --</option>';
        for (const jogo of jogos) {
            const statusIcon = jogo.status === 'aberto' ? '🟢' : (jogo.status === 'preparando' ? '🟡' : '🔴');
            const statusText = jogo.status === 'aberto' ? 'ATIVO' : (jogo.status === 'preparando' ? 'PREPARANDO' : 'ENCERRADO');
            selectExcluir.innerHTML += `<option value="${jogo.id}">${statusIcon} ${jogo.nome} (${statusText}) - ${jogo.totalParticipantes || 0} participantes</option>`;
        }
    }
}

async function carregarSelectCompeticoesCadastro() {
    const select = document.getElementById('selectCompeticaoCadastro');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'preparando'));
    const querySnapshot = await getDocs(q);
    
    select.innerHTML = '<option value="">-- Selecione uma competição --</option>';
    
    const bloqueioDiv = document.getElementById('bloqueioCadastro');
    
    if (querySnapshot.empty) {
        select.innerHTML = '<option value="">-- Nenhuma competição em PREPARAÇÃO --</option>';
        if (bloqueioDiv) bloqueioDiv.style.display = 'block';
        document.getElementById('btnSalvarParticipante')?.setAttribute('disabled', 'disabled');
    } else {
        if (bloqueioDiv) bloqueioDiv.style.display = 'none';
        document.getElementById('btnSalvarParticipante')?.removeAttribute('disabled');
        
        for (const doc of querySnapshot.docs) {
            const jogo = doc.data();
            select.innerHTML += `<option value="${doc.id}">🟡 ${jogo.nome} - ${jogo.totalParticipantes || 0} participantes</option>`;
        }
    }
}

async function criarNovaCompeticaoPreparando() {
    const nomeJogo = prompt('Nome da nova competição:', `Um de Nós - ${new Date().toLocaleDateString('pt-BR')}`);
    if (!nomeJogo) return;
    
    const docRef = await addDoc(collection(db, 'jogos'), {
        nome: nomeJogo,
        status: 'preparando',
        createdAt: new Date(),
        ultimoConcursoImportado: null,
        ultimosNumerosSorteados: null,
        totalParticipantes: 0,
        valorInscricao: 50,
        primeiraConferenciaRealizada: false
    });
    
    alert(`✅ Competição "${nomeJogo}" criada em modo PREPARAÇÃO!`);
    
    await carregarSelectCompeticoes();
    await carregarSelectCompeticoesCadastro();
}

async function ativarCompeticaoSelecionada() {
    const select = document.getElementById('selectCompeticao');
    const selectedId = select.value;
    
    if (!selectedId) {
        alert('Selecione uma competição em PREPARAÇÃO primeiro!');
        return;
    }
    
    const jogoRef = doc(db, 'jogos', selectedId);
    const jogoDoc = await getDoc(jogoRef);
    
    if (!jogoDoc.exists()) {
        alert('Competição não encontrada!');
        return;
    }
    
    if (jogoDoc.data().status !== 'preparando') {
        alert('Apenas competições em PREPARAÇÃO podem ser ativadas!');
        return;
    }
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', selectedId));
    const snapshot = await getDocs(q);
    const totalParticipantes = snapshot.size;
    
    if (totalParticipantes < 3) {
        alert(`É necessário pelo menos 3 participantes para iniciar a competição!\nAtualmente: ${totalParticipantes} participantes.`);
        return;
    }
    
    if (confirm(`Iniciar competição "${jogoDoc.data().nome}" com ${totalParticipantes} participantes?\n\nApós ativar, NÃO será possível adicionar novos participantes.`)) {
        await updateDoc(jogoRef, { 
            status: 'aberto',
            dataInicio: new Date()
        });
        
        alert(`✅ Competição "${jogoDoc.data().nome}" ativada com sucesso!`);
        
        await carregarJogoAtivo();
        await carregarSelectCompeticoes();
        await carregarSelectCompeticoesCadastro();
        await carregarRanking();
        await carregarTodosParticipantes();
        
        // Reiniciar busca automática
        if (intervaloBusca) clearInterval(intervaloBusca);
        iniciarBuscaAutomaticaMelhorada();
    }
}

async function mostrarCompeticoes() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
        alert('Nenhuma competição encontrada');
        return;
    }
    
    let msg = '📋 COMPETIÇÕES:\n\n';
    for (const doc of querySnapshot.docs) {
        const jogo = doc.data();
        const statusIcon = jogo.status === 'aberto' ? '🟢' : (jogo.status === 'preparando' ? '🟡' : '🔴');
        const statusText = jogo.status === 'aberto' ? 'ATIVO' : (jogo.status === 'preparando' ? 'PREPARANDO' : 'ENCERRADO');
        msg += `${statusIcon} ${jogo.nome}\n   Status: ${statusText}\n   Participantes: ${jogo.totalParticipantes || 0}\n   Criado: ${jogo.createdAt?.toDate()?.toLocaleDateString('pt-BR') || '-'}\n\n`;
    }
    
    alert(msg);
}

async function excluirCompeticao(competicaoId, competicaoNome, competicaoStatus) {
    if (competicaoStatus === 'aberto') {
        alert(`❌ Não é possível excluir uma competição ATIVA!\n\nA competição "${competicaoNome}" está em andamento. Finalize ou aguarde encerrar primeiro.`);
        return;
    }
    
    const confirmar = confirm(`⚠️ Tem certeza que deseja EXCLUIR a competição "${competicaoNome}"?\n\nEsta ação é IRREVERSÍVEL e removerá todos os participantes e dados relacionados.`);
    
    if (!confirmar) return;
    
    try {
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', competicaoId));
        const participantes = await getDocs(q);
        
        const batch = writeBatch(db);
        participantes.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        await deleteDoc(doc(db, 'jogos', competicaoId));
        
        alert(`✅ Competição "${competicaoNome}" excluída com sucesso!`);
        
        await carregarSelectCompeticoes();
        await carregarSelectCompeticoesCadastro();
        await carregarJogoAtivo();
        
    } catch (error) {
        console.error('Erro ao excluir competição:', error);
        alert('Erro ao excluir competição: ' + error.message);
    }
}

async function verificarBloqueio() {
    const bloqueado = jogoBloqueado || jogoAtualStatus === 'aberto';
    const bloqueioMsg = document.getElementById('bloqueioCadastro');
    const infoBloqueio = document.getElementById('infoBloqueio');
    
    if (bloqueado && jogoAtualStatus === 'aberto') {
        if (bloqueioMsg) bloqueioMsg.style.display = 'block';
        if (infoBloqueio) infoBloqueio.style.display = 'block';
    } else {
        if (bloqueioMsg) bloqueioMsg.style.display = 'none';
        if (infoBloqueio) infoBloqueio.style.display = 'none';
    }
}

// ============================================
// PARTICIPANTES
// ============================================

async function salvarParticipante() {
    const selectCompeticao = document.getElementById('selectCompeticaoCadastro');
    const competicaoId = selectCompeticao.value;
    const nome = document.getElementById('nomeParticipante').value;
    
    if (!competicaoId) {
        alert('Selecione uma competição em PREPARAÇÃO!');
        return;
    }
    
    if (!nome) {
        alert('Digite o nome do participante!');
        return;
    }
    
    if (numerosSelecionados.length !== 17) {
        alert(`Selecione exatamente 17 números! Você selecionou ${numerosSelecionados.length}`);
        return;
    }
    
    try {
        await addDoc(collection(db, 'participantes'), {
            nome: nome,
            jogoId: competicaoId,
            numeros: numerosSelecionados.sort((a,b) => a-b),
            acertos: 0,
            acertouTodos: false,
            ordemVitoria: null,
            dataCadastro: new Date()
        });
        
        // Atualizar contador da competição
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', competicaoId));
        const querySnapshot = await getDocs(q);
        const total = querySnapshot.size;
        
        const jogoRef = doc(db, 'jogos', competicaoId);
        await updateDoc(jogoRef, { totalParticipantes: total });
        
        alert('Participante cadastrado com sucesso!');
        
        // Limpar formulário
        document.getElementById('nomeParticipante').value = '';
        document.querySelectorAll('.numero-btn.selecionado').forEach(btn => {
            btn.classList.remove('selecionado');
        });
        numerosSelecionados = [];
        document.getElementById('contadorNumeros').innerHTML = '0/17 números selecionados';
        
        await carregarSelectCompeticoesCadastro();
        await carregarTodosParticipantes();
        
    } catch (error) {
        console.error('Erro ao salvar:', error);
        alert('Erro ao salvar participante: ' + error.message);
    }
}

async function carregarTodosParticipantes() {
    const tbody = document.getElementById('corpoTabela');
    if (!tbody) return;
    
    // Buscar todas as competições para mostrar o nome
    const jogosRef = collection(db, 'jogos');
    const jogosSnapshot = await getDocs(jogosRef);
    const jogosMap = new Map();
    jogosSnapshot.forEach(doc => {
        jogosMap.set(doc.id, doc.data().nome);
    });
    
    const participantesRef = collection(db, 'participantes');
    const querySnapshot = await getDocs(participantesRef);
    
    tbody.innerHTML = '';
    for (const docSnap of querySnapshot.docs) {
        const p = docSnap.data();
        const competicaoNome = jogosMap.get(p.jogoId) || 'Desconhecida';
        const tr = document.createElement('tr');
        const dataCadastro = p.dataCadastro?.toDate()?.toLocaleString('pt-BR') || '-';
        tr.innerHTML = `
            <td>${competicaoNome}</td>
            <td>${p.nome}</td>
            <td style="font-size:11px;">${p.numeros.join(', ')}</td>
            <td>${p.acertos || 0}/17</td>
            <td>${dataCadastro}</td>
            <td><button class="btn-danger" onclick="window.excluirParticipante('${docSnap.id}')">Excluir</button></td>
        `;
        tbody.appendChild(tr);
    }
}

let numerosSelecionados = [];

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

// ============================================
// PARÂMETROS E PREMIAÇÃO
// ============================================

async function carregarParametros() {
    if (!jogoAtualId) return;
    
    const jogoRef = doc(db, 'jogos', jogoAtualId);
    const jogoDoc = await getDoc(jogoRef);
    const jogoData = jogoDoc.data();
    
    const valorInscricao = jogoData.valorInscricao || 50;
    document.getElementById('valorInscricao').value = valorInscricao;
    
    const totalParticipantes = jogoData.totalParticipantes || 0;
    atualizarPreviewPremiacao(valorInscricao, totalParticipantes);
}

async function salvarParametros() {
    if (!jogoAtualId) {
        alert('Nenhuma competição ativa!');
        return;
    }
    
    const valorInscricao = parseFloat(document.getElementById('valorInscricao').value);
    
    if (isNaN(valorInscricao) || valorInscricao <= 0) {
        alert('Digite um valor válido para a inscrição!');
        return;
    }
    
    const jogoRef = doc(db, 'jogos', jogoAtualId);
    await updateDoc(jogoRef, { valorInscricao: valorInscricao });
    
    alert('Parâmetros salvos com sucesso!');
    await carregarParametros();
}

function atualizarPreviewPremiacao(valorInscricao, totalParticipantes) {
    const premioTotal = valorInscricao * totalParticipantes;
    const premio1 = premioTotal * 0.63;
    const premio2 = premioTotal * 0.20;
    const premio3 = premioTotal * 0.05;
    const premioAdmin = premioTotal * 0.12;
    
    document.getElementById('preview1').innerHTML = `63% = R$ ${premio1.toFixed(2)}`;
    document.getElementById('preview2').innerHTML = `20% = R$ ${premio2.toFixed(2)}`;
    document.getElementById('preview3').innerHTML = `5% = R$ ${premio3.toFixed(2)}`;
    document.getElementById('previewAdmin').innerHTML = `12% = R$ ${premioAdmin.toFixed(2)}`;
}

async function atualizarContadorParticipantes() {
    if (!jogoAtualId) return;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const querySnapshot = await getDocs(q);
    const total = querySnapshot.size;
    
    const jogoRef = doc(db, 'jogos', jogoAtualId);
    await updateDoc(jogoRef, { totalParticipantes: total });
    return total;
}

// ============================================
// RANKING
// ============================================

async function carregarRanking() {
    if (!jogoAtualId) return;
    
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
            html += `
                <div class="linha-participante">
                    <span>${pos++}º</span>
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

// ============================================
// SORTEIOS
// ============================================

function iniciarBuscaAutomaticaMelhorada() {
    if (intervaloBusca) clearInterval(intervaloBusca);
    
    // Só inicia busca se tiver competição ATIVA
    if (!jogoAtualId || jogoAtualStatus !== 'aberto') {
        console.log('⏸️ Busca automática desativada - nenhuma competição ativa');
        return;
    }
    
    console.log('🔄 Busca automática configurada (a cada 5 min, das 20h à 00h30)');
    
    setTimeout(() => {
        if (jogoAtualId && jogoAtualStatus === 'aberto') {
            buscarSorteioQuina();
        }
    }, 3000);
    
    intervaloBusca = setInterval(async () => {
        const agora = new Date();
        const hora = agora.getHours();
        const minutos = agora.getMinutes();
        
        const isHorarioBusca = (hora >= 20) || (hora === 0 && minutos <= 30);
        
        if (jogoAtualId && jogoAtualStatus === 'aberto' && isHorarioBusca && !sorteioEncontradoHoje) {
            console.log('⏰ Busca automática executando...');
            await buscarSorteioQuina();
        }
    }, 300000);
}

async function buscarSorteioQuina() {
    console.log('🔍 Buscar sorteio - múltiplas APIs');
    
    if (!jogoAtualId || jogoAtualStatus !== 'aberto') {
        console.log('⚠️ Sem competição ativa, ignorando busca');
        return;
    }
    
    const btn = document.getElementById('btnBuscarSorteio');
    if (btn && !btn.disabled) {
        btn.disabled = true;
        btn.textContent = '⏳ Buscando...';
    }
    
    try {
        const { numeros: numerosSorteados, concurso, data } = await buscarSorteioMultiplasAPIs();
        
        console.log(`🎲 Sorteio ${concurso}:`, numerosSorteados);
        
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        const jogoDoc = await getDoc(jogoRef);
        const jogoData = jogoDoc.data();
        
        const hoje = new Date();
        let ehSorteioDeHoje = false;
        if (data) {
            const partes = data.split('/');
            if (partes.length === 3) {
                const dataSorteio = new Date(partes[2], partes[1] - 1, partes[0]);
                ehSorteioDeHoje = dataSorteio.toDateString() === hoje.toDateString();
            }
        }
        
        if (jogoData.ultimoConcursoImportado === concurso) {
            console.log(`⚠️ Sorteio ${concurso} já foi importado`);
            if (ehSorteioDeHoje) {
                sorteioEncontradoHoje = true;
            }
            return;
        }
        
        if (ehSorteioDeHoje) {
            sorteioEncontradoHoje = true;
            console.log('🎉 Sorteio de hoje ENCONTRADO e IMPORTADO!');
        }
        
        if (!jogoData.primeiraConferenciaRealizada) {
            console.log('🔒 PRIMEIRA CONFERÊNCIA - Bloqueando novos cadastros');
            await updateDoc(jogoRef, {
                primeiraConferenciaRealizada: true,
                dataPrimeiraConferencia: new Date()
            });
            jogoBloqueado = true;
            await verificarBloqueio();
        }
        
        let dataSorteioValida = new Date();
        if (data) {
            const partes = data.split('/');
            if (partes.length === 3) {
                dataSorteioValida = new Date(partes[2], partes[1] - 1, partes[0]);
            }
        }
        
        await addDoc(collection(db, 'sorteios_quina'), {
            concurso: concurso,
            numeros: numerosSorteados,
            data: dataSorteioValida,
            importadoEm: new Date()
        });
        
        await updateDoc(jogoRef, {
            ultimosNumerosSorteados: numerosSorteados,
            ultimoConcursoImportado: concurso
        });
        
        await atualizarAcertosParticipantes(numerosSorteados);
        
        alert(`✅ Sorteio ${concurso} importado! Números: ${numerosSorteados.join(', ')}`);
        
        await carregarRanking();
        await carregarHistoricoSorteios();
        await carregarNumerosSorteadosAdmin();
        
    } catch (error) {
        console.error('❌ Erro:', error);
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
    
    let vencedores = [];
    
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
            vencedores.push({ id: docSnap.id, nome: participante.nome, acertos: novoTotal });
        }
    }
    
    if (vencedores.length > 0) {
        await declararVencedores(vencedores);
    }
    
    await carregarRanking();
}

async function declararVencedores(vencedores) {
    const jogoRef = doc(db, 'jogos', jogoAtualId);
    const jogoDoc = await getDoc(jogoRef);
    
    if (jogoDoc.data().status !== 'aberto') return;
    
    const jogoData = jogoDoc.data();
    const valorInscricao = jogoData.valorInscricao || 50;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const allParticipants = await getDocs(q);
    
    let menosAcertos = 17;
    let perdedor = null;
    allParticipants.forEach(doc => {
        const p = doc.data();
        if (!p.acertouTodos && p.acertos < menosAcertos) {
            menosAcertos = p.acertos;
            perdedor = { id: doc.id, nome: p.nome, acertos: p.acertos };
        }
    });
    
    const totalParticipantes = allParticipants.size;
    const premioTotal = valorInscricao * totalParticipantes;
    
    const premio1 = premioTotal * 0.63;
    const premio2 = premioTotal * 0.20;
    const premio3 = premioTotal * 0.05;
    
    vencedores.sort((a, b) => b.acertos - a.acertos);
    
    for (let i = 0; i < vencedores.length && i < 2; i++) {
        const v = vencedores[i];
        let premio = (i === 0) ? premio1 : premio2;
        
        const empatados = vencedores.filter(v2 => v2.acertos === v.acertos);
        if (empatados.length > 1 && i === 0) {
            premio = premio1 / empatados.length;
        }
        
        await updateDoc(doc(db, 'participantes', v.id), {
            acertouTodos: true,
            ordemVitoria: i + 1,
            premioGanho: premio
        });
        
        await addDoc(collection(db, 'historico_vencedores'), {
            jogoId: jogoAtualId,
            participanteId: v.id,
            participanteNome: v.nome,
            posicao: i + 1,
            premio: premio,
            dataVitoria: new Date()
        });
    }
    
    if (perdedor && totalParticipantes >= 3) {
        await updateDoc(doc(db, 'participantes', perdedor.id), {
            premioMenosAcertos: premio3
        });
        
        await addDoc(collection(db, 'historico_vencedores'), {
            jogoId: jogoAtualId,
            participanteId: perdedor.id,
            participanteNome: perdedor.nome,
            posicao: 'MENOS ACERTOS',
            premio: premio3,
            acertos: perdedor.acertos,
            dataVitoria: new Date()
        });
    }
    
    await updateDoc(jogoRef, {
        status: 'encerrado',
        encerradoEm: new Date()
    });
    
    if (intervaloBusca) clearInterval(intervaloBusca);
    
    let msg = '🏆 RESULTADO FINAL! 🏆\n\n';
    if (vencedores[0]) msg += `🥇 1º lugar: ${vencedores[0].nome}\n`;
    if (vencedores[1]) msg += `🥈 2º lugar: ${vencedores[1].nome}\n`;
    if (perdedor) msg += `🎯 Prêmio especial (menos acertos): ${perdedor.nome} (${perdedor.acertos}/17)\n`;
    alert(msg);
    setTimeout(() => window.location.reload(), 2000);
}

async function encerrarJogo() {
    if (!jogoAtualId) {
        alert('Nenhuma competição ativa!');
        return;
    }
    
    if (confirm('Tem certeza que deseja encerrar o jogo atual?')) {
        if (intervaloBusca) clearInterval(intervaloBusca);
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        await updateDoc(jogoRef, { status: 'encerrado' });
        alert('Jogo encerrado!');
        await carregarJogoAtivo();
        await carregarSelectCompeticoes();
        await carregarSelectCompeticoesCadastro();
    }
}

// ============================================
// HISTÓRICO E NÚMEROS
// ============================================

async function carregarHistoricoSorteios() {
    const sorteiosRef = collection(db, 'sorteios_quina');
    const q = query(sorteiosRef, orderBy('concurso', 'desc'));
    const querySnapshot = await getDocs(q);
    
    const container = document.getElementById('historicoSorteios');
    if (querySnapshot.empty) {
        container.innerHTML = '<div>Nenhum sorteio importado ainda.</div>';
        return;
    }
    
    let html = '<div style="display: flex; flex-wrap: wrap; gap: 10px;">';
    querySnapshot.forEach(doc => {
        const s = doc.data();
        html += `
            <div style="background: rgba(241,196,15,0.08); border-radius: 10px; padding: 8px 12px;">
                <strong>#${s.concurso}</strong><br>
                ${s.numeros.join(', ')}
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

async function carregarNumerosSorteadosAdmin() {
    const sorteiosRef = collection(db, 'sorteios_quina');
    const querySnapshot = await getDocs(sorteiosRef);
    
    const numerosSorteados = [];
    querySnapshot.forEach(doc => {
        const s = doc.data();
        for (const num of s.numeros) {
            if (!numerosSorteados.includes(num)) {
                numerosSorteados.push(num);
            }
        }
    });
    
    const container = document.getElementById('gridNumerosSorteadosAdmin');
    let html = '<div style="display: grid; grid-template-columns: repeat(10, 1fr); gap: 5px;">';
    for (let i = 1; i <= 80; i++) {
        const foiSorteado = numerosSorteados.includes(i);
        html += `
            <div style="background: ${foiSorteado ? 'rgba(241,196,15,0.15)' : 'rgba(255,255,255,0.04)'}; color: ${foiSorteado ? '#f1c40f' : 'white'}; padding: 6px; text-align: center; border-radius: 6px; font-size:0.7em;">
                ${i}
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ============================================
// RESET
// ============================================

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

window.verificarSenha = verificarSenha;
window.logout = logout;
window.buscarSorteioQuina = buscarSorteioQuina;