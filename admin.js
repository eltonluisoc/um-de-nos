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
    console.log('Admin carregado - Versão Final');
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
        tab.addEventListener('click', async (e) => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('ativo'));
            tab.classList.add('ativo');
            const targetContent = document.getElementById(tabId);
            if (targetContent) targetContent.classList.add('ativo');
            
            if (tabId === 'dashboard') {
                await carregarJogoAtivo();
                await atualizarStatusGame();
                await carregarRanking();
            }
        });
    });
    
    criarGridNumeros();
    
    setTimeout(async () => {
        if (document.getElementById('dashboard') && document.getElementById('dashboard').classList.contains('ativo')) {
            await carregarJogoAtivo();
            await atualizarStatusGame();
            await carregarRanking();
            console.log('✅ Dashboard atualizado automaticamente');
        }
    }, 800);
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
    
    let html = '';
    
    if (!ativosSnapshot.empty) {
        const jogoDoc = ativosSnapshot.docs[0];
        const jogoData = jogoDoc.data();
        const totalParticipantes = await contarParticipantesPorCompeticao(jogoDoc.id);
        
        // Verificar se já tem sorteio
        const sorteiosRef = collection(db, 'sorteios_quina');
        const sorteiosQuery = query(sorteiosRef, where('competicaoId', '==', jogoDoc.id));
        const sorteiosSnapshot = await getDocs(sorteiosQuery);
        const temSorteio = !sorteiosSnapshot.empty;
        const ultimoSorteio = jogoData.ultimoConcursoImportado || 'Nenhum ainda';
        const primeiraConferencia = jogoData.primeiraConferenciaRealizada || false;
        
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
                    ${temSorteio ? `<div class="status-item">
                        <span class="status-label">Último Sorteio</span>
                        <span class="status-value">${ultimoSorteio}</span>
                    </div>` : ''}
                    <div class="status-item">
                        <span class="status-label">Status Conferência</span>
                        <span class="status-value">${primeiraConferencia ? '🔒 Bloqueado' : '✅ Aberto'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Valor Inscrição</span>
                        <span class="status-value">R$ ${jogoData.valorInscricao || 20},00</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Data Criação</span>
                        <span class="status-value">${jogoData.createdAt?.toDate()?.toLocaleDateString('pt-BR') || '-'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Data Ativação</span>
                        <span class="status-value">${jogoData.dataInicio?.toDate()?.toLocaleDateString('pt-BR') || '-'}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        html = `
            <div class="status-game" style="border-left: 4px solid #6c757d;">
                <div class="status-game-header">
                    <div class="status-icon">⚪</div>
                    <div class="status-title">Nenhuma Competição Ativa</div>
                </div>
                <div class="status-details">
                    <div class="status-item" style="justify-content: center;">
                        <span class="status-value">Vá em Configurações para criar ou ativar uma competição</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    statusGameContainer.innerHTML = html;
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
        await carregarJogoAtivo();
        await carregarRanking();
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
        // Apenas bloqueia se realmente já teve primeira conferência (sorteio importado)
        jogoBloqueado = jogoData.primeiraConferenciaRealizada === true;
        console.log('🏆 Competição ativa carregada:', jogoAtualId, jogoData.nome);
        console.log('📌 Primeira conferência:', jogoData.primeiraConferenciaRealizada);
    } else {
        jogoAtualId = null;
        jogoAtualStatus = null;
        jogoBloqueado = false;
        if (intervaloBusca) clearInterval(intervaloBusca);
        console.log('⚠️ Nenhuma competição ativa');
    }
}

async function carregarSelectCompeticoes() {
    const select = document.getElementById('selectCompeticao');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'preparando'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    select.innerHTML = '<option value="">-- Selecione uma competição para ATIVAR --</option>';
    
    let primeira = true;
    for (const doc of querySnapshot.docs) {
        const jogo = doc.data();
        const option = document.createElement('option');
        option.value = doc.id;
        option.textContent = `🟡 ${jogo.nome} (PREPARANDO) - ${jogo.totalParticipantes || 0} participantes`;
        if (primeira) {
            option.selected = true;
            primeira = false;
        }
        select.appendChild(option);
    }
    
    if (select.options.length === 1) {
        select.innerHTML = '<option value="">-- Nenhuma competição em PREPARAÇÃO --</option>';
    }
}

async function carregarSelectCompeticoesCadastro() {
    const select = document.getElementById('selectCompeticaoCadastro');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'preparando'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    select.innerHTML = '';
    const bloqueioDiv = document.getElementById('bloqueioCadastro');
    
    if (querySnapshot.empty) {
        select.innerHTML = '<option value="">-- Nenhuma competição em PREPARAÇÃO --</option>';
        if (bloqueioDiv) bloqueioDiv.style.display = 'block';
        document.getElementById('btnSalvarParticipante')?.setAttribute('disabled', 'disabled');
    } else {
        if (bloqueioDiv) bloqueioDiv.style.display = 'none';
        document.getElementById('btnSalvarParticipante')?.removeAttribute('disabled');
        
        let primeira = true;
        for (const doc of querySnapshot.docs) {
            const jogo = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = `🟡 ${jogo.nome} - ${jogo.totalParticipantes || 0} participantes (R$ ${jogo.valorInscricao || 20})`;
            if (primeira) {
                option.selected = true;
                primeira = false;
            }
            select.appendChild(option);
        }
    }
}

async function carregarSelectCompeticaoLista() {
    const select = document.getElementById('selectCompeticaoLista');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const querySnapshot = await getDocs(jogosRef);
    
    // Ordenar: primeiro ATIVO, depois PREPARANDO, depois ENCERRADO
    const jogos = [];
    querySnapshot.forEach(doc => {
        jogos.push({ id: doc.id, ...doc.data() });
    });
    jogos.sort((a, b) => {
        const ordem = { 'aberto': 1, 'preparando': 2, 'encerrado': 3 };
        return ordem[a.status] - ordem[b.status];
    });
    
    select.innerHTML = '';
    
    let primeira = true;
    let idSelecionado = null;
    
    for (const jogo of jogos) {
        const statusIcon = jogo.status === 'aberto' ? '🟢' : (jogo.status === 'preparando' ? '🟡' : '🔴');
        const statusText = jogo.status === 'aberto' ? 'ATIVO' : (jogo.status === 'preparando' ? 'PREPARANDO' : 'ENCERRADO');
        const option = document.createElement('option');
        option.value = jogo.id;
        option.textContent = `${statusIcon} ${jogo.nome} (${statusText}) - ${jogo.totalParticipantes || 0} participantes`;
        
        if (primeira) {
            option.selected = true;
            idSelecionado = jogo.id;
            primeira = false;
        }
        select.appendChild(option);
    }
    
    // Carregar participantes da competição selecionada
    if (idSelecionado) {
        await carregarParticipantesPorCompeticao(idSelecionado);
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
            tbody.innerHTML = '<td><td colspan="5" style="text-align: center;">Nenhum participante cadastrado</td></tr>';
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
    
    const dataAtivacao = new Date();
    
    if (confirm(`Iniciar competição "${jogoDoc.data().nome}" com ${totalParticipantes} participantes?\n\n⚠️ ATENÇÃO:\n- Os acertos serão ZERADOS\n- Os sorteios anteriores serão LIMPOS\n- A competição começará a contar APÓS a ativação (${dataAtivacao.toLocaleString()})\n- NÃO serão aceitos novos participantes após a ativação`)) {
        
        // 1. Limpar sorteios antigos desta competição
        console.log('🗑️ Limpando sorteios antigos...');
        const sorteiosRef = collection(db, 'sorteios_quina');
        const sorteiosQuery = query(sorteiosRef, where('competicaoId', '==', selectedId));
        const sorteiosSnapshot = await getDocs(sorteiosQuery);
        const batchSorteios = writeBatch(db);
        sorteiosSnapshot.forEach(docSnap => {
            batchSorteios.delete(docSnap.ref);
        });
        await batchSorteios.commit();
        
        // 2. Zerar acertos dos participantes
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
        
        // 3. Atualizar competição - NÃO marcar primeiraConferenciaRealizada ainda
        await updateDoc(jogoRef, { 
            status: 'aberto', 
            dataInicio: dataAtivacao,
            ultimoConcursoImportado: null,
            ultimosNumerosSorteados: null,
            primeiraConferenciaRealizada: false  // Mantém false até o primeiro sorteio
        });
        
        alert(`✅ Competição "${jogoDoc.data().nome}" ativada com SUCESSO!\n\n📌 Os acertos foram ZERADOS.\n📌 Os sorteios antigos foram REMOVIDOS.\n📌 A competição começará a contar APÓS ${dataAtivacao.toLocaleString()}\n📌 NÃO serão aceitos novos participantes.\n📌 Clique em OK para continuar.`);
        
        // Recarregar os dados sem recarregar a página inteira
        await carregarJogoAtivo();
        await carregarSelectCompeticoes();
        await carregarSelectCompeticoesCadastro();
        await carregarSelectCompeticaoLista();
        await carregarRanking();
        await atualizarStatusGame();
        await verificarBloqueio();
        
        // Iniciar busca automática
        iniciarBuscaAutomaticaMelhorada();
        
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
    // Só bloqueia se realmente já teve primeira conferência (sorteio importado)
    const bloqueado = jogoBloqueado === true;
    const bloqueioMsg = document.getElementById('bloqueioCadastro');
    const infoBloqueio = document.getElementById('infoBloqueio');
    
    if (bloqueado) {
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
    // Verifica se está bloqueado (apenas se já teve primeira conferência)
    if (jogoBloqueado === true) {
        alert('⚠️ Competição já começou! Primeira conferência já realizada. Não é possível adicionar novos participantes.');
        return;
    }
    
    const selectCompeticao = document.getElementById('selectCompeticaoCadastro');
    const competicaoId = selectCompeticao.value;
    const nome = document.getElementById('nomeParticipante').value;
    
    if (!competicaoId) {
        alert('Selecione uma competição em PREPARAÇÃO!');
        return;
    }
    
    const jogoRef = doc(db, 'jogos', competicaoId);
    const jogoDoc = await getDoc(jogoRef);
    if (jogoDoc.exists() && jogoDoc.data().status !== 'preparando') {
        alert('⚠️ Esta competição não está mais em PREPARAÇÃO. Não é possível adicionar participantes.');
        await carregarSelectCompeticoesCadastro();
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
        const jogoRef2 = doc(db, 'jogos', competicaoId);
        await updateDoc(jogoRef2, { totalParticipantes: querySnapshot.size });
        
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
    
    if (!jogoAtualId || jogoAtualStatus !== 'aberto') {
        container.innerHTML = '<div>Nenhuma competição ativa.</div>';
        return;
    }
    
    try {
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            container.innerHTML = '<div>Nenhum participante.</div>';
            return;
        }
        
        const participantes = [];
        querySnapshot.forEach(doc => {
            participantes.push({ id: doc.id, ...doc.data() });
        });
        participantes.sort((a, b) => (b.acertos || 0) - (a.acertos || 0));
        
        // Usar DocumentFragment para melhor performance
        const fragment = document.createDocumentFragment();
        let pos = 1;
        
        for (const p of participantes) {
            const progresso = ((p.acertos || 0) / 17) * 100;
            const div = document.createElement('div');
            div.className = 'linha-participante';
            div.innerHTML = `
                <span>${pos++}º</span>
                <span><strong>${p.nome}</strong></span>
                <span>${p.acertos || 0}/17</span>
                <div class="barra-progresso">
                    <div class="barra-progresso-fill" style="width: ${progresso}%"></div>
                </div>
            `;
            fragment.appendChild(div);
        }
        
        container.innerHTML = '';
        container.appendChild(fragment);
        
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
    if (!jogoAtualId || jogoAtualStatus !== 'aberto') {
        console.log('⏸️ Busca automática desativada - nenhuma competição ativa');
        return;
    }
    
    console.log('🔄 Busca automática ativada para competição:', jogoAtualId);
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
        
        // 🔧 CORREÇÃO: Comparar APENAS a data (sem hora)
        const dataSorteioStr = dataSorteioObj.toISOString().split('T')[0];
        const dataInicioStr = dataInicio.toISOString().split('T')[0];
        
        console.log(`📅 Data sorteio: ${dataSorteioStr}, Data ativação: ${dataInicioStr}`);
        
        if (dataSorteioStr < dataInicioStr) {
            console.log(`⏸️ Sorteio ${concurso} (${dataSorteioStr}) é anterior à ativação (${dataInicioStr}). IGNORADO.`);
            if (btn) { btn.disabled = false; btn.textContent = '📢 Buscar Último Sorteio'; }
            return;
        }
        
        console.log(`✅ Sorteio ${concurso} é válido! (${dataSorteioStr} >= ${dataInicioStr})`);
        
        if (jogoData.ultimoConcursoImportado === concurso) {
            console.log(`⚠️ Sorteio ${concurso} já foi importado`);
            if (btn) { btn.disabled = false; btn.textContent = '📢 Buscar Último Sorteio'; }
            return;
        }
        
        const isPrimeiraConferencia = !jogoData.primeiraConferenciaRealizada;
        
        if (isPrimeiraConferencia) {
            console.log('🔒 PRIMEIRA CONFERÊNCIA - Este é o PRIMEIRO sorteio após ativação');
            await updateDoc(jogoRef, { 
                primeiraConferenciaRealizada: true, 
                dataPrimeiraConferencia: new Date()
            });
            jogoBloqueado = true;
            await verificarBloqueio();
        }
        
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
        
        await atualizarAcertosParticipantes();
        
        const msg = isPrimeiraConferencia ? 
            `✅ PRIMEIRO SORTEIO ${concurso} importado! Números: ${numeros.join(', ')}\n\n🔒 A partir de agora, NÃO serão aceitos novos participantes.` :
            `✅ Sorteio ${concurso} importado! Números: ${numeros.join(', ')}`;
        
        alert(msg);
        
        await carregarRanking();
        await carregarHistoricoSorteios();
        await carregarNumerosSorteadosAdmin();
        await atualizarStatusGame();
        
        // Marcar que o sorteio de hoje foi encontrado
        sorteioEncontradoHoje = true;
        
    } catch (error) {
        console.error('❌ Erro:', error);
        if (btn) alert('Erro ao buscar sorteio: ' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📢 Buscar Último Sorteio'; }
    }
}

async function atualizarAcertosParticipantes(novosNumeros) {
    console.log('🔄 RECALCULANDO ACERTOS DO ZERO...');
    
    // 1. Buscar TODOS os sorteios da competição
    const sorteiosRef = collection(db, 'sorteios_quina');
    const sorteiosQuery = query(sorteiosRef, where('competicaoId', '==', jogoAtualId));
    const sorteiosSnapshot = await getDocs(sorteiosQuery);
    
    // 2. Criar um SET com TODOS os números sorteados (sem duplicatas)
    const numerosSorteadosSet = new Set();
    for (const sorteioDoc of sorteiosSnapshot.docs) {
        const numeros = sorteioDoc.data().numeros;
        for (const num of numeros) {
            numerosSorteadosSet.add(num);
        }
    }
    
    const numerosSorteados = Array.from(numerosSorteadosSet).sort((a,b) => a-b);
    console.log(`📊 Números sorteados únicos (${numerosSorteados.length}):`, numerosSorteados);
    
    // 3. Buscar todos os participantes
    const participantesRef = collection(db, 'participantes');
    const participantesQuery = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const participantesSnapshot = await getDocs(participantesQuery);
    
    let vencedores = [];
    let relatorio = '\n========== RELATÓRIO DE ACERTOS ==========\n';
    
    // 4. Calcular acertos de cada participante
    for (const participanteDoc of participantesSnapshot.docs) {
        const p = participanteDoc.data();
        if (p.acertouTodos) continue;
        
        // Contar quantos números do participante estão no SET
        let acertos = 0;
        const acertados = [];
        
        for (const num of p.numeros) {
            if (numerosSorteadosSet.has(num)) {
                acertos++;
                acertados.push(num);
            }
        }
        
        relatorio += `\n📌 ${p.nome}:\n`;
        relatorio += `   Números do participante: ${p.numeros.join(', ')}\n`;
        relatorio += `   Números acertados: ${acertados.join(', ')}\n`;
        relatorio += `   Total acertos: ${acertos}/17 (anterior: ${p.acertos || 0})\n`;
        
        // Atualizar no Firestore apenas se mudou
        if (acertos !== (p.acertos || 0)) {
            await updateDoc(doc(db, 'participantes', participanteDoc.id), { 
                acertos: acertos
            });
            console.log(`✏️ Atualizando ${p.nome}: ${p.acertos || 0} → ${acertos}`);
        }
        
        if (acertos >= 17) {
            vencedores.push({ id: participanteDoc.id, nome: p.nome, acertos: acertos });
        }
    }
    
    console.log(relatorio);
    
    if (vencedores.length > 0) {
        await declararVencedores(vencedores);
    }
    
    await carregarRanking();
    console.log('✅ ========== FIM DA ATUALIZAÇÃO ==========');
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
    const q = query(sorteiosRef, where('competicaoId', '==', jogoAtualId));
    const querySnapshot = await getDocs(q);
    const container = document.getElementById('historicoSorteios');
    
    if (querySnapshot.empty) {
        container.innerHTML = '<div>Nenhum sorteio importado para esta competição</div>';
        return;
    }
    
    const sorteios = [];
    querySnapshot.forEach(doc => {
        sorteios.push({ id: doc.id, ...doc.data() });
    });
    sorteios.sort((a, b) => b.concurso - a.concurso);
    
    let html = '<div style="display: flex; flex-wrap: wrap; gap: 10px;">';
    for (const s of sorteios) {
        html += `<div style="background: rgba(241,196,15,0.08); border-radius: 10px; padding: 8px 12px;">
                    <strong>#${s.concurso}</strong><br>${s.numeros.join(', ')}</div>`;
    }
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
window.atualizarAcertosParticipantes = atualizarAcertosParticipantes;
window.carregarJogoAtivo = carregarJogoAtivo;
window.carregarRanking = carregarRanking;
window.carregarTodosParticipantes = carregarTodosParticipantes;
window.carregarHistoricoSorteios = carregarHistoricoSorteios;
window.carregarNumerosSorteadosAdmin = carregarNumerosSorteadosAdmin;
window.atualizarStatusGame = atualizarStatusGame;
window.carregarDados = carregarDados;
window.buscarSorteioQuina = buscarSorteioQuina;
window.verificarSenha = verificarSenha;
window.logout = logout;