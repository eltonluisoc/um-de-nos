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
let competicaoPreparandoId = null;
let competicaoPreparandoValor = 20;

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
    document.getElementById('btnExcluirCompeticao')?.addEventListener('click', excluirCompeticaoHandler);
    document.getElementById('btnRefresh')?.addEventListener('click', () => window.location.reload());
    
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('ativo'));
            tab.classList.add('ativo');
            const targetContent = document.getElementById(tabId);
            if (targetContent) targetContent.classList.add('ativo');
            
            if (tabId === 'lista') {
                carregarSelectCompeticaoLista();
            }
            if (tabId === 'sorteios') {
                carregarNumerosSorteadosAdmin();
                carregarHistoricoSorteios();
            }
            if (tabId === 'cadastro') {
                carregarSelectCompeticoesCadastro();
                carregarCompeticaoPreparandoValor();
            }
            if (tabId === 'parametros') {
                carregarCompeticaoPreparandoValor();
            }
            if (tabId === 'config') {
                carregarSelectCompeticoes();
                carregarSelectExcluirCompeticao();
                carregarCompeticaoPreparandoValor();
            }
            if (tabId === 'dashboard') {
                atualizarStatusGame();
                carregarRanking();
            }
        });
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
    await carregarSelectCompeticaoLista();
    await carregarSelectExcluirCompeticao();
    await carregarRanking();
    await carregarTodosParticipantes();
    await carregarParametros();
    await carregarCompeticaoPreparandoValor();
    await carregarHistoricoSorteios();
    await carregarNumerosSorteadosAdmin();
    await verificarBloqueio();
    await atualizarStatusGame();
    iniciarBuscaAutomaticaMelhorada();
}

async function carregarCompeticaoPreparandoValor() {
    const preparandoRef = collection(db, 'jogos');
    const preparandoQuery = query(preparandoRef, where('status', '==', 'preparando'), limit(1));
    const preparandoSnapshot = await getDocs(preparandoQuery);
    
    const inputValor = document.getElementById('valorInscricao');
    
    if (!preparandoSnapshot.empty) {
        const jogoDoc = preparandoSnapshot.docs[0];
        const jogoData = jogoDoc.data();
        competicaoPreparandoId = jogoDoc.id;
        competicaoPreparandoValor = jogoData.valorInscricao || 20;
        
        if (inputValor) {
            inputValor.value = competicaoPreparandoValor;
            inputValor.disabled = false;
            document.getElementById('btnSalvarParametros').disabled = false;
        }
        
        const totalParticipantes = await contarParticipantesPorCompeticao(competicaoPreparandoId);
        atualizarPreviewPremiacao(competicaoPreparandoValor, totalParticipantes);
    } else {
        if (inputValor) {
            inputValor.value = 20;
            inputValor.disabled = true;
            document.getElementById('btnSalvarParametros').disabled = true;
        }
        competicaoPreparandoId = null;
    }
}

async function contarParticipantesPorCompeticao(competicaoId) {
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', competicaoId));
    const snapshot = await getDocs(q);
    return snapshot.size;
}

async function atualizarStatusGame() {
    const statusGameContainer = document.getElementById('statusGameContainer');
    if (!statusGameContainer) return;
    
    const jogosAtivosRef = collection(db, 'jogos');
    const ativosQuery = query(jogosAtivosRef, where('status', '==', 'aberto'), limit(1));
    const ativosSnapshot = await getDocs(ativosQuery);
    
    const preparandoRef = collection(db, 'jogos');
    const preparandoQuery = query(preparandoRef, where('status', '==', 'preparando'), limit(1));
    const preparandoSnapshot = await getDocs(preparandoQuery);
    
    let html = '';
    
    if (!ativosSnapshot.empty) {
        const jogoDoc = ativosSnapshot.docs[0];
        const jogoData = jogoDoc.data();
        const totalParticipantes = await contarParticipantesPorCompeticao(jogoDoc.id);
        
        html += `
            <div class="status-game" style="border-left: 4px solid #28a745;">
                <div class="status-game-header">
                    <div class="status-icon">🟢</div>
                    <div class="status-title">Competição ATIVA</div>
                </div>
                <div class="status-details">
                    <div class="status-item">
                        <span class="status-label">Nome</span>
                        <span class="status-value">${jogoData.nome || 'Edição atual'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Participantes</span>
                        <span class="status-value">${totalParticipantes}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Último Sorteio</span>
                        <span class="status-value">${jogoData.ultimoConcursoImportado || 'Nenhum ainda'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Valor Inscrição</span>
                        <span class="status-value">R$ ${jogoData.valorInscricao || 20},00</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Data Criação</span>
                        <span class="status-value">${jogoData.createdAt?.toDate()?.toLocaleDateString('pt-BR') || '-'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    if (!preparandoSnapshot.empty) {
        const jogoDoc = preparandoSnapshot.docs[0];
        const jogoData = jogoDoc.data();
        const totalParticipantes = await contarParticipantesPorCompeticao(jogoDoc.id);
        const statusText = totalParticipantes >= 3 ? 'Pronto para iniciar' : `Faltam ${3 - totalParticipantes} participantes`;
        const statusColor = totalParticipantes >= 3 ? '#28a745' : '#f1c40f';
        
        html += `
            <div class="status-game" style="border-left: 4px solid #f1c40f;">
                <div class="status-game-header">
                    <div class="status-icon">🟡</div>
                    <div class="status-title">Competição em PREPARAÇÃO</div>
                </div>
                <div class="status-details">
                    <div class="status-item">
                        <span class="status-label">Nome</span>
                        <span class="status-value">${jogoData.nome || 'Edição atual'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Participantes</span>
                        <span class="status-value">${totalParticipantes} / 3 (mínimo)</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Status</span>
                        <span class="status-value" style="color: ${statusColor};">${statusText}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Valor Inscrição</span>
                        <span class="status-value">R$ ${jogoData.valorInscricao || 20},00</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Data Criação</span>
                        <span class="status-value">${jogoData.createdAt?.toDate()?.toLocaleDateString('pt-BR') || '-'}</span>
                    </div>
                </div>
                <div style="margin-top: 15px; text-align: center;">
                    <button class="btn btn-warning" id="btnGoToConfigFromStatus" style="background:#17a2b8;">⚙️ Ir para Configurações para Ativar</button>
                </div>
            </div>
        `;
    }
    
    if (ativosSnapshot.empty && preparandoSnapshot.empty) {
        html = `
            <div class="status-game" style="border-left: 4px solid #6c757d;">
                <div class="status-game-header">
                    <div class="status-icon">⚪</div>
                    <div class="status-title">Nenhuma Competição</div>
                </div>
                <div class="status-details">
                    <div class="status-item" style="justify-content: center;">
                        <span class="status-value">Clique em "Preparar Nova Competição" para começar</span>
                    </div>
                </div>
                <div style="margin-top: 15px; text-align: center;">
                    <button class="btn btn-success" id="btnGoToPreparar">📋 Preparar Nova Competição</button>
                </div>
            </div>
        `;
    }
    
    statusGameContainer.innerHTML = html;
    
    const btnGoToConfig = document.getElementById('btnGoToConfigFromStatus');
    if (btnGoToConfig) {
        btnGoToConfig.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('ativo'));
            const configTab = document.querySelector('.tab[data-tab="config"]');
            if (configTab) configTab.classList.add('ativo');
            const configContent = document.getElementById('config');
            if (configContent) configContent.classList.add('ativo');
        });
    }
    
    const btnGoToPreparar = document.getElementById('btnGoToPreparar');
    if (btnGoToPreparar) {
        btnGoToPreparar.addEventListener('click', () => {
            criarNovaCompeticaoPreparando();
        });
    }
}

async function carregarSelectExcluirCompeticao() {
    const select = document.getElementById('selectExcluirCompeticao');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const querySnapshot = await getDocs(jogosRef);
    
    select.innerHTML = '<option value="">-- Selecione uma competição para excluir --</option>';
    for (const doc of querySnapshot.docs) {
        const jogo = doc.data();
        const statusIcon = jogo.status === 'aberto' ? '🟢' : (jogo.status === 'preparando' ? '🟡' : '🔴');
        const statusText = jogo.status === 'aberto' ? 'ATIVO' : (jogo.status === 'preparando' ? 'PREPARANDO' : 'ENCERRADO');
        select.innerHTML += `<option value="${doc.id}">${statusIcon} ${jogo.nome} (${statusText}) - ${jogo.totalParticipantes || 0} participantes</option>`;
    }
}

async function excluirCompeticaoHandler() {
    const select = document.getElementById('selectExcluirCompeticao');
    const competicaoId = select.value;
    if (!competicaoId) {
        alert('Selecione uma competição para excluir!');
        return;
    }
    const selectedOption = select.options[select.selectedIndex];
    const competicaoNome = selectedOption.text.split(')')[0].split(' ').slice(1).join(' ').trim();
    const statusIcon = selectedOption.text.includes('🟢') ? 'aberto' : (selectedOption.text.includes('🟡') ? 'preparando' : 'encerrado');
    
    if (statusIcon === 'aberto') {
        alert(`❌ Não é possível excluir uma competição ATIVA!\n\nA competição "${competicaoNome}" está em andamento.`);
        return;
    }
    
    if (confirm(`⚠️ Excluir "${competicaoNome}"? Esta ação é irreversível.`)) {
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', competicaoId));
        const participantes = await getDocs(q);
        const batch = writeBatch(db);
        participantes.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        await deleteDoc(doc(db, 'jogos', competicaoId));
        alert(`✅ Competição "${competicaoNome}" excluída!`);
        await carregarSelectExcluirCompeticao();
        await atualizarStatusGame();
        await carregarSelectCompeticoes();
        await carregarSelectCompeticoesCadastro();
        await carregarSelectCompeticaoLista();
        await carregarCompeticaoPreparandoValor();
    }
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
        jogoBloqueado = jogoData.primeiraConferenciaRealizada === true;
    } else {
        jogoAtualId = null;
        jogoAtualStatus = null;
        if (intervaloBusca) clearInterval(intervaloBusca);
    }
}

async function carregarSelectCompeticoes() {
    const select = document.getElementById('selectCompeticao');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const querySnapshot = await getDocs(jogosRef);
    
    select.innerHTML = '<option value="">-- Selecione uma competição para ATIVAR --</option>';
    for (const doc of querySnapshot.docs) {
        const jogo = doc.data();
        if (jogo.status === 'preparando') {
            select.innerHTML += `<option value="${doc.id}">🟡 ${jogo.nome} (PREPARANDO) - ${jogo.totalParticipantes || 0} participantes</option>`;
        }
    }
    if (select.options.length === 1) {
        select.innerHTML = '<option value="">-- Nenhuma competição em PREPARAÇÃO --</option>';
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
            select.innerHTML += `<option value="${doc.id}">🟡 ${jogo.nome} - ${jogo.totalParticipantes || 0} participantes (R$ ${jogo.valorInscricao || 20})</option>`;
        }
    }
}

async function carregarSelectCompeticaoLista() {
    const select = document.getElementById('selectCompeticaoLista');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const querySnapshot = await getDocs(jogosRef);
    
    select.innerHTML = '<option value="">-- Selecione uma competição --</option>';
    for (const doc of querySnapshot.docs) {
        const jogo = doc.data();
        const statusIcon = jogo.status === 'aberto' ? '🟢' : (jogo.status === 'preparando' ? '🟡' : '🔴');
        const statusText = jogo.status === 'aberto' ? 'ATIVO' : (jogo.status === 'preparando' ? 'PREPARANDO' : 'ENCERRADO');
        select.innerHTML += `<option value="${doc.id}">${statusIcon} ${jogo.nome} (${statusText}) - ${jogo.totalParticipantes || 0} participantes</option>`;
    }
    
    select.onchange = async () => {
        await carregarParticipantesPorCompeticao(select.value);
    };
}

async function carregarParticipantesPorCompeticao(competicaoId) {
    const tbody = document.getElementById('corpoTabela');
    if (!tbody || !competicaoId) {
        if (tbody && !competicaoId) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Selecione uma competição</td></tr>';
        }
        return;
    }
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Carregando...</td></tr>';
    
    try {
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', competicaoId));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Nenhum participante cadastrado</td></tr>';
            return;
        }
        
        const participantes = [];
        querySnapshot.forEach(doc => {
            participantes.push({ id: doc.id, ...doc.data() });
        });
        participantes.sort((a, b) => {
            const nomeA = a.nome || '';
            const nomeB = b.nome || '';
            return nomeA.localeCompare(nomeB, 'pt-BR');
        });
        
        tbody.innerHTML = '';
        for (const p of participantes) {
            const tr = document.createElement('tr');
            const dataCadastro = p.dataCadastro?.toDate()?.toLocaleString('pt-BR') || '-';
            tr.innerHTML = `
                <td><strong>${p.nome}</strong></td>
                <td style="font-size:11px;">${p.numeros.join(', ')}</td>
                <td>${p.acertos || 0}/17</td>
                <td>${dataCadastro}</td>
                <td><button class="btn-danger" onclick="window.excluirParticipante('${p.id}')">Excluir</button></td>
            `;
            tbody.appendChild(tr);
        }
    } catch (error) {
        console.error('Erro ao carregar participantes:', error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #dc3545;">Erro ao carregar participantes</td></tr>';
    }
}

async function carregarTodosParticipantes() {
    const selectLista = document.getElementById('selectCompeticaoLista');
    if (selectLista && selectLista.value) {
        await carregarParticipantesPorCompeticao(selectLista.value);
    }
}

async function criarNovaCompeticaoPreparando() {
    const nomeJogo = prompt('Nome da nova competição:', `Um de Nós - ${new Date().toLocaleDateString('pt-BR')}`);
    if (!nomeJogo) return;
    
    const valor = prompt('Valor da inscrição (R$):', '20');
    const valorNumerico = parseFloat(valor);
    const valorFinal = isNaN(valorNumerico) || valorNumerico <= 0 ? 20 : valorNumerico;
    
    await addDoc(collection(db, 'jogos'), {
        nome: nomeJogo,
        status: 'preparando',
        createdAt: new Date(),
        ultimoConcursoImportado: null,
        ultimosNumerosSorteados: null,
        totalParticipantes: 0,
        valorInscricao: valorFinal,
        primeiraConferenciaRealizada: false
    });
    
    alert(`✅ Competição "${nomeJogo}" criada em modo PREPARAÇÃO com valor R$ ${valorFinal},00!`);
    await carregarSelectCompeticoes();
    await carregarSelectCompeticoesCadastro();
    await carregarSelectCompeticaoLista();
    await carregarSelectExcluirCompeticao();
    await carregarCompeticaoPreparandoValor();
    await atualizarStatusGame();
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
    
    if (!jogoDoc.exists() || jogoDoc.data().status !== 'preparando') {
        alert('Competição não encontrada ou não está em PREPARAÇÃO!');
        return;
    }
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', selectedId));
    const snapshot = await getDocs(q);
    const totalParticipantes = snapshot.size;
    
    if (totalParticipantes < 3) {
        alert(`É necessário pelo menos 3 participantes para iniciar!\nAtualmente: ${totalParticipantes} participantes.`);
        return;
    }
    
    if (confirm(`Iniciar competição "${jogoDoc.data().nome}" com ${totalParticipantes} participantes?\n\n⚠️ ATENÇÃO: Os acertos serão ZERADOS. A competição começará APÓS a ativação.`)) {
        
        console.log('🔄 Zerando acertos dos participantes...');
        const batch = writeBatch(db);
        
        for (const docSnap of snapshot.docs) {
            batch.update(doc(db, 'participantes', docSnap.id), { 
                acertos: 0,
                acertouTodos: false,
                ordemVitoria: null
            });
        }
        await batch.commit();
        console.log('✅ Acertos zerados com sucesso!');
        
        await updateDoc(jogoRef, { 
            status: 'aberto', 
            dataInicio: new Date(),
            ultimoConcursoImportado: null,
            ultimosNumerosSorteados: null,
            primeiraConferenciaRealizada: false
        });
        
        alert(`✅ Competição "${jogoDoc.data().nome}" ativada com SUCESSO!\n\n📌 Os acertos foram ZERADOS.\n📌 A página será recarregada para atualizar o ranking.`);
        
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    }
}

async function mostrarCompeticoes() {
    const jogosRef = collection(db, 'jogos');
    const querySnapshot = await getDocs(jogosRef);
    
    if (querySnapshot.empty) {
        alert('Nenhuma competição encontrada');
        return;
    }
    
    let msg = '📋 COMPETIÇÕES:\n\n';
    for (const doc of querySnapshot.docs) {
        const jogo = doc.data();
        const statusIcon = jogo.status === 'aberto' ? '🟢' : (jogo.status === 'preparando' ? '🟡' : '🔴');
        const statusText = jogo.status === 'aberto' ? 'ATIVO' : (jogo.status === 'preparando' ? 'PREPARANDO' : 'ENCERRADO');
        msg += `${statusIcon} ${jogo.nome} - ${statusText} - R$ ${jogo.valorInscricao || 20} - ${jogo.totalParticipantes || 0} participantes\n`;
    }
    alert(msg);
}

async function verificarBloqueio() {
    const bloqueado = jogoBloqueado || jogoAtualStatus === 'aberto';
    const bloqueioMsg = document.getElementById('bloqueioCadastro');
    const infoBloqueio = document.getElementById('infoBloqueio');
    
    if (bloqueado && jogoAtualStatus === 'aberto') {
        if (bloqueioMsg) bloqueioMsg.style.display = 'block';
        if (infoBloqueio) infoBloqueio.style.display = 'block';
        document.getElementById('btnSalvarParticipante')?.setAttribute('disabled', 'disabled');
    } else {
        if (bloqueioMsg) bloqueioMsg.style.display = 'none';
        if (infoBloqueio) infoBloqueio.style.display = 'none';
        document.getElementById('btnSalvarParticipante')?.removeAttribute('disabled');
    }
}

// ============================================
// PARTICIPANTES
// ============================================

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
        
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', competicaoId));
        const querySnapshot = await getDocs(q);
        const jogoRef = doc(db, 'jogos', competicaoId);
        await updateDoc(jogoRef, { totalParticipantes: querySnapshot.size });
        
        alert('Participante cadastrado com sucesso!');
        
        document.getElementById('nomeParticipante').value = '';
        document.querySelectorAll('.numero-btn.selecionado').forEach(btn => {
            btn.classList.remove('selecionado');
        });
        numerosSelecionados = [];
        document.getElementById('contadorNumeros').innerHTML = '0/17 números selecionados';
        
        await carregarSelectCompeticoesCadastro();
        await carregarSelectCompeticaoLista();
        await carregarRanking();
        await carregarCompeticaoPreparandoValor();
        await atualizarStatusGame();
        
    } catch (error) {
        console.error('Erro ao salvar:', error);
        alert('Erro ao salvar participante: ' + error.message);
    }
}

// ============================================
// PARÂMETROS E PREMIAÇÃO
// ============================================

async function carregarParametros() {}

async function salvarParametros() {
    if (!competicaoPreparandoId) {
        alert('Nenhuma competição em PREPARAÇÃO encontrada!');
        return;
    }
    
    const valorInscricao = parseFloat(document.getElementById('valorInscricao').value);
    if (isNaN(valorInscricao) || valorInscricao <= 0) {
        alert('Digite um valor válido!');
        return;
    }
    
    const jogoRef = doc(db, 'jogos', competicaoPreparandoId);
    await updateDoc(jogoRef, { valorInscricao: valorInscricao });
    
    competicaoPreparandoValor = valorInscricao;
    
    alert(`✅ Valor da inscrição atualizado para R$ ${valorInscricao},00!`);
    
    const totalParticipantes = await contarParticipantesPorCompeticao(competicaoPreparandoId);
    atualizarPreviewPremiacao(valorInscricao, totalParticipantes);
    
    await carregarSelectCompeticoesCadastro();
    await atualizarStatusGame();
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

// ============================================
// RANKING
// ============================================

async function carregarRanking() {
    const container = document.getElementById('listaRankingAdmin');
    if (!container) return;
    
    if (jogoAtualId && jogoAtualStatus === 'aberto') {
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
    } else if (competicaoPreparandoId) {
        try {
            const participantesRef = collection(db, 'participantes');
            const q = query(participantesRef, where('jogoId', '==', competicaoPreparandoId));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                container.innerHTML = '<div>Nenhum participante cadastrado na competição em PREPARAÇÃO.</div>';
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
    } else {
        container.innerHTML = '<div>Nenhuma competição ativa ou em preparação.</div>';
    }
}

// ============================================
// SORTEIOS
// ============================================

function iniciarBuscaAutomaticaMelhorada() {
    if (intervaloBusca) clearInterval(intervaloBusca);
    if (!jogoAtualId || jogoAtualStatus !== 'aberto') {
        console.log('⏸️ Busca automática desativada');
        return;
    }
    
    console.log('🔄 Busca automática ativada');
    setTimeout(() => {
        if (jogoAtualId && jogoAtualStatus === 'aberto') buscarSorteioQuina();
    }, 3000);
    
    intervaloBusca = setInterval(async () => {
        const agora = new Date();
        const hora = agora.getHours();
        const minutos = agora.getMinutes();
        const isHorarioBusca = (hora >= 20) || (hora === 0 && minutos <= 30);
        
        if (jogoAtualId && jogoAtualStatus === 'aberto' && isHorarioBusca && !sorteioEncontradoHoje) {
            await buscarSorteioQuina();
        }
    }, 300000);
}

async function buscarSorteioQuina() {
    console.log('🔍 Buscando sorteio...');
    if (!jogoAtualId || jogoAtualStatus !== 'aberto') return;
    
    const btn = document.getElementById('btnBuscarSorteio');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando...'; }
    
    try {
        const { numeros, concurso, data } = await buscarSorteioMultiplasAPIs();
        console.log(`🎲 Sorteio encontrado: ${concurso}`, numeros);
        
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        const jogoDoc = await getDoc(jogoRef);
        const jogoData = jogoDoc.data();
        
        const dataInicio = jogoData.dataInicio?.toDate() || new Date();
        let dataSorteioObj = new Date();
        if (data) {
            const partes = data.split('/');
            if (partes.length === 3) {
                dataSorteioObj = new Date(partes[2], partes[1] - 1, partes[0]);
            }
        }
        
        if (dataSorteioObj < dataInicio) {
            console.log(`⏸️ Sorteio ${concurso} é anterior à ativação (${dataInicio.toLocaleDateString()}). IGNORADO.`);
            if (btn) { btn.disabled = false; btn.textContent = '📢 Buscar Último Sorteio'; }
            return;
        }
        
        if (jogoData.ultimoConcursoImportado === concurso) {
            console.log(`⚠️ Sorteio ${concurso} já foi importado`);
            if (btn) { btn.disabled = false; btn.textContent = '📢 Buscar Último Sorteio'; }
            return;
        }
        
        if (!jogoData.primeiraConferenciaRealizada) {
            console.log('🔒 PRIMEIRA CONFERÊNCIA - Este é o PRIMEIRO sorteio após ativação');
            await updateDoc(jogoRef, { 
                primeiraConferenciaRealizada: true, 
                dataPrimeiraConferencia: new Date()
            });
            jogoBloqueado = true;
            await verificarBloqueio();
        }
        
        // SALVAR SORTEIO VINCULADO À COMPETIÇÃO ATUAL
        await addDoc(collection(db, 'sorteios_quina'), {
            concurso: concurso,
            numeros: numeros,
            data: dataSorteioObj,
            importadoEm: new Date(),
            competicaoId: jogoAtualId
        });
        
        await updateDoc(jogoRef, {
            ultimosNumerosSorteados: numeros,
            ultimoConcursoImportado: concurso
        });
        
        await atualizarAcertosParticipantes(numeros);
        alert(`✅ Sorteio ${concurso} importado! Números: ${numeros.join(', ')}`);
        
        await carregarRanking();
        await carregarHistoricoSorteios();
        await carregarNumerosSorteadosAdmin();
        await atualizarStatusGame();
        
    } catch (error) {
        console.error('❌ Erro:', error);
        if (btn) alert('Erro ao buscar sorteio');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📢 Buscar Último Sorteio'; }
    }
}

async function atualizarAcertosParticipantes(novosNumeros) {
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const querySnapshot = await getDocs(q);
    
    let vencedores = [];
    for (const docSnap of querySnapshot.docs) {
        const p = docSnap.data();
        if (p.acertouTodos) continue;
        
        let novosAcertos = 0;
        for (const num of novosNumeros) {
            if (p.numeros.includes(num)) novosAcertos++;
        }
        const novoTotal = (p.acertos || 0) + novosAcertos;
        await updateDoc(doc(db, 'participantes', docSnap.id), { acertos: novoTotal });
        if (novoTotal >= 17) vencedores.push({ id: docSnap.id, nome: p.nome });
    }
    
    if (vencedores.length > 0) await declararVencedores(vencedores);
    await carregarRanking();
}

async function declararVencedores(vencedores) {
    const jogoRef = doc(db, 'jogos', jogoAtualId);
    await updateDoc(jogoRef, { status: 'encerrado' });
    if (intervaloBusca) clearInterval(intervaloBusca);
    
    let msg = '🏆 VENCEDORES! 🏆\n\n';
    vencedores.forEach((v, i) => { msg += `${i+1}º: ${v.nome}\n`; });
    alert(msg);
    setTimeout(() => window.location.reload(), 2000);
}

async function encerrarJogo() {
    if (!jogoAtualId) { alert('Nenhuma competição ativa!'); return; }
    if (confirm('Encerrar jogo atual?')) {
        if (intervaloBusca) clearInterval(intervaloBusca);
        await updateDoc(doc(db, 'jogos', jogoAtualId), { status: 'encerrado' });
        alert('Jogo encerrado!');
        await carregarJogoAtivo();
        await carregarSelectCompeticoes();
        await carregarSelectCompeticoesCadastro();
        await atualizarStatusGame();
        await carregarRanking();
        await carregarCompeticaoPreparandoValor();
    }
}

// ============================================
// HISTÓRICO
// ============================================

async function carregarHistoricoSorteios() {
    if (!jogoAtualId) {
        const container = document.getElementById('historicoSorteios');
        if (container) container.innerHTML = '<div>Selecione uma competição ativa</div>';
        return;
    }
    
    const sorteiosRef = collection(db, 'sorteios_quina');
    const q = query(sorteiosRef, where('competicaoId', '==', jogoAtualId), orderBy('concurso', 'desc'));
    const querySnapshot = await getDocs(q);
    const container = document.getElementById('historicoSorteios');
    
    if (querySnapshot.empty) {
        container.innerHTML = '<div>Nenhum sorteio importado para esta competição</div>';
        return;
    }
    
    let html = '<div style="display: flex; flex-wrap: wrap; gap: 10px;">';
    querySnapshot.forEach(doc => {
        const s = doc.data();
        html += `<div style="background: rgba(241,196,15,0.08); border-radius: 10px; padding: 8px 12px;">
                    <strong>#${s.concurso}</strong><br>${s.numeros.join(', ')}</div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

async function carregarNumerosSorteadosAdmin() {
    if (!jogoAtualId) {
        const container = document.getElementById('gridNumerosSorteadosAdmin');
        if (container) container.innerHTML = '<div>Nenhuma competição ativa</div>';
        return;
    }
    
    const sorteiosRef = collection(db, 'sorteios_quina');
    const q = query(sorteiosRef, where('competicaoId', '==', jogoAtualId));
    const querySnapshot = await getDocs(q);
    
    const numerosSorteados = [];
    querySnapshot.forEach(doc => {
        const s = doc.data();
        s.numeros.forEach(num => { 
            if (!numerosSorteados.includes(num)) numerosSorteados.push(num); 
        });
    });
    
    const container = document.getElementById('gridNumerosSorteadosAdmin');
    let html = '<div style="display: grid; grid-template-columns: repeat(10, 1fr); gap: 5px;">';
    for (let i = 1; i <= 80; i++) {
        const foi = numerosSorteados.includes(i);
        html += `<div style="background: ${foi ? 'rgba(241,196,15,0.15)' : 'rgba(255,255,255,0.04)'}; 
                        color: ${foi ? '#f1c40f' : 'white'}; padding: 6px; text-align: center; border-radius: 6px;">
                    ${i}</div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ============================================
// RESET
// ============================================

async function resetarTudo() {
    if (confirm('⚠️ APAGAR TODOS OS DADOS?')) {
        const confirmacao = prompt('Digite "SIM" para confirmar');
        if (confirmacao === 'SIM') {
            if (intervaloBusca) clearInterval(intervaloBusca);
            const participantes = await getDocs(collection(db, 'participantes'));
            const jogos = await getDocs(collection(db, 'jogos'));
            const sorteios = await getDocs(collection(db, 'sorteios_quina'));
            const historico = await getDocs(collection(db, 'historico_vencedores'));
            const batch = writeBatch(db);
            participantes.forEach(d => batch.delete(d.ref));
            jogos.forEach(d => batch.delete(d.ref));
            sorteios.forEach(d => batch.delete(d.ref));
            historico.forEach(d => batch.delete(d.ref));
            await batch.commit();
            alert('Todos os dados foram apagados!');
            window.location.reload();
        }
    }
}

window.excluirParticipante = async function(id) {
    if (confirm('Excluir este participante?')) {
        await deleteDoc(doc(db, 'participantes', id));
        await carregarSelectCompeticaoLista();
        await carregarRanking();
        await atualizarStatusGame();
        await carregarCompeticaoPreparandoValor();
        alert('Participante excluído!');
    }
};

window.verificarSenha = verificarSenha;
window.logout = logout;