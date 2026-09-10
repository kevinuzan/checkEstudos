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

async function iniciar() {
    await carregarPlanos();
    await carregarEdital();
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

document.addEventListener('DOMContentLoaded', iniciar);
