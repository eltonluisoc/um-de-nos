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
let intervaloBusca = null;
let jogoBloqueado = false;

document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin carregado');
    document.getElementById('btnEntrarAdmin')?.addEventListener('click', verificarSenha);
    document.getElementById('senhaInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') verificarSenha();
    });
    document.getElementById('btnLogout')?.addEventListener('click', logout);
    document.getElementById('btnSalvarParametros')?.addEventListener('click', salvarParametros);
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
    btn.disabled = true;
    btn.textContent = '⏳ VERIFICANDO...';
    
    setTimeout(async () => {
        if (senha === SENHA_ADMIN) {
            loading.style.display = 'none';
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('adminContent').style.display = 'block';
            await carregarDados();
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
    inicializarEventos();
    await carregarJogoAtivo();
    if (jogoAtualId) {
        await carregarRanking();
        await carregarTodosParticipantes();
        await carregarParametros();
        await carregarHistoricoSorteios();
        await carregarNumerosSorteadosAdmin();
        await verificarBloqueio();
        await atualizarContadorParticipantes(); // NOVO
    }
    iniciarBuscaAutomatica();
    carregarTabs();
}

// NOVA FUNÇÃO: Atualizar contador de participantes
async function atualizarContadorParticipantes() {
    if (!jogoAtualId) return;
    
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoAtualId));
    const querySnapshot = await getDocs(q);
    const total = querySnapshot.size;
    
    const jogoRef = doc(db, 'jogos', jogoAtualId);
    await updateDoc(jogoRef, { totalParticipantes: total });
    
    // Atualizar display
    const statusDiv = document.getElementById('statusAdmin');
    if (statusDiv) {
        const html = statusDiv.innerHTML;
        if (html.includes('Participantes:')) {
            statusDiv.innerHTML = html.replace(/Participantes: \d+/, `Participantes: ${total}`);
        }
    }
    
    return total;
}

function inicializarEventos() {
    document.getElementById('btnSalvarParticipante')?.addEventListener('click', salvarParticipante);
    
    const btnBuscar = document.getElementById('btnBuscarSorteio');
    if (btnBuscar) {
        btnBuscar.onclick = () => buscarSorteioQuina();
    }
    
    document.getElementById('btnEncerrarJogo')?.addEventListener('click', encerrarJogo);
    document.getElementById('btnNovoJogo')?.addEventListener('click', iniciarNovoJogo);
    document.getElementById('btnResetarTudo')?.addEventListener('click', resetarTudo);
    
    criarGridNumeros();
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
        });
    });
}

async function carregarJogoAtivo() {
    const jogosRef = collection(db, 'jogos');
    const q = query(jogosRef, where('status', '==', 'aberto'), limit(1));
    
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const jogoDoc = querySnapshot.docs[0];
        jogoAtualId = jogoDoc.id;
        const jogoData = jogoDoc.data();
        
        // Buscar número real de participantes
        const participantesRef = collection(db, 'participantes');
        const partQ = query(participantesRef, where('jogoId', '==', jogoAtualId));
        const partSnapshot = await getDocs(partQ);
        const totalParticipantesReal = partSnapshot.size;
        
        const statusDiv = document.getElementById('statusAdmin');
        statusDiv.innerHTML = `
            <p>✅ Jogo ativo: ${jogoData.nome || 'Edição atual'}</p>
            <p>📅 Criado em: ${jogoData.createdAt?.toDate()?.toLocaleString('pt-BR') || 'Nova'}</p>
            <p>🎲 Último sorteio: ${jogoData.ultimoConcursoImportado || 'Nenhum ainda'}</p>
            <p>💰 Valor inscrição: R$ ${jogoData.valorInscricao || 50},00</p>
            <p>👥 Participantes: ${totalParticipantesReal}</p>
            <p>🔒 Competição iniciada: ${jogoData.primeiraConferenciaRealizada ? 'SIM (bloqueado para novos participantes)' : 'NÃO (cadastros abertos)'}</p>
        `;
        
        jogoBloqueado = jogoData.primeiraConferenciaRealizada || false;
        
    } else {
        await iniciarNovoJogo();
    }
}

async function verificarBloqueio() {
    const bloqueado = jogoBloqueado;
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
        alert('Nenhum jogo ativo!');
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
    await carregarJogoAtivo();
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
        const dataCadastro = p.dataCadastro?.toDate()?.toLocaleString('pt-BR') || '-';
        tr.innerHTML = `
            <td>${p.nome}</td>
            <td style="font-size:12px;">${p.numeros.join(', ')}</td>
            <td>${p.acertos || 0}/17</td>
            <td>${dataCadastro}</td>
            <td><button class="btn-danger" onclick="window.excluirParticipante('${docSnap.id}')">Excluir</button></td>
        `;
        tbody.appendChild(tr);
    }
}

async function carregarHistoricoSorteios() {
    const sorteiosRef = collection(db, 'sorteios_quina');
    const querySnapshot = await getDocs(sorteiosRef);
    
    const container = document.getElementById('historicoSorteios');
    if (querySnapshot.empty) {
        container.innerHTML = '<div>Nenhum sorteio importado ainda.</div>';
        return;
    }
    
    // Usar Map para evitar duplicatas por concurso
    const sorteiosMap = new Map();
    querySnapshot.forEach(doc => {
        const s = doc.data();
        if (!sorteiosMap.has(s.concurso)) {
            sorteiosMap.set(s.concurso, s);
        }
    });
    
    // Converter para array e ordenar
    const sorteios = Array.from(sorteiosMap.values());
    sorteios.sort((a, b) => b.concurso - a.concurso);
    
    let html = '<div style="display: flex; flex-wrap: wrap; gap: 10px;">';
    for (const s of sorteios) {
        html += `
            <div style="background: rgba(255,215,0,0.2); border-radius: 10px; padding: 10px;">
                <strong>#${s.concurso}</strong><br>
                ${s.numeros.join(', ')}<br>
                <small>${s.data?.toDate?.()?.toLocaleDateString('pt-BR') || '-'}</small>
            </div>
        `;
    }
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
    // 8 colunas x 10 linhas = 80 números
    let html = '<div style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px;">';
    for (let i = 1; i <= 80; i++) {
        const foiSorteado = numerosSorteados.includes(i);
        html += `
            <div style="background: ${foiSorteado ? '#ffd700' : 'rgba(255,255,255,0.2)'}; color: ${foiSorteado ? '#1a472a' : 'white'}; padding: 8px; text-align: center; border-radius: 8px; font-weight: bold;">
                ${i}
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
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
    if (jogoBloqueado) {
        alert('⚠️ Competição já iniciada! Não é possível adicionar novos participantes após a primeira conferência.');
        return;
    }
    
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
        
        await atualizarContadorParticipantes();
        
        alert('Participante cadastrado com sucesso!');
        
        document.getElementById('nomeParticipante').value = '';
        document.querySelectorAll('.numero-btn.selecionado').forEach(btn => {
            btn.classList.remove('selecionado');
        });
        numerosSelecionados = [];
        document.getElementById('contadorNumeros').innerHTML = '0/17 números selecionados';
        
        await carregarTodosParticipantes();
        await carregarRanking();
        await carregarParametros();
        await carregarJogoAtivo();
        
    } catch (error) {
        console.error('Erro ao salvar:', error);
        alert('Erro ao salvar participante: ' + error.message);
    }
}

function isHorarioSorteios() {
    const agora = new Date();
    const hora = agora.getHours();
    return (hora >= 20 && hora <= 23);
}

function iniciarBuscaAutomatica() {
    if (intervaloBusca) clearInterval(intervaloBusca);
    
    console.log('🔄 Busca automática configurada (a cada 5 min, apenas 20h-23h59)');
    
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

// FUNÇÃO BUSCAR SORTEIO CORRIGIDA - SEM DUPLICAÇÃO
async function buscarSorteioQuina() {
    console.log('🔍 Função buscarSorteioQuina iniciada');
    
    const btn = document.getElementById('btnBuscarSorteio');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Buscando...';
    }
    
    try {
        const jogosRef = collection(db, 'jogos');
        const q = query(jogosRef, where('status', '==', 'aberto'), limit(1));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            console.log('❌ Nenhum jogo ativo');
            return;
        }
        
        const jogoDoc = querySnapshot.docs[0];
        const jogoAtualIdTemp = jogoDoc.id;
        const jogoData = jogoDoc.data();
        
        if (jogoData.status !== 'aberto') return;
        
        const response = await fetch('https://loteriascaixa-api.herokuapp.com/api/quina/latest');
        const dados = await response.json();
        
        if (!dados || !dados.dezenas) throw new Error('Não foi possível obter os números');
        
        const numerosSorteados = dados.dezenas.map(Number);
        const concurso = dados.concurso;
        
        console.log(`🎲 Sorteio ${concurso}:`, numerosSorteados);
        
        // ✅ VERIFICAÇÃO MAIS RIGOROSA - Verificar se já existe no banco
        const sorteiosExistentes = await getDocs(collection(db, 'sorteios_quina'));
        let jaExiste = false;
        sorteiosExistentes.forEach(doc => {
            const s = doc.data();
            if (s.concurso === concurso) {
                jaExiste = true;
            }
        });
        
        if (jaExiste) {
            console.log(`⚠️ Sorteio ${concurso} JÁ EXISTE no banco! Não será duplicado.`);
            
            // Atualizar o jogo com o concurso existente
            await updateDoc(doc(db, 'jogos', jogoAtualIdTemp), {
                ultimosNumerosSorteados: numerosSorteados,
                ultimoConcursoImportado: concurso
            });
            
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📢 Buscar Último Sorteio da Quina';
            }
            return;
        }
        
        // Verificar se já importou pelo jogo
        if (jogoData.ultimoConcursoImportado === concurso) {
            console.log(`⚠️ Sorteio ${concurso} já foi importado neste jogo`);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📢 Buscar Último Sorteio da Quina';
            }
            return;
        }
        
        // PRIMEIRA CONFERÊNCIA
        if (!jogoData.primeiraConferenciaRealizada) {
            console.log('🔒 PRIMEIRA CONFERÊNCIA - Bloqueando novos cadastros');
            await updateDoc(doc(db, 'jogos', jogoAtualIdTemp), {
                primeiraConferenciaRealizada: true,
                dataPrimeiraConferencia: new Date()
            });
            jogoBloqueado = true;
            await verificarBloqueio();
        }
        
        // TRATAMENTO DE DATA CORRIGIDO
        let dataValida = new Date();
        if (dados.data) {
            if (dados.data.includes('/')) {
                const partes = dados.data.split('/');
                if (partes.length === 3) {
                    dataValida = new Date(partes[2], partes[1] - 1, partes[0]);
                }
            } else if (dados.data.includes('-')) {
                dataValida = new Date(dados.data);
            }
            
            if (isNaN(dataValida.getTime())) {
                console.warn('Data inválida, usando data atual');
                dataValida = new Date();
            }
        }
        console.log('📅 Data do sorteio:', dataValida.toLocaleDateString('pt-BR'));
        
        // ✅ SALVAR SORTEIO APENAS UMA VEZ (removida a segunda chamada)
        await addDoc(collection(db, 'sorteios_quina'), {
            concurso: concurso,
            numeros: numerosSorteados,
            data: dataValida,
            importadoEm: new Date()
        });
        
        // Atualizar o jogo
        await updateDoc(doc(db, 'jogos', jogoAtualIdTemp), {
            ultimosNumerosSorteados: numerosSorteados,
            ultimoConcursoImportado: concurso
        });
        
        await atualizarAcertosParticipantes(numerosSorteados, jogoAtualIdTemp);
        
        alert(`✅ Sorteio ${concurso} importado! Números: ${numerosSorteados.join(', ')}`);
        
        await carregarRanking();
        await carregarHistoricoSorteios();
        await carregarNumerosSorteadosAdmin();
        await carregarJogoAtivo();
        
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

async function atualizarAcertosParticipantes(novosNumeros, jogoId) {
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoId));
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
        await declararVencedores(vencedores, jogoId);
    }
    
    await carregarRanking();
}

async function declararVencedores(vencedores, jogoId) {
    const jogoRef = doc(db, 'jogos', jogoId);
    const jogoDoc = await getDoc(jogoRef);
    
    if (jogoDoc.data().status !== 'aberto') return;
    
    const jogoData = jogoDoc.data();
    const valorInscricao = jogoData.valorInscricao || 50;
    
    // Buscar todos participantes para calcular quem tem MENOS acertos
    const participantesRef = collection(db, 'participantes');
    const q = query(participantesRef, where('jogoId', '==', jogoId));
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
    const premio3 = premioTotal * 0.05; // Prêmio para quem acertou MENOS
    
    // Processar vencedores (1º e 2º lugar)
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
            jogoId: jogoId,
            participanteId: v.id,
            participanteNome: v.nome,
            posicao: i + 1,
            premio: premio,
            dataVitoria: new Date()
        });
    }
    
    // Prêmio para quem acertou MENOS números (3º lugar especial)
    if (perdedor && totalParticipantes >= 3) {
        await updateDoc(doc(db, 'participantes', perdedor.id), {
            premioMenosAcertos: premio3
        });
        
        await addDoc(collection(db, 'historico_vencedores'), {
            jogoId: jogoId,
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
    if (confirm('Tem certeza que deseja encerrar o jogo atual?')) {
        if (intervaloBusca) clearInterval(intervaloBusca);
        const jogoRef = doc(db, 'jogos', jogoAtualId);
        await updateDoc(jogoRef, { status: 'encerrado' });
        alert('Jogo encerrado!');
        await carregarJogoAtivo();
        iniciarBuscaAutomatica();
    }
}

async function iniciarNovoJogo() {
    const nomeJogo = prompt('Nome da competição:', `Um de Nós - ${new Date().toLocaleDateString('pt-BR')}`);
    if (nomeJogo) {
        if (intervaloBusca) clearInterval(intervaloBusca);
        
        const docRef = await addDoc(collection(db, 'jogos'), {
            nome: nomeJogo,
            status: 'aberto',
            createdAt: new Date(),
            ultimoConcursoImportado: null,
            ultimosNumerosSorteados: null,
            totalParticipantes: 0,
            valorInscricao: 50,
            primeiraConferenciaRealizada: false,
            dataPrimeiraConferencia: null
        });
        
        jogoAtualId = docRef.id;
        jogoBloqueado = false;
        
        alert('Nova competição criada!');
        await carregarJogoAtivo();
        await carregarRanking();
        await carregarTodosParticipantes();
        await verificarBloqueio();
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
    if (jogoBloqueado) {
        alert('⚠️ Competição já iniciada! Não é possível excluir participantes.');
        return;
    }
    
    if (confirm('Excluir este participante?')) {
        await deleteDoc(doc(db, 'participantes', id));
        await carregarTodosParticipantes();
        await carregarRanking();
        await atualizarContadorParticipantes();
        alert('Participante excluído!');
    }
};

window.verificarSenha = verificarSenha;
window.logout = logout;
window.buscarSorteioQuina = buscarSorteioQuina;