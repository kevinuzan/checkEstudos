// Estado para manter matérias minimizadas
let estadosMinimizados = JSON.parse(localStorage.getItem('editais_minimizados')) || {};

// Lista de planos (metas de estudo, ex: TRT, ENAM) carregada do servidor
let planosDisponiveis = [];
// Plano atualmente selecionado (aba ativa)
let planoAtual = localStorage.getItem('edital_plano_atual') || null;
// Itens do plano atual (cache usado para abrir o modal de edição)
let itensAtuais = [];
// Id do tópico em edição no modal
let idEmEdicao = null;

// View ativa: "edital" ou "estudos"
let viewAtual = 'edital';

async function iniciar() {
    await carregarPlanos();
    await carregarEdital();
    await carregarTiposEstudo();
    restaurarCronometro();
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
    renderizarTabsPlanos();
    renderPlanosCheckboxes('planos-checkboxes-import', [planoAtual]);
    await carregarEdital();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
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
                    <div class="item-check ${item.concluido ? 'done' : ''}">
                        <input type="checkbox" ${item.concluido ? 'checked' : ''}
                            onchange="toggleCheck('${item._id}', this.checked)">
                        <span class="topico-texto" onclick="abrirModalEdicao('${item._id}')">
                            ${item.topico}
                            ${item.planos && item.planos.length > 1 ? `<span class="badge-compartilhado" title="Compartilhado entre: ${item.planos.join(', ')}">⇄ ${item.planos.join(' + ')}</span>` : ''}
                        </span>
                        <div class="actions">
                            <button class="btn-edit" onclick="abrirModalEdicao('${item._id}')">✎</button>
                            <button class="btn-delete" onclick="deletarTopico('${item._id}')">🗑️</button>
                        </div>
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
// NAVEGAÇÃO ENTRE VIEWS (Edital / Painel de Estudos)
// ==================================================================

async function trocarView(nome) {
    viewAtual = nome;
    document.getElementById('view-edital').style.display = nome === 'edital' ? 'block' : 'none';
    document.getElementById('view-estudos').style.display = nome === 'estudos' ? 'block' : 'none';
    document.getElementById('tab-edital').classList.toggle('ativo', nome === 'edital');
    document.getElementById('tab-estudos').classList.toggle('ativo', nome === 'estudos');

    if (nome === 'estudos') await carregarPainelEstudos();
}

// ==================================================================
// CRONÔMETRO DE ESTUDO
// ==================================================================
// Estado persistido no localStorage para sobreviver a um F5 / fechar aba:
//   status: "parado" | "rodando" | "pausado"
//   inicioSegmentoAtual: epoch ms de quando o trecho atual começou a rodar (null se não estiver rodando)
//   acumuladoMs: soma dos trechos já rodados antes do segmento atual
//   inicioSessao: epoch ms do primeiro "Iniciar" da sessão (usado para salvar o campo "inicio")

const CRONOMETRO_KEY = 'cronometro_estado';
let cronometroEstado = { status: 'parado', inicioSegmentoAtual: null, acumuladoMs: 0, inicioSessao: null };
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

function formatarHMS(totalMs) {
    const totalSeg = Math.floor(totalMs / 1000);
    const h = String(Math.floor(totalSeg / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeg % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeg % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
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
    cronometroEstado = {
        status: 'rodando',
        inicioSegmentoAtual: Date.now(),
        acumuladoMs: 0,
        inicioSessao: Date.now()
    };
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
    cronometroEstado = { status: 'parado', inicioSegmentoAtual: null, acumuladoMs: 0, inicioSessao: null };
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
}

function atualizarResultadoQuestoes() {
    const acertos = parseInt(document.getElementById('sessao-acertos').value) || 0;
    const erros = parseInt(document.getElementById('sessao-erros').value) || 0;
    const total = acertos + erros;
    const resultado = document.getElementById('questoes-resultado');
    if (!resultado) return;
    resultado.textContent = total > 0 ? `${total} questões · ${Math.round((acertos / total) * 100)}% de acerto` : '—';
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
// MODAL: FINALIZAR SESSÃO DE ESTUDO
// ==================================================================

let topicosSelecionadosSessao = new Set();

function abrirModalSessao() {
    // Congela o cronômetro enquanto o usuário preenche os detalhes da sessão
    if (cronometroEstado.status === 'rodando') pausarCronometro();

    document.getElementById('sessao-duracao-valor').textContent = formatarHMS(calcularElapsedMs());

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
    if (materias.length === 0) {
        container.innerHTML = `<div class="sessao-topicos-vazio">Nenhum tópico encontrado. Cadastre tópicos na aba Edital.</div>`;
        return;
    }

    container.innerHTML = materias.map(materia => `
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
    const duracaoMs = calcularElapsedMs();
    const fim = new Date();
    const inicio = new Date(fim.getTime() - duracaoMs);

    const topicos = itensAtuais
        .filter(i => topicosSelecionadosSessao.has(i._id))
        .map(i => ({ topicoId: i._id, materia: i.materia, topico: i.topico }));

    const revisaoMarcada = document.getElementById('sessao-revisao-check').checked;
    const revisaoDias = parseInt(document.getElementById('sessao-revisao-dias').value) || 7;

    const corpo = {
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        duracaoSegundos: Math.floor(duracaoMs / 1000),
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

    await fetch('/api/sessoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
    });

    fecharModalSessao();
    resetarCronometro();

    if (viewAtual === 'estudos') await carregarPainelEstudos();
}

// ==================================================================
// PAINEL DE ESTUDOS: ESTATÍSTICAS, REVISÕES E HISTÓRICO
// ==================================================================

let sessoesCache = [];

function formatarDuracaoCurta(segundos) {
    const h = Math.floor(segundos / 3600);
    const m = Math.round((segundos % 3600) / 60);
    if (h === 0) return `${m}min`;
    return `${h}h${String(m).padStart(2, '0')}min`;
}

async function carregarPainelEstudos() {
    await Promise.all([carregarEstatisticas(), carregarRevisoes()]);
}

async function carregarEstatisticas() {
    try {
        const res = await fetch(`/api/sessoes?plano=${encodeURIComponent(planoAtual)}&limite=500`);
        sessoesCache = await res.json();
    } catch (err) {
        console.error("Erro ao carregar sessões:", err);
        sessoesCache = [];
    }

    const agora = new Date();
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const inicioSemana = new Date(inicioHoje.getTime() - agora.getDay() * 24 * 60 * 60 * 1000);

    let segundosHoje = 0, segundosSemana = 0, segundosTotal = 0;
    const porTipo = {};

    sessoesCache.forEach(s => {
        const dataFim = new Date(s.fim);
        segundosTotal += s.duracaoSegundos;
        if (dataFim >= inicioHoje) segundosHoje += s.duracaoSegundos;
        if (dataFim >= inicioSemana) segundosSemana += s.duracaoSegundos;

        const nomeTipo = s.tipoEstudoNome || 'Outro';
        porTipo[nomeTipo] = (porTipo[nomeTipo] || 0) + s.duracaoSegundos;
    });

    const tipoMaisEstudado = Object.entries(porTipo).sort((a, b) => b[1] - a[1])[0];

    const grid = document.getElementById('dashboard-grid');
    if (grid) {
        grid.innerHTML = `
            <div class="stat-card">
                <span class="stat-card-label">Hoje</span>
                <span class="stat-card-valor">${formatarDuracaoCurta(segundosHoje)}</span>
            </div>
            <div class="stat-card">
                <span class="stat-card-label">Esta semana</span>
                <span class="stat-card-valor">${formatarDuracaoCurta(segundosSemana)}</span>
            </div>
            <div class="stat-card">
                <span class="stat-card-label">Total no plano</span>
                <span class="stat-card-valor">${formatarDuracaoCurta(segundosTotal)}</span>
            </div>
            <div class="stat-card">
                <span class="stat-card-label">Sessões registradas</span>
                <span class="stat-card-valor">${sessoesCache.length}</span>
            </div>
            <div class="stat-card stat-card-destaque">
                <span class="stat-card-label">Tipo mais estudado</span>
                <span class="stat-card-valor stat-card-valor-texto">${tipoMaisEstudado ? tipoMaisEstudado[0] : '—'}</span>
            </div>
        `;
    }

    renderizarHistorico();
}

function renderizarHistorico() {
    const lista = document.getElementById('lista-historico');
    if (!lista) return;

    if (sessoesCache.length === 0) {
        lista.innerHTML = `<div class="lista-vazia">Nenhuma sessão registrada ainda neste plano. Inicie o cronômetro para começar!</div>`;
        return;
    }

    lista.innerHTML = sessoesCache.slice(0, 30).map(s => {
        const data = new Date(s.fim);
        const topicosTexto = s.topicos && s.topicos.length > 0
            ? s.topicos.map(t => t.topico).join(', ')
            : 'Sem tópicos vinculados';
        let desempenho = '';
        if (s.acertos !== null && s.acertos !== undefined) {
            desempenho = `<span class="historico-badge">✔️ ${s.acertos} / ❌ ${s.erros || 0}</span>`;
        } else if (s.paginasLidas !== null && s.paginasLidas !== undefined) {
            desempenho = `<span class="historico-badge">📖 ${s.paginasLidas} pág.</span>`;
        }

        return `
            <div class="historico-item">
                <div class="historico-item-topo">
                    <span class="historico-tipo">${s.tipoEstudoNome || 'Outro'}</span>
                    <span class="historico-duracao">${formatarDuracaoCurta(s.duracaoSegundos)}</span>
                    <span class="historico-data">${data.toLocaleDateString('pt-BR')}</span>
                    <button class="btn-delete historico-excluir" onclick="excluirSessao('${s._id}')">🗑️</button>
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
    await carregarPainelEstudos();
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

document.addEventListener('DOMContentLoaded', iniciar);
