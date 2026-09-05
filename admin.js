import { db, app } from './firebase-config.js';
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
    limit,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Login do painel via Firebase Authentication.
// Só este e-mail tem acesso de escrita (ver firestore.rules).
const auth = getAuth(app);
const ADMIN_EMAIL = 'eltonluisoc@gmail.com';
let dadosCarregados = false;
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

// ============================================
// 🔥 NOVA FUNÇÃO: BUSCAR CONCURSO ESPECÍFICO POR NÚMERO
// ============================================
async function buscarConcursoPorNumero(numero) {
    const apis = [
        `https://loteriascaixa-api.herokuapp.com/api/quina/${numero}`,
        `https://apiloteria.herokuapp.com/api/quina/${numero}`,
        `https://loterias-api.vercel.app/api/quina/${numero}`
    ];
    
    for (const api of apis) {
        try {
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
                return { numeros, concurso, data };
            }
        } catch (e) {
            console.log(`⚠️ Erro na API para concurso ${numero}:`, e.message);
        }
    }
    return null;
}

// ============================================
// 🔥 NOVA FUNÇÃO: IMPORTAR CONCURSOS INTERMEDIÁRIOS
// ============================================
async function importarConcursosIntermediarios(ultimoImportado, ultimoDisponivel) {
    console.log(`🔍 Verificando concursos entre ${ultimoImportado + 1} e ${ultimoDisponivel}...`);
    
    let importados = 0;
    let faltantes = [];
    
    for (let concurso = ultimoImportado + 1; concurso <= ultimoDisponivel; concurso++) {
        console.log(`📡 Verificando concurso #${concurso}...`);
        
        // Verificar se já existe no Firestore
        const sorteiosRef = collection(db, 'sorteios_quina');
        const q = query(sorteiosRef, where('concurso', '==', concurso));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            console.log(`✅ Concurso #${concurso} já importado.`);
            continue;
        }
        
        // Buscar da API
        const dados = await buscarConcursoPorNumero(concurso);
        if (!dados) {
            console.log(`❌ Concurso #${concurso} não encontrado na API (pode não ter ocorrido ainda).`);
            faltantes.push(concurso);
            continue;
        }
        
        // Importar
        console.log(`📥 Importando concurso #${concurso}: ${dados.numeros.join(', ')}`);
        
        const dataSorteio = new Date();
        if (dados.data) {
            const partes = dados.data.split('/');
            if (partes.length === 3) {
                dataSorteio.setFullYear(partes[2], partes[1] - 1, partes[0]);
            }
        }
        
        await addDoc(collection(db, 'sorteios_quina'), {
            concurso: dados.concurso,
            numeros: dados.numeros,
            data: dataSorteio,
            importadoEm: new Date(),
            competicaoId: jogoAtualId
        });
        
        importados++;
        console.log(`✅ Concurso #${concurso} importado!`);
    }
    
    if (importados > 0) {
        // Atualizar o último concurso importado no jogo
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        await updateDoc(jogoRef, {
            ultimoConcursoImportado: ultimoDisponivel
        });
        console.log(`📌 Jogo atualizado: último concurso importado = ${ultimoDisponivel}`);
    }
    
    return { importados, faltantes };
}

// ============================================
// INICIALIZAÇÃO E LOGIN
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin carregado - login seguro (Firebase Auth)');
    const btnEntrar = document.getElementById('btnEntrarAdmin');
    const emailInput = document.getElementById('emailInput');
    const senhaInput = document.getElementById('senhaInput');

    if (btnEntrar) {
        btnEntrar.addEventListener('click', fazerLogin);
    }
    [emailInput, senhaInput].forEach(campo => {
        campo?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') fazerLogin();
        });
    });

    // Mantém a sessão: se já estava logado, entra direto; se deslogar, volta ao login.
    onAuthStateChanged(auth, async (user) => {
        if (user && user.email === ADMIN_EMAIL) {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('adminContent').style.display = 'block';
            if (!dadosCarregados) {
                dadosCarregados = true;
                await carregarDados();
            }
        } else {
            if (user) { await signOut(auth); }
            dadosCarregados = false;
            if (intervaloBusca) clearInterval(intervaloBusca);
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('adminContent').style.display = 'none';
        }
    });

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

async function fazerLogin() {
    const email = document.getElementById('emailInput').value.trim();
    const senha = document.getElementById('senhaInput').value;
    const btn = document.getElementById('btnEntrarAdmin');
    const loading = document.getElementById('msgLoading');
    const msgErro = document.getElementById('msgErro');

    if (!email || !senha) {
        msgErro.textContent = '⚠️ Preencha e-mail e senha';
        return;
    }

    msgErro.textContent = '';
    loading.style.display = 'block';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ ENTRANDO...'; }

    try {
        await signInWithEmailAndPassword(auth, email, senha);
        // onAuthStateChanged assume daqui: mostra o painel e carrega os dados.
        loading.style.display = 'none';
        document.getElementById('senhaInput').value = '';
    } catch (erro) {
        loading.style.display = 'none';
        if (btn) { btn.disabled = false; btn.textContent = '🔐 ENTRAR'; }
        const amigavel = {
            'auth/invalid-email': 'E-mail inválido.',
            'auth/invalid-credential': 'E-mail ou senha incorretos.',
            'auth/wrong-password': 'E-mail ou senha incorretos.',
            'auth/user-not-found': 'E-mail ou senha incorretos.',
            'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
            'auth/network-request-failed': 'Sem conexão. Verifique a internet.'
        };
        msgErro.textContent = '❌ ' + (amigavel[erro.code] || ('Falha no login: ' + erro.code));
        document.getElementById('senhaInput').value = '';
        document.getElementById('senhaInput').focus();
    }
}

async function logout() {
    if (intervaloBusca) clearInterval(intervaloBusca);
    await signOut(auth);
    // onAuthStateChanged volta a tela de login automaticamente.
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
    await verificarMaiorConcurso();
    iniciarBuscaAutomaticaMelhorada();
}

// ============================================
// 🚀 FUNÇÃO CORRIGIDA - carregarJogoAtivo
// ============================================
async function carregarJogoAtivo() {
    console.log('🔍 carregarJogoAtivo() - Iniciando...');
    
    const jogosRef = collection(db, 'jogos');
    
    // 1. TENTAR BUSCAR JOGO ATIVO
    const qAtivo = query(jogosRef, where('status', '==', 'aberto'), limit(1));
    const ativoSnapshot = await getDocs(qAtivo);
    
    if (!ativoSnapshot.empty) {
        const jogoDoc = ativoSnapshot.docs[0];
        jogoAtualId = jogoDoc.id;
        jogoAtualStatus = jogoDoc.data().status;
        const jogoData = jogoDoc.data();
        jogoBloqueado = jogoData.primeiraConferenciaRealizada === true;
        console.log('🏆 Competição ativa carregada:', jogoAtualId, jogoData.nome);
        console.log('📌 Primeira conferência:', jogoData.primeiraConferenciaRealizada);
        
        const statusDiv = document.getElementById('statusAdmin');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <p>🏆 Competição ativa: ${jogoData.nome}</p>
                <p>📌 Status: ATIVO</p>
                <p>👥 Participantes: ${await contarParticipantesPorCompeticao(jogoAtualId)}</p>
            `;
        }
        
        if (jogoAtualId) {
            iniciarEscutaRanking();
        }
        
        return;
    }
    
    // 2. SE NÃO TEM JOGO ATIVO, BUSCAR O ÚLTIMO ENCERRADO
    console.log('⚠️ Nenhuma competição ativa. Buscando último encerrado...');
    
    const qEncerrado = query(jogosRef, where('status', '==', 'encerrado'));
    const encerradoSnapshot = await getDocs(qEncerrado);
    
    if (!encerradoSnapshot.empty) {
        const jogos = [];
        encerradoSnapshot.forEach(doc => {
            const data = doc.data();
            jogos.push({ 
                id: doc.id, 
                nome: data.nome,
                status: data.status,
                encerradoEm: data.encerradoEm,
                vencedorNome: data.vencedorNome,
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
        jogoAtualId = jogoDoc.id;
        jogoAtualStatus = 'encerrado';
        console.log('📌 Último jogo encerrado carregado:', jogoDoc.nome);
        console.log('👑 Vencedor:', jogoDoc.vencedorNome || 'Nenhum');
        
        const statusDiv = document.getElementById('statusAdmin');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <p>🏆 Última competição: ${jogoDoc.nome}</p>
                <p>👑 Vencedor: ${jogoDoc.vencedorNome || 'Não houve vencedor'}</p>
                <p>📅 Encerrada em: ${jogoDoc.encerradoEm?.toDate?.()?.toLocaleDateString('pt-BR') || '-'}</p>
                <p>📊 Último sorteio: ${jogoDoc.ultimoConcursoImportado || 'Nenhum'}</p>
            `;
        }
        
        if (jogoAtualId) {
            iniciarEscutaRanking();
        }
        
        return;
    }
    
    // 3. NENHUM JOGO ENCONTRADO
    jogoAtualId = null;
    jogoAtualStatus = null;
    jogoBloqueado = false;
    if (intervaloBusca) clearInterval(intervaloBusca);
    console.log('⚠️ Nenhuma competição encontrada');
}

// ============================================
// RANKING - COM BARRA DE PROGRESSO E ATUALIZAÇÃO EM TEMPO REAL
// ============================================

async function carregarRanking() {
    const container = document.getElementById('listaRankingAdmin');
    if (!container) {
        console.log('⚠️ Container listaRankingAdmin não encontrado');
        return;
    }
    
    console.log('📊 carregarRanking() - Iniciando...');
    
    let jogoIdParaBuscar = jogoAtualId;
    let nomeCompeticao = '';
    let isEncerrado = false;
    
    if (!jogoIdParaBuscar || jogoAtualStatus !== 'aberto') {
        console.log('🔍 Buscando último jogo encerrado para o ranking...');
        
        const jogosRef = collection(db, 'jogos');
        const q = query(jogosRef, where('status', '==', 'encerrado'));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const jogos = [];
            querySnapshot.forEach(doc => {
                const data = doc.data();
                jogos.push({ 
                    id: doc.id, 
                    nome: data.nome,
                    encerradoEm: data.encerradoEm,
                    vencedorNome: data.vencedorNome,
                    ...data
                });
            });
            
            jogos.sort((a, b) => {
                const dateA = a.encerradoEm?.toDate ? a.encerradoEm.toDate() : new Date(0);
                const dateB = b.encerradoEm?.toDate ? b.encerradoEm.toDate() : new Date(0);
                return dateB - dateA;
            });
            
            const jogoDoc = jogos[0];
            jogoIdParaBuscar = jogoDoc.id;
            nomeCompeticao = jogoDoc.nome || 'Competição encerrada';
            isEncerrado = true;
            console.log(`📌 Mostrando ranking do último jogo encerrado: ${nomeCompeticao}`);
        } else {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Nenhuma competição encontrada.</div>';
            return;
        }
    }
    
    if (!jogoIdParaBuscar) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Nenhuma competição ativa ou encerrada.</div>';
        return;
    }
    
    try {
        const participantesRef = collection(db, 'participantes');
        const q = query(participantesRef, where('jogoId', '==', jogoIdParaBuscar));
        const querySnapshot = await getDocs(q);
        
        container.innerHTML = '';
        
        const titulo = document.createElement('div');
        titulo.style.cssText = 'color: #ff8c00; text-align: center; padding: 10px; font-weight: bold; font-size: 1.1em;';
        titulo.textContent = isEncerrado ? `🏆 ${nomeCompeticao} (ENCERRADA)` : '🏆 RANKING ATUAL';
        container.appendChild(titulo);
        
        if (querySnapshot.empty) {
            const msg = document.createElement('div');
            msg.style.cssText = 'text-align: center; padding: 20px; color: rgba(255,255,255,0.5);';
            msg.textContent = 'Nenhum participante cadastrado nesta competição.';
            container.appendChild(msg);
            return;
        }
        
        const participantes = [];
        querySnapshot.forEach(doc => {
            const data = doc.data();
            participantes.push({ 
                id: doc.id, 
                nome: data.nome || 'Anônimo',
                numeros: data.numeros || [],
                acertos: data.acertos || 0,
                acertouTodos: data.acertouTodos === true,
                ordemVitoria: data.ordemVitoria || null,
                premioGanho: data.premioGanho || 0,
                ...data
            });
        });
        
        participantes.sort((a, b) => {
            if (a.acertouTodos && !b.acertouTodos) return -1;
            if (!a.acertouTodos && b.acertouTodos) return 1;
            return (b.acertos || 0) - (a.acertos || 0);
        });
        
        console.log(`✅ ${participantes.length} participantes encontrados e ordenados`);
        
        const header = document.createElement('div');
        header.style.cssText = 'display: grid; grid-template-columns: 50px 1fr 80px 100px; padding: 10px; background: rgba(241,196,15,0.15); color: #f1c40f; border-radius: 10px; font-weight: bold; margin-bottom: 10px;';
        header.innerHTML = `
            <span>Pos</span>
            <span>Participante</span>
            <span>Acertos</span>
            <span>Progresso</span>
        `;
        container.appendChild(header);
        
        let pos = 1;
        const fragment = document.createDocumentFragment();
        
        for (const p of participantes) {
            const progresso = Math.min(((p.acertos || 0) / 17) * 100, 100);
            const div = document.createElement('div');
            div.className = 'linha-participante';
            
            if (p.acertouTodos === true) {
                div.style.background = 'rgba(255,215,0,0.15)';
                div.style.borderLeft = '4px solid #ffd700';
                div.style.borderRadius = '4px';
            }
            
            let posicaoDisplay = pos;
            if (p.acertouTodos) {
                posicaoDisplay = `👑 ${pos}º`;
            } else if (pos === 1 && !p.acertouTodos) {
                posicaoDisplay = '🏆 1º';
            } else if (pos === 2) {
                posicaoDisplay = '🥈 2º';
            } else if (pos === 3) {
                posicaoDisplay = '🥉 3º';
            } else {
                posicaoDisplay = `${pos}º`;
            }
            
            let premioTexto = '';
            if (p.premioGanho && p.premioGanho > 0) {
                premioTexto = ` 💰 R$ ${p.premioGanho.toFixed(2)}`;
            }
            
            div.innerHTML = `
                <span>${posicaoDisplay}</span>
                <span><strong>${p.nome}</strong>${premioTexto}</span>
                <span>${p.acertos || 0}/17</span>
                <div style="display:flex;align-items:center;gap:8px;">
                    <div style="flex:1;background:rgba(255,255,255,0.2);border-radius:10px;height:8px;overflow:hidden;">
                        <div style="background:${p.acertouTodos ? '#ffd700' : '#f1c40f'};height:100%;width:${progresso}%;transition:width 0.5s ease;border-radius:10px;"></div>
                    </div>
                    <span style="font-size:0.75em;color:rgba(255,255,255,0.6);min-width:35px;">${Math.round(progresso)}%</span>
                </div>
            `;
            fragment.appendChild(div);
            pos++;
        }
        
        container.appendChild(fragment);
        
        if (isEncerrado) {
            const vencedor = participantes.find(p => p.acertouTodos === true);
            if (vencedor) {
                const info = document.createElement('div');
                info.style.cssText = 'margin-top: 15px; padding: 12px; background: rgba(255,215,0,0.1); border-radius: 10px; text-align: center; border: 1px solid rgba(255,215,0,0.3);';
                info.innerHTML = `
                    🎉 <strong>CAMPEÃO:</strong> ${vencedor.nome} 🎉<br>
                    💰 <strong>Prêmio:</strong> R$ ${(vencedor.premioGanho || 0).toFixed(2)}
                `;
                container.appendChild(info);
            }
        }
        
    } catch (error) {
        console.error('❌ Erro ao carregar ranking:', error);
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: #dc3545;">Erro ao carregar ranking: ${error.message}</div>`;
    }
}

// ============================================
// FUNÇÃO DE TESTE PARA DIAGNÓSTICO
// ============================================
window.diagnosticar = async function() {
    console.log('🔍 INICIANDO DIAGNÓSTICO DO RANKING...');
    
    try {
        console.log('\n📋 LISTA DE JOGOS:');
        const jogosRef = collection(db, 'jogos');
        const allGames = await getDocs(jogosRef);
        allGames.docs.forEach(doc => {
            const data = doc.data();
            console.log(`- Jogo ${doc.id}: status="${data.status}", nome="${data.nome}", encerradoEm=${data.encerradoEm ? '✅' : '❌'}`);
        });
        
        console.log('\n🔎 BUSCANDO JOGOS ENCERRADOS:');
        const q = query(jogosRef, where('status', '==', 'encerrado'));
        const encerrados = await getDocs(q);
        console.log(`Encontrados: ${encerrados.size} jogos encerrados`);
        encerrados.docs.forEach(doc => {
            const data = doc.data();
            console.log(`- ${doc.id}: "${data.nome}", encerradoEm=${data.encerradoEm?.toDate?.()?.toLocaleString() || 'N/A'}`);
        });
        
        if (jogoAtualId) {
            console.log(`\n👥 PARTICIPANTES DO JOGO ${jogoAtualId}:`);
            const participantesRef = collection(db, 'participantes');
            const qp = query(participantesRef, where('jogoId', '==', jogoAtualId));
            const participantes = await getDocs(qp);
            console.log(`Encontrados: ${participantes.size} participantes`);
            participantes.docs.forEach(doc => {
                const data = doc.data();
                console.log(`- ${doc.id}: ${data.nome} - ${data.acertos || 0} acertos`);
            });
        }
        
        console.log('\n✅ DIAGNÓSTICO CONCLUÍDO');
        
    } catch (error) {
        console.error('❌ ERRO NO DIAGNÓSTICO:', error);
    }
};

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

async function contarParticipantesPorCompeticao(competicaoId) {
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', competicaoId));
    const snapshot = await getDocs(q);
    return snapshot.size;
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

// ============================================
// ATUALIZAR STATUS DO JOGO NO DASHBOARD
// ============================================
async function atualizarStatusGame() {
    const statusGameContainer = document.getElementById('statusGameContainer');
    if (!statusGameContainer) return;
    
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    const hora = hoje.getHours();
    const temSorteioHoje = (diaSemana >= 1 && diaSemana <= 6);
    
    let statusSorteioMsg = '';
    let statusSorteioCor = '#6c757d';
    
    if (!temSorteioHoje) {
        statusSorteioMsg = '📌 Hoje não há sorteio (domingo)';
        statusSorteioCor = '#6c757d';
    } else if (hora < 20) {
        statusSorteioMsg = '⏳ Aguardando sorteio (20h)';
        statusSorteioCor = '#ff8c00';
    } else {
        statusSorteioMsg = '🔄 Buscando sorteio de hoje...';
        statusSorteioCor = '#f1c40f';
    }
    
    let html = '';
    
    const jogosAtivosRef = collection(db, 'jogos');
    const ativosQuery = query(jogosAtivosRef, where('status', '==', 'aberto'), limit(1));
    const ativosSnapshot = await getDocs(ativosQuery);
    
    if (!ativosSnapshot.empty) {
        const jogoDoc = ativosSnapshot.docs[0];
        const jogoData = jogoDoc.data();
        const totalParticipantes = await contarParticipantesPorCompeticao(jogoDoc.id);
        
        const sorteiosRef = collection(db, 'sorteios_quina');
        const sorteiosQuery = query(sorteiosRef, where('competicaoId', '==', jogoDoc.id));
        const sorteiosSnapshot = await getDocs(sorteiosQuery);
        const temSorteio = !sorteiosSnapshot.empty;
        const ultimoSorteio = jogoData.ultimoConcursoImportado || 'Nenhum ainda';
        const primeiraConferencia = jogoData.primeiraConferenciaRealizada || false;
        
        if (temSorteio && jogoData.ultimoConcursoImportado) {
            const hojeStr = hoje.toISOString().split('T')[0];
            const dataUltimoSorteio = jogoData.ultimosNumerosSorteados?.dataUltimoSorteio?.toDate?.()?.toISOString().split('T')[0];
            if (dataUltimoSorteio === hojeStr) {
                statusSorteioMsg = '✅ Sorteio de hoje já importado!';
                statusSorteioCor = '#28a745';
            }
        }
        
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
                        <span class="status-label">Status Sorteio</span>
                        <span class="status-value" style="color: ${statusSorteioCor};">${statusSorteioMsg}</span>
                    </div>
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
                        <span class="status-value">${jogoData.createdAt?.toDate?.()?.toLocaleDateString('pt-BR') || '-'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Data Ativação</span>
                        <span class="status-value">${jogoData.dataInicio?.toDate?.()?.toLocaleDateString('pt-BR') || '-'}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        const jogosEncerradosRef = collection(db, 'jogos');
        const qEncerrado = query(jogosEncerradosRef, where('status', '==', 'encerrado'));
        const encerradoSnapshot = await getDocs(qEncerrado);
        
        if (!encerradoSnapshot.empty) {
            const jogos = [];
            encerradoSnapshot.forEach(doc => {
                jogos.push({ id: doc.id, ...doc.data() });
            });
            jogos.sort((a, b) => {
                const dateA = a.encerradoEm?.toDate ? a.encerradoEm.toDate() : new Date(0);
                const dateB = b.encerradoEm?.toDate ? b.encerradoEm.toDate() : new Date(0);
                return dateB - dateA;
            });
            const jogoDoc = jogos[0];
            const jogoData = jogoDoc;
            const totalParticipantes = await contarParticipantesPorCompeticao(jogoDoc.id);
            const vencedorNome = jogoData.vencedorNome || 'Nenhum';
            
            html += `
                <div class="status-game" style="border-left: 4px solid #ff8c00;">
                    <div class="status-game-header">
                        <div class="status-icon">🏆</div>
                        <div class="status-title">Última Competição Encerrada</div>
                    </div>
                    <div class="status-details">
                        <div class="status-item">
                            <span class="status-label">Nome</span>
                            <span class="status-value">${jogoData.nome || 'Edição'}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Vencedor</span>
                            <span class="status-value" style="color: #ffd700;">👑 ${vencedorNome}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Participantes</span>
                            <span class="status-value">${totalParticipantes}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Último Sorteio</span>
                            <span class="status-value">${jogoData.ultimoConcursoImportado || 'Nenhum'}</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Data Encerramento</span>
                            <span class="status-value">${jogoData.encerradoEm?.toDate?.()?.toLocaleDateString('pt-BR') || '-'}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            html = `
                <div class="status-game" style="border-left: 4px solid #6c757d;">
                    <div class="status-game-header">
                        <div class="status-icon">⚪</div>
                        <div class="status-title">Nenhuma Competição</div>
                    </div>
                    <div class="status-details">
                        <div class="status-item" style="justify-content: center;">
                            <span class="status-value">Vá em Configurações para criar uma competição</span>
                        </div>
                    </div>
                </div>
            `;
        }
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

async function carregarSelectCompeticoes() {
    const select = document.getElementById('selectCompeticao');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'preparando'));
    const querySnapshot = await getDocs(q);
    
    const jogos = [];
    querySnapshot.forEach(doc => {
        jogos.push({ id: doc.id, ...doc.data() });
    });
    jogos.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return dateB - dateA;
    });
    
    select.innerHTML = '<option value="">-- Selecione uma competição para ATIVAR --</option>';
    for (const jogo of jogos) {
        const option = document.createElement('option');
        option.value = jogo.id;
        option.textContent = `🟡 ${jogo.nome} (PREPARANDO) - ${jogo.totalParticipantes || 0} participantes`;
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
    const q = query(jogosRef, where('status', '==', 'preparando'));
    const querySnapshot = await getDocs(q);
    
    const jogos = [];
    querySnapshot.forEach(doc => {
        jogos.push({ id: doc.id, ...doc.data() });
    });
    jogos.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return dateB - dateA;
    });
    
    select.innerHTML = '';
    const bloqueioDiv = document.getElementById('bloqueioCadastro');
    
    if (jogos.length === 0) {
        select.innerHTML = '<option value="">-- Nenhuma competição em PREPARAÇÃO --</option>';
        if (bloqueioDiv) bloqueioDiv.style.display = 'block';
        document.getElementById('btnSalvarParticipante')?.setAttribute('disabled', 'disabled');
    } else {
        if (bloqueioDiv) bloqueioDiv.style.display = 'none';
        document.getElementById('btnSalvarParticipante')?.removeAttribute('disabled');
        
        for (const jogo of jogos) {
            const option = document.createElement('option');
            option.value = jogo.id;
            option.textContent = `🟡 ${jogo.nome} - ${jogo.totalParticipantes || 0} participantes (R$ ${jogo.valorInscricao || 20})`;
            select.appendChild(option);
        }
    }
}

async function carregarSelectCompeticaoLista() {
    const select = document.getElementById('selectCompeticaoLista');
    if (!select) return;
    
    const jogosRef = collection(db, 'jogos');
    const querySnapshot = await getDocs(jogosRef);
    
    const jogos = [];
    querySnapshot.forEach(doc => {
        jogos.push({ id: doc.id, ...doc.data() });
    });
    jogos.sort((a, b) => {
        const ordem = { 'aberto': 1, 'preparando': 2, 'encerrado': 3 };
        return (ordem[a.status] || 99) - (ordem[b.status] || 99);
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
            const dataCadastro = p.dataCadastro?.toDate?.()?.toLocaleString('pt-BR') || '-';
            tr.innerHTML = `
                <td><strong>${p.nome}</strong></td>
                <td style="font-size:11px;">${p.numeros?.join(', ') || '-'}</td>
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
        
        console.log('🗑️ Limpando sorteios antigos...');
        const sorteiosRef = collection(db, 'sorteios_quina');
        const sorteiosQuery = query(sorteiosRef, where('competicaoId', '==', selectedId));
        const sorteiosSnapshot = await getDocs(sorteiosQuery);
        const batchSorteios = writeBatch(db);
        sorteiosSnapshot.forEach(docSnap => {
            batchSorteios.delete(docSnap.ref);
        });
        await batchSorteios.commit();
        
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
            dataInicio: dataAtivacao,
            ultimoConcursoImportado: null,
            ultimosNumerosSorteados: null,
            primeiraConferenciaRealizada: false
        });
        
        alert(`✅ Competição "${jogoDoc.data().nome}" ativada com SUCESSO!\n\n📌 Os acertos foram ZERADOS.\n📌 Os sorteios antigos foram REMOVIDOS.\n📌 A competição começará a contar APÓS ${dataAtivacao.toLocaleString()}\n📌 NÃO serão aceitos novos participantes.\n📌 Clique em OK para continuar.`);
        
        await carregarJogoAtivo();
        await carregarSelectCompeticoes();
        await carregarSelectCompeticoesCadastro();
        await carregarSelectCompeticaoLista();
        await carregarRanking();
        await atualizarStatusGame();
        await verificarBloqueio();
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
// SORTEIOS - FUNÇÃO CORRIGIDA (NÃO PULA CONCURSOS)
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
    }, 2000);
    
    intervaloBusca = setInterval(async () => {
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        const jogoDoc = await getDoc(jogoRef);
        const temSorteio = jogoDoc.data()?.ultimoConcursoImportado !== null;
        const intervalo = temSorteio ? 300000 : 60000;
        
        clearInterval(intervaloBusca);
        intervaloBusca = setInterval(async () => {
            const agora = new Date();
            const hora = agora.getHours();
            const isHorarioBusca = (hora >= 20) || (hora === 0 && agora.getMinutes() <= 30);
            
            if (jogoAtualId && jogoAtualStatus === 'aberto' && isHorarioBusca) {
                await buscarSorteioQuina();
            }
        }, intervalo);
    }, 1000);
}

// ============================================
// 🔥 FUNÇÃO CORRIGIDA - buscarSorteioQuina (NÃO PULA CONCURSOS)
// ============================================
async function buscarSorteioQuina() {
    console.log('🔍 INICIANDO BUSCA DE SORTEIO (versão definitiva)');
    if (!jogoAtualId || jogoAtualStatus !== 'aberto') {
        console.log('⚠️ Sem competição ativa');
        return;
    }
    
    const btn = document.getElementById('btnBuscarSorteio');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando...'; }
    
    try {
        // 1. Buscar último sorteio disponível na API
        console.log('📡 Buscando último sorteio disponível na API...');
        const resultado = await buscarSorteioMultiplasAPIs();
        
        if (!resultado || !resultado.numeros || resultado.numeros.length === 0) {
            throw new Error('Nenhum sorteio encontrado na API');
        }
        
        const { numeros, concurso, data } = resultado;
        
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        const jogoDoc = await getDoc(jogoRef);
        const jogoData = jogoDoc.data();
        const ultimoImportado = jogoData.ultimoConcursoImportado || 0;
        
        console.log(`🔍 ANÁLISE: Último importado = ${ultimoImportado} | Encontrado = ${concurso}`);
        
        // 2. Se já está atualizado
        if (concurso <= ultimoImportado) {
            console.log(`✅ O sistema está atualizado. Último sorteio: ${ultimoImportado}`);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📢 Buscar Último Sorteio da Quina';
            }
            return;
        }
        
        // 3. 🔥 VERIFICAR SE HÁ CONCURSOS INTERMEDIÁRIOS FALTANDO
        const concursosFaltando = [];
        for (let c = ultimoImportado + 1; c < concurso; c++) {
            // Verificar se já existe no Firestore
            const sorteiosRef = collection(db, 'sorteios_quina');
            const q = query(sorteiosRef, where('concurso', '==', c));
            const snapshot = await getDocs(q);
            if (snapshot.empty) {
                concursosFaltando.push(c);
            }
        }
        
        if (concursosFaltando.length > 0) {
            console.log(`⚠️ ATENÇÃO: ${concursosFaltando.length} concursos intermediários faltando!`);
            console.log(`📋 Concursos faltando: ${concursosFaltando.join(', ')}`);
            
            // Importar concursos intermediários
            for (const c of concursosFaltando) {
                console.log(`📥 Importando concurso intermediário #${c}...`);
                const dadosConcurso = await buscarConcursoPorNumero(c);
                if (dadosConcurso) {
                    const dataSorteio = new Date();
                    if (dadosConcurso.data) {
                        const partes = dadosConcurso.data.split('/');
                        if (partes.length === 3) {
                            dataSorteio.setFullYear(partes[2], partes[1] - 1, partes[0]);
                        }
                    }
                    
                    await addDoc(collection(db, 'sorteios_quina'), {
                        concurso: dadosConcurso.concurso,
                        numeros: dadosConcurso.numeros,
                        data: dataSorteio,
                        importadoEm: new Date(),
                        competicaoId: jogoAtualId
                    });
                    console.log(`✅ Concurso #${c} importado!`);
                } else {
                    console.log(`❌ Concurso #${c} não encontrado na API (pode não ter ocorrido ainda)`);
                }
            }
        }
        
        // 4. Se o concurso atual já foi importado nos passos acima, pular
        const sorteiosRef = collection(db, 'sorteios_quina');
        const qCheck = query(sorteiosRef, where('concurso', '==', concurso));
        const checkSnapshot = await getDocs(qCheck);
        if (!checkSnapshot.empty) {
            console.log(`✅ Concurso #${concurso} já foi importado (via intermediários)`);
            // Atualizar último concurso importado no jogo
            await updateDoc(jogoRef, {
                ultimoConcursoImportado: concurso
            });
            await atualizarAcertosParticipantes();
            await carregarRanking();
            await carregarHistoricoSorteios();
            await carregarNumerosSorteadosAdmin();
            await atualizarStatusGame();
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📢 Buscar Último Sorteio da Quina';
            }
            alert(`✅ Sorteios intermediários importados! Último: ${concurso}`);
            return;
        }
        
        // 5. Importar o concurso atual
        console.log(`🎉 IMPORTANDO CONCURSO #${concurso}: ${numeros.join(', ')}`);
        
        let dataSorteioObj = new Date();
        if (data) {
            const partes = data.split('/');
            if (partes.length === 3) {
                dataSorteioObj = new Date(partes[2], partes[1] - 1, partes[0]);
            }
        }
        
        // Primeira conferência - bloquear novos cadastros
        if (!jogoData.primeiraConferenciaRealizada) {
            console.log('🔒 PRIMEIRA CONFERÊNCIA - Bloqueando novos cadastros');
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
        
        console.log(`✅ Sorteio #${concurso} salvo no Firestore!`);
        
        // 6. Recalcular acertos
        await atualizarAcertosParticipantes();
        
        console.log(`✅ Sorteio #${concurso} IMPORTADO COM SUCESSO!`);
        
        await carregarRanking();
        await carregarHistoricoSorteios();
        await carregarNumerosSorteadosAdmin();
        await atualizarStatusGame();
        
        sorteioEncontradoHoje = true;
        
        const msgConcsFaltando = concursosFaltando.length > 0 ? `\n⚠️ ${concursosFaltando.length} concursos intermediários também foram importados.` : '';
        alert(`✅ SORTEIO ${concurso} IMPORTADO! Números: ${numeros.join(', ')}${msgConcsFaltando}`);
        
    } catch (error) {
        console.error('❌ ERRO AO BUSCAR SORTEIO:', error.message);
        if (btn) alert('Erro ao buscar sorteio: ' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📢 Buscar Último Sorteio da Quina'; }
    }
}

async function buscarSorteioMultiplasAPIs() {
    console.log('🔍 INICIANDO BUSCA POR SORTEIOS...');
    
    const ultimoConhecido = jogoAtualId ? (await getDoc(doc(db, 'jogos', jogoAtualId))).data()?.ultimoConcursoImportado : 0;
    console.log(`📌 Último concurso importado: ${ultimoConhecido}`);
    
    for (const api of QUINA_APIS) {
        try {
            console.log(`📡 Tentando API: ${api}`);
            const response = await fetch(api);
            if (!response.ok) {
                console.log(`⚠️ API ${api} retornou status ${response.status}`);
                continue;
            }
            const dados = await response.json();
            console.log(`📊 Dados recebidos de ${api}:`, dados);
            
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
                console.log(`✅ SUCESSO NA API: ${api}`);
                console.log(`🎲 CONCURSO ENCONTRADO: #${concurso}`);
                console.log(`📊 Números: ${numeros.join(', ')}`);
                console.log(`📅 Data: ${data || 'Não informada'}`);
                console.log(`🔍 COMPARAÇÃO: Último importado = ${ultimoConhecido} | Encontrado = ${concurso}`);
                
                if (concurso > ultimoConhecido) {
                    console.log(`🎉 NOVO SORTEIO DETECTADO! (${concurso} > ${ultimoConhecido})`);
                } else {
                    console.log(`⏸️ Sorteio ${concurso} já foi importado (${concurso} <= ${ultimoConhecido})`);
                }
                
                return { numeros, concurso, data };
            }
        } catch (error) {
            console.error(`❌ ERRO NA API ${api}:`, error.message);
        }
    }
    console.error('❌ TODAS AS APIs FALHARAM!');
    throw new Error('Todas as APIs falharam');
}

async function atualizarAcertosParticipantes() {
    console.log('🔄 RECALCULANDO ACERTOS DO ZERO...');
    
    if (!jogoAtualId) return;
    
    const sorteiosRef = collection(db, 'sorteios_quina');
    const sorteiosQuery = query(sorteiosRef, where('competicaoId', '==', jogoAtualId));
    const sorteiosSnapshot = await getDocs(sorteiosQuery);
    
    const numerosSorteadosSet = new Set();
    for (const sorteioDoc of sorteiosSnapshot.docs) {
        for (const num of sorteioDoc.data().numeros) {
            numerosSorteadosSet.add(num);
        }
    }
    
    const numerosSorteados = Array.from(numerosSorteadosSet).sort((a,b) => a-b);
    console.log(`📊 Números sorteados únicos (${numerosSorteados.length}):`, numerosSorteados);
    
    const participantesRef = collection(db, 'participantes');
    const participantesQuery = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const participantesSnapshot = await getDocs(participantesQuery);
    
    let vencedores = [];
    
    for (const participanteDoc of participantesSnapshot.docs) {
        const p = participanteDoc.data();
        if (p.acertouTodos) continue;
        
        let acertos = 0;
        const acertados = [];
        for (const num of p.numeros) {
            if (numerosSorteadosSet.has(num)) {
                acertos++;
                acertados.push(num);
            }
        }
        
        if (acertos !== (p.acertos || 0)) {
            await updateDoc(doc(db, 'participantes', participanteDoc.id), { acertos: acertos });
            console.log(`✏️ Atualizando ${p.nome}: ${p.acertos || 0} → ${acertos}`);
        }
        
        if (acertos >= 17) {
            vencedores.push({ id: participanteDoc.id, nome: p.nome, acertos: acertos });
        }
    }
    
    if (vencedores.length > 0) {
        await declararVencedores(vencedores);
    }
    
    await carregarRanking();
    console.log('✅ ========== FIM DA ATUALIZAÇÃO ==========');
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
    msg += '\n📊 Veja o ranking completo na tela!';
    alert(msg);
    
    await carregarRanking();
    await atualizarStatusGame();
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

// ============================================
// ATUALIZAÇÃO AUTOMÁTICA DO RANKING (TEMPO REAL)
// ============================================

function iniciarEscutaRanking() {
    if (!jogoAtualId) {
        console.log('⏸️ Escuta do ranking desativada (sem jogo ativo)');
        return;
    }
    
    console.log('📡 Iniciando escuta em tempo real do ranking...');
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    
    const unsubscribeParticipantes = onSnapshot(q, (snapshot) => {
        console.log('🔄 Mudança detectada nos participantes - atualizando ranking...');
        carregarRanking();
    }, (error) => {
        console.error('❌ Erro na escuta do ranking:', error);
    });
    
    const sorteiosRef = collection(db, 'sorteios_quina');
    const qSorteios = query(sorteiosRef, where('competicaoId', '==', jogoAtualId));
    
    const unsubscribeSorteios = onSnapshot(qSorteios, (snapshot) => {
        console.log('🔄 Mudança detectada nos sorteios - atualizando ranking...');
        carregarRanking();
    }, (error) => {
        console.error('❌ Erro na escuta dos sorteios:', error);
    });
    
    return () => {
        unsubscribeParticipantes();
        unsubscribeSorteios();
    };
}

// ============================================
// VERIFICAR E ATUALIZAR PARA O MAIOR CONCURSO DISPONÍVEL
// ============================================
async function verificarMaiorConcurso() {
    console.log('🔍 Verificando se há concurso mais recente...');
    
    if (!jogoAtualId) {
        console.log('⚠️ Sem jogo ativo');
        return;
    }
    
    try {
        const sorteiosRef = collection(db, 'sorteios_quina');
        const querySnapshot = await getDocs(sorteiosRef);
        
        if (querySnapshot.empty) {
            console.log('📌 Nenhum sorteio encontrado no Firestore');
            return;
        }
        
        const sorteios = [];
        querySnapshot.forEach(doc => {
            sorteios.push({ id: doc.id, ...doc.data() });
        });
        sorteios.sort((a, b) => (b.concurso || 0) - (a.concurso || 0));
        
        const maior = sorteios[0];
        const maiorConcurso = maior.concurso;
        const maiorNumeros = maior.numeros;
        
        console.log(`📌 Maior concurso no Firestore: ${maiorConcurso}`);
        
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        const jogoDoc = await getDoc(jogoRef);
        const jogoData = jogoDoc.data();
        const ultimoImportado = jogoData.ultimoConcursoImportado || 0;
        
        if (maiorConcurso > ultimoImportado) {
            console.log(`🎯 Atualizando jogo de ${ultimoImportado} para ${maiorConcurso}...`);
            await updateDoc(jogoRef, {
                ultimosNumerosSorteados: maiorNumeros,
                ultimoConcursoImportado: maiorConcurso
            });
            console.log(`✅ Jogo atualizado para ${maiorConcurso}!`);
            
            console.log('🔄 Recalculando acertos...');
            await atualizarAcertosParticipantes();
            console.log('✅ Acertos recalculados!');
        } else {
            console.log(`✅ Jogo já está atualizado com ${ultimoImportado}`);
        }
        
    } catch (error) {
        console.error('❌ Erro ao verificar maior concurso:', error.message);
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

// EXPORTAR FUNÇÕES PARA O CONSOLE
window.atualizarAcertosParticipantes = atualizarAcertosParticipantes;
window.carregarJogoAtivo = carregarJogoAtivo;
window.carregarRanking = carregarRanking;
window.carregarTodosParticipantes = carregarTodosParticipantes;
window.carregarHistoricoSorteios = carregarHistoricoSorteios;
window.carregarNumerosSorteadosAdmin = carregarNumerosSorteadosAdmin;
window.atualizarStatusGame = atualizarStatusGame;
window.carregarDados = carregarDados;
window.buscarSorteioQuina = buscarSorteioQuina;
window.fazerLogin = fazerLogin;
window.logout = logout;
window.diagnosticar = diagnosticar;
// Nova função exportada para console
window.importarConcursosIntermediarios = importarConcursosIntermediarios;
window.buscarConcursoPorNumero = buscarConcursoPorNumero;