// Estado para manter matérias minimizadas
let estadosMinimizados = JSON.parse(localStorage.getItem('editais_minimizados')) || {};

// Lista de planos (metas de estudo, ex: TRT, ENAM) carregada do servidor
let planosDisponiveis = [];
// Plano atualmente selecionado (aba ativa)
let planoAtual = localStorage.getItem('edital_plano_atual') || null;
// Itens do plano atual (cache usado para abrir os modais de edição)
let itensAtuais = [];
// Id do tópico em edição no modal
let idEmEdicao = null;

// Seleção em massa de tópicos no Edital (para migrar vários de uma vez para outro plano)
let modoSelecaoEdital = false;
let itensSelecionadosEdital = new Set();

// View ativa: "resumo", "edital" ou "estudos"
let viewAtual = 'resumo';

async function iniciar() {
    renderizarSeletorTema();
    configurarSeletorCorMateria();
    await carregarPlanos();
    await carregarEdital();
    await carregarTiposEstudo();
    restaurarCronometro();
    await carregarResumo(); // a view inicial é o Resumo
}

// ==================================================================
// LOGIN (Google) — cada usuário só vê os dados da própria conta, e o
// progresso de estudo passa a ficar salvo no perfil, não no aparelho.
// ==================================================================

let appJaIniciado = false;

// Intercepta toda chamada fetch da página: se o servidor responder 401
// (sessão ausente/expirada), mostra a tela de login em vez de deixar a
// função que chamou quebrar silenciosamente.
const fetchOriginal = window.fetch;
window.fetch = async function (...args) {
    const resposta = await fetchOriginal(...args);
    if (resposta.status === 401) {
        mostrarTelaLogin();
    }
    return resposta;
};

async function iniciarApp() {
    try {
        const res = await fetchOriginal('/api/auth/me');
        if (res.ok) {
            const dados = await res.json();
            mostrarUsuarioLogado(dados.usuario);
            esconderTelaLogin();
            if (!appJaIniciado) {
                appJaIniciado = true;
                await iniciar();
            }
            return;
        }
    } catch (err) {
        console.error('Erro ao verificar login:', err);
    }
    mostrarTelaLogin();
}

function mostrarUsuarioLogado(usuario) {
    const bloco = document.getElementById('sidebar-usuario');
    const nomeEl = document.getElementById('usuario-nome');
    const fotoEl = document.getElementById('usuario-foto');
    if (!bloco || !usuario) return;
    bloco.style.display = 'flex';
    if (nomeEl) nomeEl.textContent = usuario.nome || usuario.email || '';
    if (fotoEl) {
        if (usuario.foto) { fotoEl.src = usuario.foto; fotoEl.style.display = 'block'; }
        else fotoEl.style.display = 'none';
    }
}

let googleSignInIniciado = false;

async function mostrarTelaLogin() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'flex';

    if (googleSignInIniciado || typeof google === 'undefined' || !google.accounts) return;
    try {
        const res = await fetchOriginal('/api/auth/config');
        const config = await res.json();
        if (!config.googleClientId) {
            const erroEl = document.getElementById('login-erro');
            if (erroEl) {
                erroEl.textContent = 'Login com Google ainda não foi configurado neste servidor.';
                erroEl.style.display = 'block';
            }
            return;
        }
        google.accounts.id.initialize({
            client_id: config.googleClientId,
            callback: aoReceberCredencialGoogle
        });
        google.accounts.id.renderButton(
            document.getElementById('google-signin-btn'),
            { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' }
        );
        googleSignInIniciado = true;
    } catch (err) {
        console.error('Erro ao preparar login do Google:', err);
    }
}

function esconderTelaLogin() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function aoReceberCredencialGoogle(resposta) {
    const erroEl = document.getElementById('login-erro');
    try {
        const res = await fetchOriginal('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: resposta.credential })
        });
        const dados = await res.json();
        if (!dados.success) throw new Error(dados.error || 'Falha no login');
        if (erroEl) erroEl.style.display = 'none';
        await iniciarApp();
    } catch (err) {
        console.error('Erro ao entrar com Google:', err);
        if (erroEl) {
            erroEl.textContent = 'Não foi possível entrar. Tente novamente.';
            erroEl.style.display = 'block';
        }
    }
}

async function sairDaConta() {
    await fetchOriginal('/api/auth/logout', { method: 'POST' });
    appJaIniciado = false;
    location.reload();
}

// ==================================================================
// EXPORTAR / IMPORTAR EDITAL (modelo em JSON, reaproveitável por
// qualquer pessoa que queira montar o próprio edital)
// ==================================================================

function baixarArquivoJson(dados, nomeArquivo) {
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function baixarModeloEdital() {
    try {
        const res = await fetch('/api/edital/modelo');
        const dados = await res.json();
        baixarArquivoJson(dados, 'modelo-edital-checkestudos.json');
    } catch (err) {
        console.error('Erro ao baixar modelo de edital:', err);
        alert('Não foi possível baixar o modelo agora.');
    }
}

async function exportarEditalAtual() {
    try {
        const res = await fetch(`/api/edital/exportar?plano=${encodeURIComponent(planoAtual)}`);
        const dados = await res.json();
        baixarArquivoJson(dados, `edital-${planoAtual}.json`);
    } catch (err) {
        console.error('Erro ao exportar edital:', err);
        alert('Não foi possível exportar o edital agora.');
    }
}

async function importarArquivoEdital(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    try {
        const texto = await arquivo.text();
        const dados = JSON.parse(texto);

        const nomeSugerido = dados.nomeEdital || planoAtual;
        const plano = prompt('Importar para qual plano?', nomeSugerido);
        if (!plano) { event.target.value = ''; return; }

        const res = await fetch('/api/edital/importar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dados, plano: plano.trim() })
        });
        const resultado = await res.json();
        event.target.value = '';

        if (!resultado.success) {
            alert(resultado.error || 'Não foi possível importar o arquivo.');
            return;
        }

        alert(`Edital importado para "${resultado.plano}": ${resultado.criados} tópico(s) novo(s), ${resultado.vinculados} já existiam e foram vinculados.`);
        await carregarPlanos();
        await trocarPlano(resultado.plano);
    } catch (err) {
        console.error('Erro ao importar edital:', err);
        event.target.value = '';
        alert('Arquivo inválido. Baixe o modelo para ver o formato esperado.');
    }
}

// ==================================================================
// TEMA (cor de destaque + modo claro/escuro, salvo no dispositivo)
// ==================================================================

const TEMAS_DISPONIVEIS = [
    { id: '', nome: 'Azul (padrão)', cor: '#2563eb' },
    { id: 'verde-claro', nome: 'Verde', cor: '#059669' },
    { id: 'roxo-claro', nome: 'Roxo', cor: '#7c3aed' },
    { id: 'rosa-claro', nome: 'Rosa', cor: '#db2777' },
    { id: 'escuro-azul', nome: 'Dark azul', cor: '#3b82f6' },
    { id: 'escuro-verde', nome: 'Dark verde', cor: '#22c55e' },
    { id: 'escuro-rosa', nome: 'Dark rosa', cor: '#f472b6' }
];

function obterTemaSalvo() {
    try {
        return localStorage.getItem('checkestudos_tema') || '';
    } catch (err) {
        return '';
    }
}

function aplicarTema(temaId) {
    if (temaId) document.documentElement.setAttribute('data-tema', temaId);
    else document.documentElement.removeAttribute('data-tema');
    try { localStorage.setItem('checkestudos_tema', temaId); } catch (err) { /* segue sem salvar */ }
    renderizarSeletorTema();

    // Avisa o jogo (que roda num iframe à parte, com seu próprio CSS) para
    // trocar de tema também, caso já esteja carregado.
    const iframeJogo = document.getElementById('jogo-iframe');
    if (iframeJogo && iframeJogo.contentWindow) {
        iframeJogo.contentWindow.postMessage({ tipo: 'checkestudos-tema', tema: temaId }, window.location.origin);
    }
}

function renderizarSeletorTema() {
    const container = document.getElementById('tema-swatches');
    if (!container) return;
    const temaAtual = obterTemaSalvo();
    container.innerHTML = TEMAS_DISPONIVEIS.map(t => `
        <button type="button" class="tema-swatch ${temaAtual === t.id ? 'ativo' : ''}"
            style="background:${t.cor}" title="${t.nome}" onclick="aplicarTema('${t.id}')"></button>
    `).join('');
}

// --- PLANOS ---

async function carregarPlanos() {
    try {
        const res = await fetch('/api/planos');
        planosDisponiveis = await res.json();
    } catch (err) {
        console.error("Erro ao carregar planos:", err);
        planosDisponiveis = [];
    }

    if (planosDisponiveis.length === 0) {
        // Nenhum plano cadastrado ainda: cria o plano padrão "TRT"
        await fetch('/api/planos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: 'TRT' })
        });
        const res = await fetch('/api/planos');
        planosDisponiveis = await res.json();
    }

    const nomesPlanos = planosDisponiveis.map(p => p.nome);
    if (!planoAtual || !nomesPlanos.includes(planoAtual)) {
        planoAtual = nomesPlanos[0];
        localStorage.setItem('edital_plano_atual', planoAtual);
    }

    renderizarTabsPlanos();
    renderPlanosCheckboxes('planos-checkboxes-import', [planoAtual]);
    atualizarBarraSelecaoEdital();
}

function renderizarTabsPlanos() {
    const nav = document.getElementById('planos-tabs');
    if (!nav) return;
    nav.innerHTML = '';

    planosDisponiveis.forEach(plano => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'plano-tab' + (plano.nome === planoAtual ? ' ativo' : '');
        btn.textContent = plano.nome;
        btn.onclick = () => trocarPlano(plano.nome);
        nav.appendChild(btn);
    });

    const btnNovo = document.createElement('button');
    btnNovo.type = 'button';
    btnNovo.className = 'plano-tab plano-tab-novo';
    btnNovo.textContent = '+ Novo plano';
    btnNovo.onclick = criarPlano;
    nav.appendChild(btnNovo);
}

async function trocarPlano(nome) {
    if (nome === planoAtual) return;
    planoAtual = nome;
    localStorage.setItem('edital_plano_atual', planoAtual);
    modoSelecaoEdital = false;
    itensSelecionadosEdital.clear();
    atualizarBarraSelecaoEdital();
    renderizarTabsPlanos();
    renderPlanosCheckboxes('planos-checkboxes-import', [planoAtual]);
    await carregarEdital();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();
}

async function criarPlano() {
    const nome = prompt("Nome do novo plano de estudos (ex: ENAM):");
    if (!nome || !nome.trim()) return;

    const res = await fetch('/api/planos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim() })
    });
    const data = await res.json();
    if (data.success) {
        await carregarPlanos();
        await trocarPlano(data.plano.nome);
    }
}

// Renderiza um grupo de checkboxes com os planos disponíveis dentro do container informado
function renderPlanosCheckboxes(containerId, planosMarcados) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = planosDisponiveis.map(plano => `
        <label class="plano-checkbox">
            <input type="checkbox" value="${plano.nome}" ${planosMarcados.includes(plano.nome) ? 'checked' : ''}>
            ${plano.nome}
        </label>
    `).join('');
}

function lerPlanosMarcados(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
}

// --- TÓPICOS DO EDITAL ---

async function carregarEdital() {
    try {
        const res = await fetch(`/api/edital?plano=${encodeURIComponent(planoAtual)}`);
        const dados = await res.json();
        itensAtuais = dados;
        renderizar(dados);
    } catch (err) {
        console.error("Erro ao carregar edital:", err);
    }
}

function renderizar(itens) {
    const lista = document.getElementById('lista-edital');
    lista.innerHTML = '';

    // Agrupar itens por matéria
    const grupos = itens.reduce((acc, item) => {
        acc[item.materia] = acc[item.materia] || [];
        acc[item.materia].push(item);
        return acc;
    }, {});

    // Progresso Geral para o Header do App (apenas do plano selecionado)
    let totalGeral = itens.length;
    let concluidosGeral = itens.filter(i => i.concluido).length;

    for (const materia in grupos) {
        const estaMinimizado = estadosMinimizados[materia] || false;
        const totalMat = grupos[materia].length;
        const concluidosMat = grupos[materia].filter(i => i.concluido).length;

        // CÁLCULO DA PORCENTAGEM DA MATÉRIA
        const percMat = totalMat > 0 ? Math.round((concluidosMat / totalMat) * 100) : 0;

        const divMateria = document.createElement('div');
        divMateria.className = 'materia-group';

        divMateria.innerHTML = `
            <div class="materia-header" onclick="toggleMateria('${materia}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                <div class="materia-info">
                    <span class="seta">${estaMinimizado ? '▶' : '▼'}</span>
                    <strong class="materia-title">${materia}</strong>
                    <span class="stats-label">(${concluidosMat}/${totalMat}) - ${percMat}%</span>
                </div>
            </div>
            <div class="materia-content" style="display: ${estaMinimizado ? 'none' : 'block'}">
                ${grupos[materia].map(item => `
                    <div class="item-check ${item.concluido ? 'done' : ''} ${modoSelecaoEdital && itensSelecionadosEdital.has(item._id) ? 'selecionado' : ''}">
                        ${modoSelecaoEdital ? `
                            <input type="checkbox" class="checkbox-selecao-item" ${itensSelecionadosEdital.has(item._id) ? 'checked' : ''}
                                onchange="toggleSelecaoItemEdital('${item._id}', this.checked)">
                        ` : `
                            <input type="checkbox" ${item.concluido ? 'checked' : ''}
                                onchange="toggleCheck('${item._id}', this.checked)">
                        `}
                        <span class="topico-texto" onclick="${modoSelecaoEdital ? `toggleSelecaoItemEdital('${item._id}', !itensSelecionadosEdital.has('${item._id}'))` : `abrirModalEdicao('${item._id}')`}">
                            ${item.topico}
                            ${item.planos && item.planos.length > 1 ? `<span class="badge-compartilhado" title="Compartilhado entre: ${item.planos.join(', ')}">⇄ ${item.planos.join(' + ')}</span>` : ''}
                        </span>
                        ${modoSelecaoEdital ? '' : `
                            <div class="actions">
                                <button class="btn-edit" onclick="abrirModalEdicao('${item._id}')">✎</button>
                                <button class="btn-delete" onclick="deletarTopico('${item._id}')">🗑️</button>
                            </div>
                        `}
                    </div>
                `).join('')}
            </div>
        `;
        lista.appendChild(divMateria);
    }

    // Atualiza a Barra de Progresso Principal (do plano selecionado)
    const percGeral = totalGeral > 0 ? (concluidosGeral / totalGeral * 100).toFixed(1) : 0;
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) progressFill.style.width = `${percGeral}%`;

    const progressText = document.getElementById('progress-text');
    if (progressText) progressText.innerText = `${concluidosGeral}/${totalGeral} (${percGeral}%)`;
}

// --- FUNÇÕES DE INTERAÇÃO ---

async function toggleCheck(id, concluido) {
    // O tópico é um único documento, mesmo quando compartilhado entre planos,
    // então marcar/desmarcar aqui reflete automaticamente em todos os planos
    // que compartilham esse tópico.
    await fetch(`/api/edital/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concluido })
    });
    carregarEdital();
}

function abrirModalEdicao(id) {
    const item = itensAtuais.find(i => i._id === id);
    if (!item) return;

    idEmEdicao = id;
    document.getElementById('modal-materia-input').value = item.materia;
    document.getElementById('modal-topico-input').value = item.topico;
    renderPlanosCheckboxes('planos-checkboxes-modal', item.planos || []);
    document.getElementById('modal-overlay').style.display = 'flex';
}

function fecharModalEdicao() {
    idEmEdicao = null;
    document.getElementById('modal-overlay').style.display = 'none';
}

async function salvarEdicaoTopico() {
    if (!idEmEdicao) return;

    const materia = document.getElementById('modal-materia-input').value.trim();
    const topico = document.getElementById('modal-topico-input').value.trim();
    const planos = lerPlanosMarcados('planos-checkboxes-modal');

    if (!materia || !topico) return alert("Preencha matéria e tópico!");
    if (planos.length === 0) return alert("Selecione ao menos um plano para este tópico!");

    await fetch(`/api/edital/item/${idEmEdicao}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topico, materia, planos })
    });

    fecharModalEdicao();
    carregarEdital();
}

async function deletarTopico(id) {
    if (confirm("Deseja excluir este tópico? (Ele será removido de todos os planos aos quais pertence)")) {
        await fetch(`/api/edital/item/${id}`, { method: 'DELETE' });
        carregarEdital();
    }
}

function toggleMateria(materia) {
    estadosMinimizados[materia] = !estadosMinimizados[materia];
    localStorage.setItem('editais_minimizados', JSON.stringify(estadosMinimizados));
    carregarEdital();
}

// --- SELEÇÃO EM MASSA (migrar vários tópicos de uma vez para outro plano) ---

function alternarModoSelecaoEdital() {
    modoSelecaoEdital = !modoSelecaoEdital;
    if (!modoSelecaoEdital) itensSelecionadosEdital.clear();
    atualizarBarraSelecaoEdital();
    carregarEdital();
}

function cancelarSelecaoEdital() {
    modoSelecaoEdital = false;
    itensSelecionadosEdital.clear();
    atualizarBarraSelecaoEdital();
    carregarEdital();
}

function toggleSelecaoItemEdital(id, marcado) {
    if (marcado) itensSelecionadosEdital.add(id);
    else itensSelecionadosEdital.delete(id);
    atualizarBarraSelecaoEdital();
    carregarEdital();
}

function atualizarBarraSelecaoEdital() {
    const btnToggle = document.getElementById('btn-toggle-selecao-edital');
    const acoes = document.getElementById('edital-selecao-acoes');
    const contador = document.getElementById('edital-selecao-contador');
    const planosBox = document.getElementById('edital-selecao-planos');
    if (!btnToggle || !acoes) return;

    btnToggle.textContent = modoSelecaoEdital ? '✖ Sair da seleção' : '☑️ Selecionar vários';
    acoes.style.display = modoSelecaoEdital ? 'flex' : 'none';
    contador.textContent = `${itensSelecionadosEdital.size} selecionado(s)`;

    if (planosBox) {
        planosBox.innerHTML = planosDisponiveis.map(plano => `
            <button type="button" class="btn-secundario" onclick="adicionarSelecionadosAoPlano('${plano.nome.replace(/'/g, "\\'")}')">
                + Vincular ao ${plano.nome}
            </button>
        `).join('');
    }
}

// Vincula todos os tópicos selecionados também ao plano informado, sem
// remover os planos que eles já têm (ex: um monte de tópicos do TRT
// passam a valer para o ENAM também).
async function adicionarSelecionadosAoPlano(nomePlano) {
    if (itensSelecionadosEdital.size === 0) return;
    if (!confirm(`Vincular ${itensSelecionadosEdital.size} tópico(s) selecionado(s) também ao plano "${nomePlano}"?`)) return;

    await fetch('/api/edital/bulk-plano', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(itensSelecionadosEdital), plano: nomePlano })
    });

    modoSelecaoEdital = false;
    itensSelecionadosEdital.clear();
    atualizarBarraSelecaoEdital();
    await carregarEdital();
}

async function importarEdital() {
    const materia = document.getElementById('materia-input').value;
    const textoBruto = document.getElementById('bulk-input').value;
    let planos = lerPlanosMarcados('planos-checkboxes-import');

    if (!materia || !textoBruto) return alert("Preencha a matéria e os tópicos!");
    if (planos.length === 0) planos = [planoAtual];

    await fetch('/api/edital/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materia, textoBruto, planos })
    });

    document.getElementById('materia-input').value = '';
    document.getElementById('bulk-input').value = '';
    carregarEdital();
}

// ==================================================================
// NAVEGAÇÃO ENTRE SEÇÕES (Resumo / Edital / Estudos)
// ==================================================================

async function trocarView(nome) {
    viewAtual = nome;
    document.getElementById('view-resumo').style.display = nome === 'resumo' ? 'block' : 'none';
    document.getElementById('view-edital').style.display = nome === 'edital' ? 'block' : 'none';
    document.getElementById('view-estudos').style.display = nome === 'estudos' ? 'block' : 'none';
    document.getElementById('view-jogo').style.display = nome === 'jogo' ? 'block' : 'none';
    document.getElementById('tab-resumo').classList.toggle('ativo', nome === 'resumo');
    document.getElementById('tab-edital').classList.toggle('ativo', nome === 'edital');
    document.getElementById('tab-estudos').classList.toggle('ativo', nome === 'estudos');
    document.getElementById('tab-jogo').classList.toggle('ativo', nome === 'jogo');

    if (nome === 'resumo') await carregarResumo();
    if (nome === 'estudos') await carregarPainelEstudos();
    if (nome === 'jogo') { carregarJogo(); await carregarPontuacaoJogo(); }
}

// Carrega o iframe do jogo apenas na primeira visita à aba, evitando
// baixar Bootstrap/FontAwesome do "Estuda TRT" antes de serem necessários.
function carregarJogo() {
    const iframe = document.getElementById('jogo-iframe');
    if (iframe && !iframe.getAttribute('src')) {
        iframe.setAttribute('src', '/jogo/');
    }
}

// ==================================================================
// PONTUAÇÃO DO JOGO (persistida no banco, por sub-jogo, nunca zerada;
// e opção de registrar o desempenho de hoje como sessão de estudo)
// ==================================================================

const NOMES_JOGO_CHECKESTUDOS = { mnemonicos: 'Mnemônicos', competencias: 'Competências', lacunas: 'Lacunas' };

async function obterPontuacaoJogoPorTipo() {
    try {
        const res = await fetch('/jogo/api/pontuacao');
        return await res.json();
    } catch (err) {
        console.error('Erro ao carregar pontuação do jogo:', err);
        return {};
    }
}

async function carregarPontuacaoJogo() {
    const dados = await obterPontuacaoJogoPorTipo();
    const el = document.getElementById('jogo-pontuacao-resumo');
    if (!el) return;

    el.innerHTML = Object.keys(NOMES_JOGO_CHECKESTUDOS).map(tipo => {
        const d = dados[tipo] || { total: { acertos: 0, erros: 0 }, hoje: { acertos: 0, erros: 0 } };
        return `<div>${NOMES_JOGO_CHECKESTUDOS[tipo]}: ✅ ${d.total.acertos} / ❌ ${d.total.erros} total &middot; hoje: ✅ ${d.hoje.acertos} / ❌ ${d.hoje.erros}</div>`;
    }).join('');
}

// Abre o modal de finalizar sessão já com o tipo "Jogo" e o desempenho
// de HOJE (somado entre os 3 sub-jogos) preenchido, para o usuário só
// ajustar a duração e salvar.
async function registrarSessaoDoJogo() {
    if (tiposEstudoDisponiveis.length === 0) await carregarTiposEstudo();
    const tipoJogo = tiposEstudoDisponiveis.find(t => t.nome === 'Jogo');

    abrirModalSessao();

    if (tipoJogo) {
        tipoEstudoSelecionadoId = tipoJogo._id;
        renderizarChipsTipos();
        atualizarCampoExtra();
    }

    const dados = await obterPontuacaoJogoPorTipo();
    const acertosHoje = Object.values(dados).reduce((s, d) => s + (d.hoje?.acertos || 0), 0);
    const errosHoje = Object.values(dados).reduce((s, d) => s + (d.hoje?.erros || 0), 0);
    document.getElementById('sessao-acertos').value = acertosHoje || '';
    document.getElementById('sessao-erros').value = errosHoje || '';
    document.getElementById('sessao-observacoes').value = 'Sessão registrada a partir do jogo (Estuda TRT) — desempenho de hoje.';
    atualizarResultadoQuestoes();
}

// ==================================================================
// FORMATAÇÃO / UTILIDADES DE DATA E TEMPO
// ==================================================================

function formatarHMS(totalMs) {
    const totalSeg = Math.floor(totalMs / 1000);
    const h = String(Math.floor(totalSeg / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeg % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeg % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function formatarDuracaoCurta(segundos) {
    segundos = Math.round(segundos || 0);
    const h = Math.floor(segundos / 3600);
    const m = Math.round((segundos % 3600) / 60);
    if (h === 0) return `${m}min`;
    return `${h}h${String(m).padStart(2, '0')}min`;
}

// Segundos por página → texto legível ("1.2 min/página" ou "40s/página")
function formatarRitmo(segPorPagina) {
    if (segPorPagina >= 60) return `${(segPorPagina / 60).toFixed(1)} min/página`;
    return `${Math.round(segPorPagina)}s/página`;
}

// Data local no formato yyyy-mm-dd (evita problemas de fuso horário do toISOString)
function formatarDataISO(data) {
    const y = data.getFullYear();
    const m = String(data.getMonth() + 1).padStart(2, '0');
    const d = String(data.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ==================================================================
// CRONÔMETRO DE ESTUDO
// ==================================================================
// Estado persistido no localStorage para sobreviver a um F5 / fechar aba:
//   status: "parado" | "rodando" | "pausado"
//   inicioSegmentoAtual: epoch ms de quando o trecho atual começou a rodar (null se não estiver rodando)
//   acumuladoMs: soma dos trechos já rodados antes do segmento atual

const CRONOMETRO_KEY = 'cronometro_estado';
let cronometroEstado = { status: 'parado', inicioSegmentoAtual: null, acumuladoMs: 0 };
let cronometroIntervalId = null;

function salvarCronometroEstado() {
    localStorage.setItem(CRONOMETRO_KEY, JSON.stringify(cronometroEstado));
}

function restaurarCronometro() {
    try {
        const salvo = JSON.parse(localStorage.getItem(CRONOMETRO_KEY));
        if (salvo) cronometroEstado = salvo;
    } catch (err) { /* estado inválido, ignora */ }

    atualizarBotoesCronometro();
    atualizarDisplayCronometro();

    if (cronometroEstado.status === 'rodando') {
        iniciarIntervaloCronometro();
    }
}

function calcularElapsedMs() {
    let total = cronometroEstado.acumuladoMs;
    if (cronometroEstado.status === 'rodando' && cronometroEstado.inicioSegmentoAtual) {
        total += Date.now() - cronometroEstado.inicioSegmentoAtual;
    }
    return total;
}

function atualizarDisplayCronometro() {
    const display = document.getElementById('timer-display');
    if (display) display.textContent = formatarHMS(calcularElapsedMs());
}

function atualizarBotoesCronometro() {
    const btnIniciar = document.getElementById('btn-timer-iniciar');
    const btnPausar = document.getElementById('btn-timer-pausar');
    const btnRetomar = document.getElementById('btn-timer-retomar');
    const btnFinalizar = document.getElementById('btn-timer-finalizar');
    const label = document.getElementById('timer-status-label');
    const card = document.getElementById('timer-card');
    if (!btnIniciar) return;

    btnIniciar.style.display = cronometroEstado.status === 'parado' ? 'inline-flex' : 'none';
    btnPausar.style.display = cronometroEstado.status === 'rodando' ? 'inline-flex' : 'none';
    btnRetomar.style.display = cronometroEstado.status === 'pausado' ? 'inline-flex' : 'none';
    btnFinalizar.style.display = cronometroEstado.status === 'parado' ? 'none' : 'inline-flex';

    if (card) card.classList.toggle('timer-rodando', cronometroEstado.status === 'rodando');
    if (card) card.classList.toggle('timer-pausado', cronometroEstado.status === 'pausado');

    if (label) {
        label.textContent = cronometroEstado.status === 'rodando' ? 'Estudando agora...'
            : cronometroEstado.status === 'pausado' ? 'Pausado'
            : 'Pronto para começar';
    }
}

function iniciarIntervaloCronometro() {
    if (cronometroIntervalId) clearInterval(cronometroIntervalId);
    cronometroIntervalId = setInterval(atualizarDisplayCronometro, 1000);
}

function pararIntervaloCronometro() {
    if (cronometroIntervalId) clearInterval(cronometroIntervalId);
    cronometroIntervalId = null;
}

function iniciarCronometro() {
    cronometroEstado = { status: 'rodando', inicioSegmentoAtual: Date.now(), acumuladoMs: 0 };
    salvarCronometroEstado();
    atualizarBotoesCronometro();
    atualizarDisplayCronometro();
    iniciarIntervaloCronometro();
}

function pausarCronometro() {
    if (cronometroEstado.status !== 'rodando') return;
    cronometroEstado.acumuladoMs += Date.now() - cronometroEstado.inicioSegmentoAtual;
    cronometroEstado.inicioSegmentoAtual = null;
    cronometroEstado.status = 'pausado';
    salvarCronometroEstado();
    pararIntervaloCronometro();
    atualizarBotoesCronometro();
    atualizarDisplayCronometro();
}

function retomarCronometro() {
    if (cronometroEstado.status !== 'pausado') return;
    cronometroEstado.status = 'rodando';
    cronometroEstado.inicioSegmentoAtual = Date.now();
    salvarCronometroEstado();
    atualizarBotoesCronometro();
    iniciarIntervaloCronometro();
}

function resetarCronometro() {
    cronometroEstado = { status: 'parado', inicioSegmentoAtual: null, acumuladoMs: 0 };
    salvarCronometroEstado();
    pararIntervaloCronometro();
    atualizarBotoesCronometro();
    atualizarDisplayCronometro();
}

// ==================================================================
// TIPOS DE ESTUDO (simulado, resumo, leitura, etc. — editáveis)
// ==================================================================

let tiposEstudoDisponiveis = [];
let tipoEstudoSelecionadoId = null;

async function carregarTiposEstudo() {
    try {
        const res = await fetch('/api/tipos-estudo');
        tiposEstudoDisponiveis = await res.json();
    } catch (err) {
        console.error("Erro ao carregar tipos de estudo:", err);
        tiposEstudoDisponiveis = [];
    }
}

function renderizarChipsTipos() {
    const container = document.getElementById('tipos-estudo-chips');
    if (!container) return;
    container.innerHTML = tiposEstudoDisponiveis.map(tipo => `
        <button type="button" class="tipo-chip ${tipo._id === tipoEstudoSelecionadoId ? 'ativo' : ''}"
            onclick="selecionarTipoEstudo('${tipo._id}')">${tipo.nome}</button>
    `).join('');
}

function selecionarTipoEstudo(id) {
    tipoEstudoSelecionadoId = id;
    renderizarChipsTipos();
    atualizarCampoExtra();
}

function tipoEstudoAtual() {
    return tiposEstudoDisponiveis.find(t => t._id === tipoEstudoSelecionadoId);
}

function atualizarCampoExtra() {
    const tipo = tipoEstudoAtual();
    const campoQuestoes = document.getElementById('campo-extra-questoes');
    const campoPaginas = document.getElementById('campo-extra-paginas');
    campoQuestoes.style.display = tipo && tipo.campoExtra === 'questoes' ? 'block' : 'none';
    campoPaginas.style.display = tipo && tipo.campoExtra === 'paginas' ? 'block' : 'none';
    if (tipo && tipo.campoExtra === 'paginas') atualizarRitmoLeitura();
}

function atualizarResultadoQuestoes() {
    const acertos = parseInt(document.getElementById('sessao-acertos').value) || 0;
    const erros = parseInt(document.getElementById('sessao-erros').value) || 0;
    const total = acertos + erros;
    const resultado = document.getElementById('questoes-resultado');
    if (!resultado) return;
    resultado.textContent = total > 0 ? `${total} questões · ${Math.round((acertos / total) * 100)}% de acerto` : '—';
}

// Mostra o ritmo de leitura (tempo médio por página) em tempo real, enquanto o
// usuário preenche a duração e a quantidade de páginas lidas na sessão.
function atualizarRitmoLeitura() {
    const el = document.getElementById('ritmo-leitura');
    if (!el) return;
    const duracaoSegundos = obterDuracaoSegundosInputs();
    const paginas = parseInt(document.getElementById('sessao-paginas').value) || 0;
    if (duracaoSegundos <= 0 || paginas <= 0) {
        el.textContent = '';
        return;
    }
    el.textContent = `⏱ Ritmo desta sessão: ${formatarRitmo(duracaoSegundos / paginas)}`;
}

// --- Modal de gerenciamento de tipos de estudo ---

function abrirModalTipos() {
    renderizarListaTiposEstudo();
    document.getElementById('modal-tipos-overlay').style.display = 'flex';
}

function fecharModalTipos() {
    document.getElementById('modal-tipos-overlay').style.display = 'none';
}

function renderizarListaTiposEstudo() {
    const lista = document.getElementById('lista-tipos-estudo');
    if (!lista) return;
    lista.innerHTML = tiposEstudoDisponiveis.map(tipo => `
        <div class="tipo-estudo-linha">
            <input type="text" value="${tipo.nome}" onchange="renomearTipoEstudo('${tipo._id}', this.value)">
            <select onchange="alterarCampoExtraTipo('${tipo._id}', this.value)">
                <option value="nenhum" ${tipo.campoExtra === 'nenhum' ? 'selected' : ''}>Nenhum</option>
                <option value="questoes" ${tipo.campoExtra === 'questoes' ? 'selected' : ''}>Acertos/Erros</option>
                <option value="paginas" ${tipo.campoExtra === 'paginas' ? 'selected' : ''}>Páginas lidas</option>
            </select>
            <button class="btn-delete" onclick="excluirTipoEstudo('${tipo._id}')">🗑️</button>
        </div>
    `).join('');
}

async function criarTipoEstudo() {
    const nome = document.getElementById('novo-tipo-nome').value.trim();
    const campoExtra = document.getElementById('novo-tipo-campo-extra').value;
    if (!nome) return alert("Digite um nome para o novo tipo de estudo!");

    await fetch('/api/tipos-estudo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, campoExtra })
    });

    document.getElementById('novo-tipo-nome').value = '';
    await carregarTiposEstudo();
    renderizarListaTiposEstudo();
    renderizarChipsTipos();
}

async function renomearTipoEstudo(id, novoNome) {
    if (!novoNome.trim()) return;
    await fetch(`/api/tipos-estudo/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoNome.trim() })
    });
    await carregarTiposEstudo();
    renderizarChipsTipos();
}

async function alterarCampoExtraTipo(id, campoExtra) {
    await fetch(`/api/tipos-estudo/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campoExtra })
    });
    await carregarTiposEstudo();
    atualizarCampoExtra();
}

async function excluirTipoEstudo(id) {
    if (!confirm("Excluir este tipo de estudo? Sessões já registradas com ele serão mantidas no histórico.")) return;
    await fetch(`/api/tipos-estudo/${id}`, { method: 'DELETE' });
    if (tipoEstudoSelecionadoId === id) tipoEstudoSelecionadoId = null;
    await carregarTiposEstudo();
    renderizarListaTiposEstudo();
    renderizarChipsTipos();
}

// ==================================================================
// MODAL: CRIAR / EDITAR SESSÃO DE ESTUDO
// ==================================================================

let topicosSelecionadosSessao = new Set();
// Id da sessão em edição (null quando o modal está criando uma sessão nova)
let idSessaoEmEdicao = null;
// Tópicos da sessão em edição que não existem mais no edital do plano atual
// (matéria/tópico apagados ou desvinculados) — preservados ao salvar.
let topicosExtrasSessaoEmEdicao = [];

function obterDuracaoSegundosInputs() {
    const h = parseInt(document.getElementById('sessao-duracao-horas').value) || 0;
    const m = parseInt(document.getElementById('sessao-duracao-minutos').value) || 0;
    return h * 3600 + m * 60;
}

function construirFimAPartirDoInput() {
    const dataStr = document.getElementById('sessao-data').value; // yyyy-mm-dd
    const agora = new Date();
    if (!dataStr) return agora;
    const [y, m, d] = dataStr.split('-').map(Number);
    return new Date(y, m - 1, d, agora.getHours(), agora.getMinutes(), agora.getSeconds());
}

function abrirModalSessao() {
    // Congela o cronômetro enquanto o usuário preenche os detalhes da sessão
    if (cronometroEstado.status === 'rodando') pausarCronometro();

    idSessaoEmEdicao = null;
    topicosExtrasSessaoEmEdicao = [];
    document.getElementById('modal-sessao-titulo').textContent = 'Finalizar sessão de estudo';
    document.getElementById('btn-salvar-sessao').textContent = 'Salvar sessão';

    const elapsedMs = calcularElapsedMs();
    document.getElementById('sessao-duracao-horas').value = Math.floor(elapsedMs / 3600000);
    document.getElementById('sessao-duracao-minutos').value = Math.round((elapsedMs % 3600000) / 60000);
    document.getElementById('sessao-data').value = formatarDataISO(new Date());

    topicosSelecionadosSessao = new Set();
    tipoEstudoSelecionadoId = null;
    renderizarChipsTipos();
    atualizarCampoExtra();

    document.getElementById('sessao-acertos').value = '';
    document.getElementById('sessao-erros').value = '';
    document.getElementById('sessao-paginas').value = '';
    document.getElementById('sessao-observacoes').value = '';
    document.getElementById('sessao-busca-topicos').value = '';
    document.getElementById('sessao-revisao-check').checked = false;
    document.getElementById('sessao-revisao-dias').value = 7;
    document.getElementById('revisao-dias-row').style.display = 'none';
    atualizarResultadoQuestoes();
    atualizarRitmoLeitura();
    atualizarPreviewRevisao();

    renderizarTopicosSessao();

    document.getElementById('modal-sessao-overlay').style.display = 'flex';
}

// Abre o mesmo modal, mas pré-preenchido para editar uma sessão já registrada
// (usada pelo botão de editar no histórico de sessões).
function abrirModalEdicaoSessao(id) {
    const sessao = sessoesCache.find(s => s._id === id);
    if (!sessao) return;

    idSessaoEmEdicao = id;
    document.getElementById('modal-sessao-titulo').textContent = 'Editar sessão de estudo';
    document.getElementById('btn-salvar-sessao').textContent = 'Salvar alterações';

    const h = Math.floor(sessao.duracaoSegundos / 3600);
    const m = Math.round((sessao.duracaoSegundos % 3600) / 60);
    document.getElementById('sessao-duracao-horas').value = h;
    document.getElementById('sessao-duracao-minutos').value = m;
    document.getElementById('sessao-data').value = formatarDataISO(new Date(sessao.fim));

    const topicosDaSessao = sessao.topicos || [];
    topicosSelecionadosSessao = new Set(topicosDaSessao.map(t => t.topicoId));
    // Preserva tópicos que já não existem mais no edital atual, para não perdê-los ao salvar
    topicosExtrasSessaoEmEdicao = topicosDaSessao.filter(t => !itensAtuais.find(i => i._id === t.topicoId));

    tipoEstudoSelecionadoId = sessao.tipoEstudoId;
    renderizarChipsTipos();
    atualizarCampoExtra();

    document.getElementById('sessao-acertos').value = sessao.acertos ?? '';
    document.getElementById('sessao-erros').value = sessao.erros ?? '';
    document.getElementById('sessao-paginas').value = sessao.paginasLidas ?? '';
    document.getElementById('sessao-observacoes').value = sessao.observacoes || '';
    document.getElementById('sessao-busca-topicos').value = '';
    document.getElementById('sessao-revisao-check').checked = !!(sessao.revisao && sessao.revisao.agendada);
    document.getElementById('sessao-revisao-dias').value = (sessao.revisao && sessao.revisao.dias) || 7;

    atualizarResultadoQuestoes();
    atualizarRitmoLeitura();
    atualizarPreviewRevisao();

    renderizarTopicosSessao();

    document.getElementById('modal-sessao-overlay').style.display = 'flex';
}

function fecharModalSessao() {
    document.getElementById('modal-sessao-overlay').style.display = 'none';
}

function renderizarTopicosSessao(filtro) {
    const container = document.getElementById('sessao-topicos-lista');
    if (!container) return;

    const termo = (filtro || '').toLowerCase();
    const grupos = itensAtuais.reduce((acc, item) => {
        const combina = !termo || item.materia.toLowerCase().includes(termo) || item.topico.toLowerCase().includes(termo);
        if (!combina) return acc;
        acc[item.materia] = acc[item.materia] || [];
        acc[item.materia].push(item);
        return acc;
    }, {});

    const materias = Object.keys(grupos);
    let html = '';

    if (materias.length === 0 && topicosExtrasSessaoEmEdicao.length === 0) {
        html = `<div class="sessao-topicos-vazio">Nenhum tópico encontrado. Cadastre tópicos na aba Edital.</div>`;
    } else {
        html = materias.map(materia => `
            <div class="sessao-materia-grupo">
                <div class="sessao-materia-titulo">${materia}</div>
                ${grupos[materia].map(item => `
                    <label class="sessao-topico-item">
                        <input type="checkbox" value="${item._id}" ${topicosSelecionadosSessao.has(item._id) ? 'checked' : ''}
                            onchange="toggleTopicoSessao('${item._id}')">
                        ${item.topico}
                    </label>
                `).join('')}
            </div>
        `).join('');

        if (topicosExtrasSessaoEmEdicao.length > 0) {
            html += `
                <div class="sessao-materia-grupo">
                    <div class="sessao-materia-titulo">Outros (fora do edital atual)</div>
                    ${topicosExtrasSessaoEmEdicao.map(t => `
                        <label class="sessao-topico-item sessao-topico-item-fixo">
                            <input type="checkbox" checked disabled>
                            ${t.topico} <span class="sessao-topico-materia-extra">(${t.materia})</span>
                        </label>
                    `).join('')}
                </div>
            `;
        }
    }

    container.innerHTML = html;
}

function filtrarTopicosSessao() {
    renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
}

function toggleTopicoSessao(id) {
    if (topicosSelecionadosSessao.has(id)) topicosSelecionadosSessao.delete(id);
    else topicosSelecionadosSessao.add(id);
}

function atualizarPreviewRevisao() {
    const marcado = document.getElementById('sessao-revisao-check').checked;
    document.getElementById('revisao-dias-row').style.display = marcado ? 'flex' : 'none';
    if (!marcado) return;

    const dias = parseInt(document.getElementById('sessao-revisao-dias').value) || 7;
    const data = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
    document.getElementById('revisao-preview').textContent = `→ ${data.toLocaleDateString('pt-BR')}`;
}

async function salvarSessao() {
    if (!tipoEstudoSelecionadoId) return alert("Selecione o tipo de estudo!");
    const tipo = tipoEstudoAtual();
    if (!tipo) return alert("Tipo de estudo inválido — selecione novamente.");

    const duracaoSegundos = obterDuracaoSegundosInputs();
    if (duracaoSegundos <= 0) return alert("Informe a duração da sessão (horas e/ou minutos)!");

    const fim = construirFimAPartirDoInput();
    const inicio = new Date(fim.getTime() - duracaoSegundos * 1000);

    const topicos = itensAtuais
        .filter(i => topicosSelecionadosSessao.has(i._id))
        .map(i => ({ topicoId: i._id, materia: i.materia, topico: i.topico }));
    topicosExtrasSessaoEmEdicao.forEach(t => {
        if (!topicos.find(x => x.topicoId === t.topicoId)) topicos.push(t);
    });

    const revisaoMarcada = document.getElementById('sessao-revisao-check').checked;
    const revisaoDias = parseInt(document.getElementById('sessao-revisao-dias').value) || 7;

    const corpo = {
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        duracaoSegundos,
        plano: planoAtual,
        tipoEstudoId: tipo._id,
        tipoEstudoNome: tipo.nome,
        topicos,
        acertos: tipo.campoExtra === 'questoes' ? document.getElementById('sessao-acertos').value : null,
        erros: tipo.campoExtra === 'questoes' ? document.getElementById('sessao-erros').value : null,
        paginasLidas: tipo.campoExtra === 'paginas' ? document.getElementById('sessao-paginas').value : null,
        observacoes: document.getElementById('sessao-observacoes').value,
        revisao: { agendada: revisaoMarcada, dias: revisaoDias }
    };

    if (idSessaoEmEdicao) {
        await fetch(`/api/sessoes/${idSessaoEmEdicao}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo)
        });
    } else {
        await fetch('/api/sessoes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo)
        });
    }

    const eraNova = !idSessaoEmEdicao;
    fecharModalSessao();
    idSessaoEmEdicao = null;
    if (eraNova) resetarCronometro();

    await atualizarStreak();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();
}

// ==================================================================
// PAINEL "ESTUDOS": REVISÕES E HISTÓRICO
// ==================================================================

let sessoesCache = []; // sessões do plano atualmente selecionado

async function carregarSessoesPlanoAtual() {
    try {
        const res = await fetch(`/api/sessoes?plano=${encodeURIComponent(planoAtual)}&limite=1000`);
        sessoesCache = await res.json();
    } catch (err) {
        console.error("Erro ao carregar sessões:", err);
        sessoesCache = [];
    }
}

async function carregarPainelEstudos() {
    await carregarSessoesPlanoAtual();
    renderizarHistorico();
    await carregarRevisoes();
}

function renderizarHistorico() {
    const lista = document.getElementById('lista-historico');
    if (!lista) return;

    if (sessoesCache.length === 0) {
        lista.innerHTML = `<div class="lista-vazia">Nenhuma sessão registrada ainda neste plano. Inicie o cronômetro para começar!</div>`;
        return;
    }

    lista.innerHTML = sessoesCache.slice(0, 40).map(s => {
        const data = new Date(s.fim);
        const topicosTexto = s.topicos && s.topicos.length > 0
            ? s.topicos.map(t => t.topico).join(', ')
            : 'Sem tópicos vinculados';
        let desempenho = '';
        if (s.acertos !== null && s.acertos !== undefined) {
            desempenho = `<span class="historico-badge">✔️ ${s.acertos} / ❌ ${s.erros || 0}</span>`;
        } else if (s.paginasLidas !== null && s.paginasLidas !== undefined) {
            const ritmoTxt = (s.duracaoSegundos > 0 && s.paginasLidas > 0)
                ? ` · ${formatarRitmo(s.duracaoSegundos / s.paginasLidas)}`
                : '';
            desempenho = `<span class="historico-badge">📖 ${s.paginasLidas} pág.${ritmoTxt}</span>`;
        }

        return `
            <div class="historico-item">
                <div class="historico-item-topo">
                    <span class="historico-tipo">${s.tipoEstudoNome || 'Outro'}</span>
                    <span class="historico-duracao">${formatarDuracaoCurta(s.duracaoSegundos)}</span>
                    <span class="historico-data">${data.toLocaleDateString('pt-BR')}</span>
                    <div class="historico-item-acoes">
                        <button class="btn-edit historico-editar" onclick="abrirModalEdicaoSessao('${s._id}')">✎</button>
                        <button class="btn-delete historico-excluir" onclick="excluirSessao('${s._id}')">🗑️</button>
                    </div>
                </div>
                <div class="historico-topicos" title="${topicosTexto}">${topicosTexto}</div>
                ${desempenho}
                ${s.observacoes ? `<div class="historico-obs">"${s.observacoes}"</div>` : ''}
            </div>
        `;
    }).join('');
}

async function excluirSessao(id) {
    if (!confirm("Excluir esta sessão do histórico?")) return;
    await fetch(`/api/sessoes/${id}`, { method: 'DELETE' });
    await atualizarStreak();
    await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();
}

async function carregarRevisoes() {
    let revisoes = [];
    try {
        const res = await fetch(`/api/revisoes?plano=${encodeURIComponent(planoAtual)}`);
        revisoes = await res.json();
    } catch (err) {
        console.error("Erro ao carregar revisões:", err);
    }

    const lista = document.getElementById('lista-revisoes');
    if (!lista) return;

    if (revisoes.length === 0) {
        lista.innerHTML = `<div class="lista-vazia">Nenhuma revisão pendente. 🎉</div>`;
        return;
    }

    const hoje = new Date();
    lista.innerHTML = revisoes.map(r => {
        const dataRevisao = new Date(r.revisao.dataRevisao);
        const atrasada = dataRevisao < hoje;
        const topicosTexto = r.topicos && r.topicos.length > 0
            ? r.topicos.map(t => t.topico).join(', ')
            : 'Sem tópicos vinculados';

        return `
            <div class="revisao-card ${atrasada ? 'revisao-atrasada' : ''}">
                <div class="revisao-card-topo">
                    <span class="revisao-card-tipo">${r.tipoEstudoNome || 'Estudo'}</span>
                    <span class="revisao-card-data">${atrasada ? '⚠️ Atrasada — ' : ''}${dataRevisao.toLocaleDateString('pt-BR')}</span>
                </div>
                <div class="revisao-card-topicos" title="${topicosTexto}">${topicosTexto}</div>
                <button class="revisao-concluir-btn" onclick="concluirRevisao('${r._id}')">✔ Marcar como revisado</button>
            </div>
        `;
    }).join('');
}

async function concluirRevisao(id) {
    await fetch(`/api/revisoes/${id}/concluir`, { method: 'PUT' });
    await carregarRevisoes();
}

// ==================================================================
// RESUMO: DASHBOARD, GRÁFICO DE 30 DIAS, MATÉRIAS E OFENSIVA
// ==================================================================

let materiasCores = {};    // { "Português": "#2563eb", ... }
let materiaCorEmEdicao = null;
let sessoesTodasCache = []; // todas as sessões, de todos os planos (só para a ofensiva)

const PALETA_PADRAO_MATERIAS = [
    '#2563eb', '#7c3aed', '#22c55e', '#f59e0b', '#ef4444',
    '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#f97316'
];

const PALETA_PADRAO_TIPOS = [
    '#0891b2', '#db2777', '#65a30d', '#9333ea', '#ea580c',
    '#0d9488', '#4f46e5', '#ca8a04', '#dc2626', '#059669'
];

// Hash simples e estável (mesma string → sempre o mesmo índice), usado para
// dar uma cor padrão consistente a matérias/tipos que o usuário não personalizou.
function hashStringParaIndice(str, tamanhoPaleta) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % tamanhoPaleta;
}

function corDaMateria(materia) {
    if (materiasCores[materia]) return materiasCores[materia];
    return PALETA_PADRAO_MATERIAS[hashStringParaIndice(materia, PALETA_PADRAO_MATERIAS.length)];
}

function corDoTipo(tipoNome) {
    return PALETA_PADRAO_TIPOS[hashStringParaIndice(tipoNome || 'Outro', PALETA_PADRAO_TIPOS.length)];
}

// Divide a duração de uma sessão igualmente entre as matérias dos tópicos que
// ela tocou, para que a soma por matéria nunca ultrapasse o tempo realmente
// estudado (evita "inflar" o total ao empilhar várias matérias no gráfico).
function distribuirSegundosPorMateria(sessao) {
    const materias = Array.from(new Set((sessao.topicos || []).map(t => t.materia)));
    if (materias.length === 0) return {};
    const partes = sessao.duracaoSegundos / materias.length;
    const resultado = {};
    materias.forEach(m => { resultado[m] = partes; });
    return resultado;
}

async function carregarMateriasCores() {
    try {
        const res = await fetch('/api/materias-cor');
        const lista = await res.json();
        materiasCores = {};
        lista.forEach(m => { materiasCores[m.materia] = m.cor; });
    } catch (err) {
        console.error("Erro ao carregar cores das matérias:", err);
    }
}

function configurarSeletorCorMateria() {
    const input = document.getElementById('color-picker-oculto');
    if (!input) return;
    input.addEventListener('change', async (e) => {
        if (!materiaCorEmEdicao) return;
        const cor = e.target.value;
        materiasCores[materiaCorEmEdicao] = cor;
        renderizarIndicadoresMaterias();
        await fetch('/api/materias-cor', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ materia: materiaCorEmEdicao, cor })
        });
    });
}

function abrirSeletorCorMateria(materia) {
    materiaCorEmEdicao = materia;
    const input = document.getElementById('color-picker-oculto');
    input.value = materiasCores[materia] || '#2563eb';
    input.click();
}

async function carregarResumo() {
    await Promise.all([carregarSessoesPlanoAtual(), carregarMateriasCores(), atualizarStreak()]);
    renderizarDashboardResumo();
    renderizarGraficoTrintaDias();
    renderizarGraficoMateriasEmpilhado();
    renderizarGraficoTiposEmpilhado();
    renderizarIndicadoresMaterias();
}

function renderizarDashboardResumo() {
    const grid = document.getElementById('dashboard-grid');
    if (!grid) return;

    let totalSegundos = 0;
    let totalPaginas = 0;
    let totalSegundosLeitura = 0;
    let totalPaginasLeitura = 0;
    let totalQuestoes = 0;
    let totalAcertos = 0;
    const diasComEstudo = new Set();

    sessoesCache.forEach(s => {
        totalSegundos += s.duracaoSegundos;
        if (s.duracaoSegundos > 0) diasComEstudo.add(formatarDataISO(new Date(s.fim)));

        if (s.paginasLidas !== null && s.paginasLidas !== undefined) {
            totalPaginas += s.paginasLidas;
            totalSegundosLeitura += s.duracaoSegundos;
            totalPaginasLeitura += s.paginasLidas;
        }
        if (s.acertos !== null && s.acertos !== undefined) {
            totalQuestoes += s.acertos + (s.erros || 0);
            totalAcertos += s.acertos;
        }
    });

    const mediaSegundosPorDia = diasComEstudo.size > 0 ? totalSegundos / diasComEstudo.size : 0;
    const ritmoLeitura = totalPaginasLeitura > 0 ? totalSegundosLeitura / totalPaginasLeitura : null;
    const percAcerto = totalQuestoes > 0 ? Math.round((totalAcertos / totalQuestoes) * 100) : null;

    grid.innerHTML = `
        <div class="stat-card">
            <span class="stat-card-label">Horas estudadas</span>
            <span class="stat-card-valor">${formatarDuracaoCurta(totalSegundos)}</span>
        </div>
        <div class="stat-card">
            <span class="stat-card-label">Média por dia</span>
            <span class="stat-card-valor">${formatarDuracaoCurta(mediaSegundosPorDia)}</span>
        </div>
        <div class="stat-card">
            <span class="stat-card-label">Páginas lidas</span>
            <span class="stat-card-valor">${totalPaginas}</span>
        </div>
        <div class="stat-card">
            <span class="stat-card-label">Questões resolvidas</span>
            <span class="stat-card-valor">${totalQuestoes}</span>
            ${percAcerto !== null ? `<span class="stat-card-extra">${percAcerto}% de acerto</span>` : ''}
        </div>
        ${ritmoLeitura !== null ? `
        <div class="stat-card stat-card-destaque">
            <span class="stat-card-label">Ritmo médio de leitura</span>
            <span class="stat-card-valor stat-card-valor-texto">${formatarRitmo(ritmoLeitura)}</span>
        </div>` : ''}
    `;
}

// Constrói os últimos 30 dias (do mais antigo ao mais recente) e o total de
// segundos estudados em cada um, a partir das sessões do plano atual.
function construirUltimosTrintaDias() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const dias = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(hoje.getTime() - i * 24 * 60 * 60 * 1000);
        dias.push({ data: d, iso: formatarDataISO(d), segundos: 0 });
    }

    const porDia = {};
    sessoesCache.forEach(s => {
        const iso = formatarDataISO(new Date(s.fim));
        porDia[iso] = (porDia[iso] || 0) + s.duracaoSegundos;
    });
    dias.forEach(dia => { dia.segundos = porDia[dia.iso] || 0; });

    return dias;
}

function renderizarGraficoTrintaDias() {
    const container = document.getElementById('chart-30-dias');
    const containerFoguinhos = document.getElementById('chart-30-dias-flames');
    if (!container) return;

    const dias = construirUltimosTrintaDias();
    const maxSegundos = Math.max(...dias.map(d => d.segundos), 1);
    const hojeIso = formatarDataISO(new Date());

    container.innerHTML = dias.map(dia => {
        const alturaPerc = dia.segundos > 0 ? Math.max(6, Math.round((dia.segundos / maxSegundos) * 100)) : 2;
        const label = dia.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const horasTexto = dia.segundos > 0 ? formatarDuracaoCurta(dia.segundos) : 'sem estudo';
        return `
            <div class="chart-bar-wrap" title="${label} — ${horasTexto}">
                <div class="chart-bar ${dia.iso === hojeIso ? 'chart-bar-hoje' : ''}" style="height:${alturaPerc}%"></div>
            </div>
        `;
    }).join('');

    // Foguinhos de ofensiva alinhados no "eixo x", um por dia: aceso nos dias
    // estudados, apagado nos dias sem sessão registrada.
    if (containerFoguinhos) {
        containerFoguinhos.innerHTML = dias.map(dia => {
            const label = dia.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            return `
                <div class="chart-flame-wrap" title="${label}${dia.segundos > 0 ? ' — estudado' : ''}">
                    <span class="chart-flame ${dia.segundos > 0 ? 'chart-flame-ativo' : ''}">🔥</span>
                </div>
            `;
        }).join('');
    }
}

// Gráfico de barras empilhadas: tempo estudado por dia, dividido por matéria
// (mesmas cores usadas nos indicadores "Tempo por matéria" abaixo).
function renderizarGraficoMateriasEmpilhado() {
    const container = document.getElementById('chart-materias-30-dias');
    if (!container) return;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const dias = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(hoje.getTime() - i * 24 * 60 * 60 * 1000);
        dias.push({ data: d, iso: formatarDataISO(d), porMateria: {}, total: 0 });
    }
    const porDiaIndex = {};
    dias.forEach(d => { porDiaIndex[d.iso] = d; });

    const materiasVistas = new Set();
    let temSemMateria = false;

    sessoesCache.forEach(s => {
        const iso = formatarDataISO(new Date(s.fim));
        const dia = porDiaIndex[iso];
        if (!dia) return;

        const partes = distribuirSegundosPorMateria(s);
        const materias = Object.keys(partes);
        if (materias.length === 0) {
            dia.porMateria['__sem_materia__'] = (dia.porMateria['__sem_materia__'] || 0) + s.duracaoSegundos;
            temSemMateria = true;
        } else {
            materias.forEach(m => {
                dia.porMateria[m] = (dia.porMateria[m] || 0) + partes[m];
                materiasVistas.add(m);
            });
        }
        dia.total += s.duracaoSegundos;
    });

    const maxTotal = Math.max(...dias.map(d => d.total), 1);
    const hojeIso = formatarDataISO(hoje);
    const ordemMaterias = Array.from(materiasVistas).sort();

    container.innerHTML = dias.map(dia => {
        const alturaBarraPerc = dia.total > 0 ? Math.max(6, Math.round((dia.total / maxTotal) * 100)) : 2;
        const label = dia.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const totalTexto = dia.total > 0 ? formatarDuracaoCurta(dia.total) : 'sem estudo';

        let segmentos = '';
        if (dia.total > 0) {
            const entradas = [...ordemMaterias, '__sem_materia__'].filter(m => dia.porMateria[m] > 0);
            segmentos = entradas.map(materia => {
                const seg = dia.porMateria[materia];
                const percSegmento = Math.round((seg / dia.total) * 1000) / 10;
                const cor = materia === '__sem_materia__' ? '#cbd5e1' : corDaMateria(materia);
                const nomeLabel = materia === '__sem_materia__' ? 'Sem matéria vinculada' : materia;
                return `<div class="chart-stack-seg" style="height:${percSegmento}%; background:${cor}" title="${nomeLabel}: ${formatarDuracaoCurta(seg)}"></div>`;
            }).join('');
        }

        return `
            <div class="chart-bar-wrap" title="${label} — ${totalTexto}">
                <div class="chart-stack ${dia.iso === hojeIso ? 'chart-stack-hoje' : ''}" style="height:${alturaBarraPerc}%">${segmentos}</div>
            </div>
        `;
    }).join('');

    const legenda = document.getElementById('legenda-materias-dia');
    if (legenda) {
        const itensLegenda = ordemMaterias.map(m => ({ nome: m, cor: corDaMateria(m) }));
        if (temSemMateria) itensLegenda.push({ nome: 'Sem matéria vinculada', cor: '#cbd5e1' });
        legenda.innerHTML = itensLegenda.length === 0
            ? `<span class="chart-legenda-vazia">Sem sessões com matéria nos últimos 30 dias.</span>`
            : itensLegenda.map(it => `
                <span class="chart-legenda-item">
                    <span class="chart-legenda-cor" style="background:${it.cor}"></span>${it.nome}
                </span>
            `).join('');
    }
}

// Gráfico de barras empilhadas: tempo estudado por dia, dividido por tipo de
// estudo (Simulado, Leitura, Exercício...). Cada tipo tem uma cor estável.
function renderizarGraficoTiposEmpilhado() {
    const container = document.getElementById('chart-tipos-30-dias');
    if (!container) return;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const dias = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(hoje.getTime() - i * 24 * 60 * 60 * 1000);
        dias.push({ data: d, iso: formatarDataISO(d), porTipo: {}, total: 0 });
    }
    const porDiaIndex = {};
    dias.forEach(d => { porDiaIndex[d.iso] = d; });

    const tiposVistos = new Set();

    sessoesCache.forEach(s => {
        const iso = formatarDataISO(new Date(s.fim));
        const dia = porDiaIndex[iso];
        if (!dia) return;

        const nomeTipo = s.tipoEstudoNome || 'Outro';
        dia.porTipo[nomeTipo] = (dia.porTipo[nomeTipo] || 0) + s.duracaoSegundos;
        dia.total += s.duracaoSegundos;
        tiposVistos.add(nomeTipo);
    });

    const maxTotal = Math.max(...dias.map(d => d.total), 1);
    const hojeIso = formatarDataISO(hoje);
    const ordemTipos = Array.from(tiposVistos).sort();

    container.innerHTML = dias.map(dia => {
        const alturaBarraPerc = dia.total > 0 ? Math.max(6, Math.round((dia.total / maxTotal) * 100)) : 2;
        const label = dia.data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const totalTexto = dia.total > 0 ? formatarDuracaoCurta(dia.total) : 'sem estudo';

        let segmentos = '';
        if (dia.total > 0) {
            segmentos = ordemTipos.filter(t => dia.porTipo[t] > 0).map(tipo => {
                const seg = dia.porTipo[tipo];
                const percSegmento = Math.round((seg / dia.total) * 1000) / 10;
                const cor = corDoTipo(tipo);
                return `<div class="chart-stack-seg" style="height:${percSegmento}%; background:${cor}" title="${tipo}: ${formatarDuracaoCurta(seg)}"></div>`;
            }).join('');
        }

        return `
            <div class="chart-bar-wrap" title="${label} — ${totalTexto}">
                <div class="chart-stack ${dia.iso === hojeIso ? 'chart-stack-hoje' : ''}" style="height:${alturaBarraPerc}%">${segmentos}</div>
            </div>
        `;
    }).join('');

    const legenda = document.getElementById('legenda-tipos-dia');
    if (legenda) {
        legenda.innerHTML = ordemTipos.length === 0
            ? `<span class="chart-legenda-vazia">Sem sessões nos últimos 30 dias.</span>`
            : ordemTipos.map(t => `
                <span class="chart-legenda-item">
                    <span class="chart-legenda-cor" style="background:${corDoTipo(t)}"></span>${t}
                </span>
            `).join('');
    }
}

// Divide a duração de cada sessão igualmente entre os TÓPICOS que ela
// tocou (não só a matéria), para mostrar o tempo por tópico dentro de
// cada matéria no Resumo.
function construirSegundosPorTopico() {
    const segundos = {}; // topicoId -> segundos
    const info = {}; // topicoId -> { topico, materia }
    sessoesCache.forEach(s => {
        const topicos = s.topicos || [];
        const idsUnicos = Array.from(new Set(topicos.map(t => t.topicoId)));
        if (idsUnicos.length === 0) return;
        const partes = s.duracaoSegundos / idsUnicos.length;
        idsUnicos.forEach(id => {
            segundos[id] = (segundos[id] || 0) + partes;
            if (!info[id]) {
                const t = topicos.find(tp => tp.topicoId === id);
                info[id] = { topico: t.topico, materia: t.materia };
            }
        });
    });
    return { segundos, info };
}

// Lista os tópicos de uma matéria com o tempo de cada um, combinando os
// tópicos ainda cadastrados no edital com tópicos já removidos mas que
// têm sessões de estudo registradas (para não perder o histórico deles).
function obterTopicosDaMateriaParaIndicador(materia, mapaSegundos, infoTopico) {
    const vistos = new Set();
    const lista = [];
    itensAtuais.filter(i => i.materia === materia).forEach(i => {
        vistos.add(i._id);
        lista.push({ topico: i.topico, segundos: mapaSegundos[i._id] || 0 });
    });
    Object.keys(infoTopico).forEach(id => {
        if (vistos.has(id) || infoTopico[id].materia !== materia) return;
        lista.push({ topico: `${infoTopico[id].topico} (removido do edital)`, segundos: mapaSegundos[id] || 0 });
    });
    return lista.sort((a, b) => b.segundos - a.segundos);
}

// Matérias com o detalhamento por tópico expandido no momento (estado só de tela)
let materiasExpandidasIndicador = new Set();

function alternarIndicadorMateria(materia) {
    if (materiasExpandidasIndicador.has(materia)) materiasExpandidasIndicador.delete(materia);
    else materiasExpandidasIndicador.add(materia);
    renderizarIndicadoresMaterias();
}

function renderizarIndicadoresMaterias() {
    const container = document.getElementById('materias-indicadores');
    if (!container) return;

    const segundosPorMateria = {};
    sessoesCache.forEach(s => {
        const partes = distribuirSegundosPorMateria(s);
        Object.entries(partes).forEach(([m, seg]) => {
            segundosPorMateria[m] = (segundosPorMateria[m] || 0) + seg;
        });
    });

    // Garante que matérias do edital sem tempo registrado ainda apareçam na lista
    const materiasEdital = new Set(itensAtuais.map(i => i.materia));
    materiasEdital.forEach(m => { if (!(m in segundosPorMateria)) segundosPorMateria[m] = 0; });

    const materiasOrdenadas = Object.entries(segundosPorMateria).sort((a, b) => b[1] - a[1]);

    if (materiasOrdenadas.length === 0) {
        container.innerHTML = `<div class="lista-vazia">Cadastre matérias no Edital para ver os indicadores aqui.</div>`;
        return;
    }

    const maxSegundos = Math.max(...materiasOrdenadas.map(([, s]) => s), 1);
    const { segundos: segundosPorTopico, info: infoTopico } = construirSegundosPorTopico();

    container.innerHTML = materiasOrdenadas.map(([materia, segundos]) => {
        const cor = corDaMateria(materia);
        const perc = Math.round((segundos / maxSegundos) * 100);
        const materiaEscapada = materia.replace(/'/g, "\\'");
        const expandida = materiasExpandidasIndicador.has(materia);
        const topicosDaMateria = expandida ? obterTopicosDaMateriaParaIndicador(materia, segundosPorTopico, infoTopico) : [];
        const maxSegundosTopico = Math.max(...topicosDaMateria.map(t => t.segundos), 1);

        return `
            <div class="materia-indicador">
                <button type="button" class="materia-cor-swatch" style="background:${cor}"
                    onclick="abrirSeletorCorMateria('${materiaEscapada}')" title="Trocar cor de ${materia}"></button>
                <div class="materia-indicador-corpo" onclick="alternarIndicadorMateria('${materiaEscapada}')" style="cursor:pointer;">
                    <div class="materia-indicador-topo">
                        <span class="materia-indicador-nome">
                            <span class="materia-indicador-seta">${expandida ? '▾' : '▸'}</span> ${materia}
                        </span>
                        <span class="materia-indicador-tempo">${segundos > 0 ? formatarDuracaoCurta(segundos) : '—'}</span>
                    </div>
                    <div class="materia-indicador-barra-fundo">
                        <div class="materia-indicador-barra" style="width:${perc}%; background:${cor}"></div>
                    </div>
                </div>
                ${expandida ? `
                    <div class="materia-indicador-topicos">
                        ${topicosDaMateria.length === 0 ? '<div class="lista-vazia-topicos">Nenhum tópico cadastrado nesta matéria.</div>' : topicosDaMateria.map(t => `
                            <div class="topico-indicador-linha">
                                <span class="topico-indicador-nome">${t.topico}</span>
                                <div class="topico-indicador-barra-fundo">
                                    <div class="topico-indicador-barra" style="width:${Math.round((t.segundos / maxSegundosTopico) * 100)}%; background:${cor}"></div>
                                </div>
                                <span class="topico-indicador-tempo">${t.segundos > 0 ? formatarDuracaoCurta(t.segundos) : '—'}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// --- Ofensiva (dias seguidos estudando, estilo Duolingo) ---
// Considera sessões de TODOS os planos: o hábito de estudar vale independente
// de qual meta (TRT, ENAM...) está sendo trabalhada no dia.

async function atualizarStreak() {
    try {
        const res = await fetch('/api/sessoes?limite=3000');
        sessoesTodasCache = await res.json();
    } catch (err) {
        console.error("Erro ao carregar sessões para a ofensiva:", err);
        sessoesTodasCache = [];
    }

    const datasEstudadas = new Set(
        sessoesTodasCache.filter(s => s.duracaoSegundos > 0).map(s => formatarDataISO(new Date(s.fim)))
    );
    const streak = calcularStreakAtual(datasEstudadas);

    const numeroEl = document.getElementById('streak-numero');
    const badgeEl = document.getElementById('streak-badge');
    if (numeroEl) numeroEl.textContent = streak;
    if (badgeEl) badgeEl.classList.toggle('streak-ativa', streak > 0);
}

function calcularStreakAtual(datasEstudadas) {
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);

    // Se ainda não estudou hoje, a ofensiva continua valendo pelo que foi
    // feito até ontem (só "quebra" se um dia inteiro passar sem estudo).
    if (!datasEstudadas.has(formatarDataISO(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
    }
    while (datasEstudadas.has(formatarDataISO(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

document.addEventListener('DOMContentLoaded', iniciarApp);
