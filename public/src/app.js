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

// Jogo escolhido na tela de seleção, aguardando a resposta do modal
// "iniciar o cronômetro?" antes de efetivamente abrir o iframe.
let jogoTipoPendente = null;

async function iniciar() {
    renderizarSeletorTema();
    renderizarSeletorFundo();
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
let tentativasEsperaGoogle = 0;

// O script do Google (accounts.google.com/gsi/client, no <head>) carrega de
// forma assíncrona — na primeira visita, essa função pode rodar antes dele
// terminar de carregar. Antes, isso fazia a função desistir de vez e o botão
// de login só aparecia depois de atualizar a página (quando o script já
// estava em cache). Agora, se o Google ainda não estiver pronto, tenta de
// novo a cada 200ms por até ~10s, em vez de desistir na primeira tentativa.
async function mostrarTelaLogin() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'flex';

    if (googleSignInIniciado) return;

    if (typeof google === 'undefined' || !google.accounts) {
        if (tentativasEsperaGoogle < 50) {
            tentativasEsperaGoogle++;
            setTimeout(mostrarTelaLogin, 200);
        } else {
            const erroEl = document.getElementById('login-erro');
            if (erroEl) {
                erroEl.textContent = 'Não foi possível carregar o login do Google. Verifique sua conexão e atualize a página.';
                erroEl.style.display = 'block';
            }
        }
        return;
    }
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

    const nomeArquivoEl = document.getElementById('edital-arquivo-nome');
    if (nomeArquivoEl) nomeArquivoEl.textContent = arquivo.name;

    try {
        const texto = await arquivo.text();
        const dados = JSON.parse(texto);

        const nomeSugerido = dados.nomeEdital || planoAtual;
        const plano = prompt('Importar para qual plano?', nomeSugerido);
        if (!plano) { event.target.value = ''; if (nomeArquivoEl) nomeArquivoEl.textContent = 'Nenhum arquivo selecionado'; return; }

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

        // Atualiza tudo na hora (sem precisar dar F5): planos, checkboxes e o
        // edital em si — mesmo se o plano importado já for o que já estava
        // selecionado (por isso não usamos trocarPlano aqui, que nesse caso
        // não faria nada).
        await carregarPlanos();
        planoAtual = resultado.plano;
        localStorage.setItem('edital_plano_atual', planoAtual);
        renderizarTabsPlanos();
        renderPlanosCheckboxes('planos-checkboxes-import', [planoAtual]);
        await carregarEdital();
        if (viewAtual === 'estudos') await carregarPainelEstudos();
        if (viewAtual === 'resumo') await carregarResumo();

        if (nomeArquivoEl) nomeArquivoEl.textContent = 'Nenhum arquivo selecionado';
        alert(`Edital importado para "${resultado.plano}": ${resultado.criados} tópico(s) novo(s), ${resultado.vinculados} já existiam e foram vinculados.`);
    } catch (err) {
        console.error('Erro ao importar edital:', err);
        event.target.value = '';
        if (nomeArquivoEl) nomeArquivoEl.textContent = 'Nenhum arquivo selecionado';
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

// --- FUNDO DE TELA (tom clarinho da cor do tema, por padrão; ou neutro) ---

const FUNDOS_DISPONIVEIS = [
    { id: '', nome: 'Colorido (tom do tema)' },
    { id: 'neutro', nome: 'Neutro' }
];

function obterFundoSalvo() {
    try {
        return localStorage.getItem('checkestudos_fundo') || '';
    } catch (err) {
        return '';
    }
}

function aplicarFundo(fundoId) {
    if (fundoId) document.documentElement.setAttribute('data-fundo', fundoId);
    else document.documentElement.removeAttribute('data-fundo');
    try { localStorage.setItem('checkestudos_fundo', fundoId); } catch (err) { /* segue sem salvar */ }
    renderizarSeletorFundo();
}

function renderizarSeletorFundo() {
    const container = document.getElementById('fundo-opcoes');
    if (!container) return;
    const fundoAtual = obterFundoSalvo();
    container.innerHTML = FUNDOS_DISPONIVEIS.map(f => `
        <button type="button" class="fundo-opcao ${fundoAtual === f.id ? 'ativo' : ''}"
            onclick="aplicarFundo('${f.id}')">${f.nome}</button>
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
        // Por padrão as matérias começam fechadas (menos poluição visual ao
        // abrir a aba) — só ficam abertas se a pessoa já clicou pra expandir
        // antes (fica salvo por matéria no localStorage).
        const estaMinimizado = materia in estadosMinimizados ? estadosMinimizados[materia] : true;
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
                <button type="button" class="btn-add-topico-materia" title="Adicionar tópico em ${materia}"
                    onclick="event.stopPropagation(); abrirModalNovoTopico('${materia.replace(/'/g, "\\'")}')">+ Tópico</button>
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
    // Mesma regra de "fechado por padrão" usada na renderização — sem isso,
    // o primeiro clique numa matéria nova (que já aparece fechada, mas nunca
    // foi gravada no localStorage) marcaria ela como fechada de novo, e o
    // clique pareceria não fazer nada.
    const estaMinimizadoAtual = materia in estadosMinimizados ? estadosMinimizados[materia] : true;
    estadosMinimizados[materia] = !estaMinimizadoAtual;
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

// --- ADICIONAR TÓPICO(S) A UMA MATÉRIA (existente, via seletor, ou nova) ---
// Substitui o antigo formulário de "Importar Tópicos" (texto livre sem
// seleção), que causava duplicidade de matéria quando o nome digitado não
// batia exatamente (espaços, maiúsculas etc.) com uma matéria já existente.

let materiasExistentesCache = [];

// Busca TODAS as matérias do usuário (não só as do plano selecionado no
// momento), já que o seletor precisa oferecer qualquer matéria existente,
// independente de qual aba/plano estava ativo ao abrir o modal.
async function carregarMateriasExistentes() {
    try {
        const res = await fetch('/api/edital');
        const todos = await res.json();
        const nomes = Array.from(new Set(
            todos.map(i => (i.materia || '').trim()).filter(m => m !== '')
        ));
        materiasExistentesCache = nomes.sort((a, b) => a.localeCompare(b, 'pt-BR'));
    } catch (err) {
        console.error('Erro ao carregar matérias existentes:', err);
        materiasExistentesCache = [];
    }
}

async function abrirModalNovoTopico(materiaPreSelecionada) {
    await carregarMateriasExistentes();

    const select = document.getElementById('novo-topico-materia-select');
    const inputNova = document.getElementById('novo-topico-materia-nova');

    const opcoesExistentes = materiasExistentesCache.map(m =>
        `<option value="${m.replace(/"/g, '&quot;')}">${m}</option>`
    ).join('');
    select.innerHTML = opcoesExistentes + `<option value="__nova__">+ Nova matéria...</option>`;

    inputNova.style.display = 'none';
    inputNova.value = '';

    if (materiaPreSelecionada && materiasExistentesCache.includes(materiaPreSelecionada)) {
        select.value = materiaPreSelecionada;
    } else if (materiaPreSelecionada) {
        select.value = '__nova__';
        inputNova.style.display = 'block';
        inputNova.value = materiaPreSelecionada;
    } else if (materiasExistentesCache.length === 0) {
        select.value = '__nova__';
        inputNova.style.display = 'block';
    }

    document.getElementById('novo-topico-bulk-input').value = '';
    renderPlanosCheckboxes('planos-checkboxes-novo-topico', [planoAtual]);
    document.getElementById('modal-novo-topico-overlay').style.display = 'flex';
}

function onMudarMateriaNovoTopico() {
    const select = document.getElementById('novo-topico-materia-select');
    const inputNova = document.getElementById('novo-topico-materia-nova');
    inputNova.style.display = select.value === '__nova__' ? 'block' : 'none';
}

function fecharModalNovoTopico() {
    document.getElementById('modal-novo-topico-overlay').style.display = 'none';
}

async function salvarNovoTopico() {
    const select = document.getElementById('novo-topico-materia-select');
    let materia = select.value;
    if (materia === '__nova__') {
        materia = document.getElementById('novo-topico-materia-nova').value.trim();
    }
    const textoBruto = document.getElementById('novo-topico-bulk-input').value;
    let planos = lerPlanosMarcados('planos-checkboxes-novo-topico');

    if (!materia || !textoBruto.trim()) return alert("Selecione (ou digite) a matéria e preencha ao menos um tópico!");
    if (planos.length === 0) planos = [planoAtual];

    await fetch('/api/edital/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materia, textoBruto, planos })
    });

    fecharModalNovoTopico();
    await carregarEdital();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();
}

// ==================================================================
// NAVEGAÇÃO ENTRE SEÇÕES (Resumo / Edital / Estudos)
// ==================================================================

async function trocarView(nome) {
    viewAtual = nome;
    document.getElementById('view-resumo').style.display = nome === 'resumo' ? 'block' : 'none';
    document.getElementById('view-edital').style.display = nome === 'edital' ? 'block' : 'none';
    document.getElementById('view-estudos').style.display = nome === 'estudos' ? 'block' : 'none';
    document.getElementById('view-flashcards').style.display = nome === 'flashcards' ? 'block' : 'none';
    document.getElementById('view-jogo').style.display = nome === 'jogo' ? 'block' : 'none';
    document.getElementById('view-estatisticas').style.display = nome === 'estatisticas' ? 'block' : 'none';
    document.getElementById('view-conquistas').style.display = nome === 'conquistas' ? 'block' : 'none';
    document.getElementById('view-configuracoes').style.display = nome === 'configuracoes' ? 'block' : 'none';
    document.getElementById('tab-resumo').classList.toggle('ativo', nome === 'resumo');
    document.getElementById('tab-edital').classList.toggle('ativo', nome === 'edital');
    document.getElementById('tab-estudos').classList.toggle('ativo', nome === 'estudos');
    document.getElementById('tab-flashcards').classList.toggle('ativo', nome === 'flashcards');
    document.getElementById('tab-jogo').classList.toggle('ativo', nome === 'jogo');
    document.getElementById('tab-estatisticas').classList.toggle('ativo', nome === 'estatisticas');
    document.getElementById('tab-conquistas').classList.toggle('ativo', nome === 'conquistas');
    document.getElementById('tab-configuracoes').classList.toggle('ativo', nome === 'configuracoes');

    if (nome === 'resumo') await carregarResumo();
    if (nome === 'estudos') await carregarPainelEstudos();
    if (nome === 'flashcards') await carregarFlashcards();
    if (nome === 'jogo') { mostrarSelecaoJogo(); await carregarPontuacaoJogo(); }
    if (nome === 'estatisticas') await carregarEstatisticas();
    if (nome === 'conquistas') await abrirConquistas();
    if (nome === 'configuracoes') await abrirConfiguracoes();
}

// ==================================================================
// VIEW: CONFIGURAÇÕES (tema, fundo, apelido, importar tópicos)
// ==================================================================

async function abrirConfiguracoes() {
    renderizarSeletorTema();
    renderizarSeletorFundo();
    const input = document.getElementById('config-apelido-input');
    if (!input) return;
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return;
        const dados = await res.json();
        input.value = dados.usuario?.apelido || '';
        input.placeholder = dados.usuario?.nomeGoogle ? `Ex: ${dados.usuario.nomeGoogle.split(' ')[0]}` : 'Ex: Ana';
    } catch (err) {
        console.error('Erro ao carregar perfil:', err);
    }
}

async function salvarApelido() {
    const input = document.getElementById('config-apelido-input');
    const btn = document.getElementById('btn-salvar-apelido');
    if (!input || !btn) return;
    const apelido = input.value.trim();
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    try {
        const res = await fetch('/api/perfil/apelido', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apelido })
        });
        const dados = await res.json();
        if (dados.success) {
            const nomeEl = document.getElementById('usuario-nome');
            if (nomeEl) nomeEl.textContent = dados.nome;
            btn.textContent = 'Salvo ✓';
        } else {
            btn.textContent = 'Erro ao salvar';
        }
    } catch (err) {
        console.error('Erro ao salvar apelido:', err);
        btn.textContent = 'Erro ao salvar';
    }
    setTimeout(() => { btn.textContent = textoOriginal; btn.disabled = false; }, 1600);
}

// "Importar tópicos" fica sempre minimizado por padrão dentro de
// Configurações — a pessoa clica pra abrir só quando precisa importar algo.
function alternarImportarTopicos() {
    const conteudo = document.getElementById('conteudo-importar-topicos');
    const seta = document.getElementById('seta-importar-topicos');
    if (!conteudo) return;
    const abrindo = conteudo.style.display === 'none';
    conteudo.style.display = abrindo ? 'flex' : 'none';
    if (seta) seta.classList.toggle('aberta', abrindo);
}

// ==================================================================
// SELEÇÃO DE JOGO: ao entrar na aba "Jogo" a pessoa vê só os 3 cartões
// pra escolher; ao escolher um, perguntamos se quer contar o tempo como
// sessão de estudo e então abrimos SÓ aquele jogo (sem ver os outros 2).
// ==================================================================

// Guarda qual jogo específico está aberto no momento (null = tela geral de
// seleção). Usado pra saber se o placar deve mostrar só aquele jogo ou os 3
// somados, inclusive quando o próprio jogo avisa (postMessage) que marcou
// ponto e o placar precisa se atualizar sem trocar de tela.
let jogoAtualAberto = null;

function mostrarSelecaoJogo() {
    jogoAtualAberto = null;
    const selecao = document.getElementById('jogo-selecao-bloco');
    const frameWrap = document.getElementById('jogo-frame-wrap');
    const btnVoltar = document.getElementById('btn-voltar-jogo');
    if (selecao) selecao.style.display = 'grid';
    if (frameWrap) frameWrap.style.display = 'none';
    if (btnVoltar) btnVoltar.style.display = 'none';
}

function selecionarJogo(tipo) {
    // Se o cronômetro já está rodando (ou pausado, no meio de uma sessão),
    // não faz sentido perguntar se quer iniciar — abre o jogo direto.
    if (cronometroEstado.status !== 'parado') {
        abrirJogo(tipo);
        return;
    }
    jogoTipoPendente = tipo;
    document.getElementById('modal-cronometro-jogo-overlay').style.display = 'flex';
}

function confirmarCronometroJogo(iniciar) {
    document.getElementById('modal-cronometro-jogo-overlay').style.display = 'none';
    const tipo = jogoTipoPendente;
    jogoTipoPendente = null;
    if (!tipo) return;

    if (iniciar && cronometroEstado.status === 'parado') {
        iniciarCronometro();
    }
    abrirJogo(tipo);
}

function abrirJogo(tipo) {
    jogoAtualAberto = tipo;
    const iframe = document.getElementById('jogo-iframe');
    const selecao = document.getElementById('jogo-selecao-bloco');
    const frameWrap = document.getElementById('jogo-frame-wrap');
    const btnVoltar = document.getElementById('btn-voltar-jogo');
    if (iframe) iframe.setAttribute('src', `/jogo/?jogo=${tipo}`);
    if (selecao) selecao.style.display = 'none';
    if (frameWrap) frameWrap.style.display = 'block';
    if (btnVoltar) btnVoltar.style.display = 'inline-flex';
    // Dentro de um jogo específico, o placar mostra só aquele jogo — não os
    // 3 somados (isso só faz sentido na tela geral de seleção).
    carregarPontuacaoJogo(tipo);
}

function voltarSelecaoJogo() {
    mostrarSelecaoJogo();
    carregarPontuacaoJogo();
}

// ==================================================================
// PONTUAÇÃO DO JOGO (persistida no banco, por sub-jogo, nunca zerada;
// e opção de registrar o desempenho de hoje como sessão de estudo)
// ==================================================================

const NOMES_JOGO_CHECKESTUDOS = { mnemonicos: 'Mnemônicos', competencias: 'Competências', lacunas: 'Lacunas' };
const ICONES_JOGO_CHECKESTUDOS = { mnemonicos: '🧠', competencias: '⚖️', lacunas: '📜' };

async function obterPontuacaoJogoPorTipo() {
    try {
        const res = await fetch('/jogo/api/pontuacao');
        return await res.json();
    } catch (err) {
        console.error('Erro ao carregar pontuação do jogo:', err);
        return {};
    }
}

// Um "cartão" compacto por jogo — ícone, nome, % de acerto (quando já
// houver alguma resposta) e os números de hoje/total, em vez do texto
// corrido de antes.
function construirCardPontuacaoJogo(tipo, d) {
    const totalRespostas = d.total.acertos + d.total.erros;
    const percAcerto = totalRespostas > 0 ? Math.round((d.total.acertos / totalRespostas) * 100) : null;
    const houveHoje = (d.hoje.acertos + d.hoje.erros) > 0;

    return `
        <div class="jogo-stat-card">
            <div class="jogo-stat-card-topo">
                <span class="jogo-stat-card-icone">${ICONES_JOGO_CHECKESTUDOS[tipo] || '🎮'}</span>
                <span class="jogo-stat-card-nome">${NOMES_JOGO_CHECKESTUDOS[tipo] || tipo}</span>
                ${percAcerto !== null ? `<span class="jogo-stat-card-perc">${percAcerto}%</span>` : ''}
            </div>
            <div class="jogo-stat-card-linha">
                <span class="jogo-stat-card-acerto">✅ ${d.total.acertos}</span>
                <span class="jogo-stat-card-erro">❌ ${d.total.erros}</span>
            </div>
            ${houveHoje ? `<div class="jogo-stat-card-hoje">hoje: ✅ ${d.hoje.acertos} &middot; ❌ ${d.hoje.erros}</div>` : ''}
        </div>
    `;
}

// filtroTipo: quando informado ('mnemonicos'|'competencias'|'lacunas'), mostra
// só o placar daquele jogo (usado quando um jogo específico está aberto).
// Sem filtro, mostra os 3 jogos juntos (tela geral de seleção).
async function carregarPontuacaoJogo(filtroTipo) {
    const dados = await obterPontuacaoJogoPorTipo();
    const el = document.getElementById('jogo-pontuacao-resumo');
    if (!el) return;

    const tipos = filtroTipo ? [filtroTipo] : Object.keys(NOMES_JOGO_CHECKESTUDOS);
    el.innerHTML = tipos.map(tipo => {
        const d = dados[tipo] || { total: { acertos: 0, erros: 0 }, hoje: { acertos: 0, erros: 0 } };
        return construirCardPontuacaoJogo(tipo, d);
    }).join('');
}

// O jogo (dentro do iframe) avisa por postMessage sempre que uma rodada é
// registrada, pra esse resumo — mostrado uma única vez, aqui fora do
// iframe — atualizar na hora, sem esperar o usuário trocar de aba. Respeita
// o filtro do jogo atualmente aberto, se houver um.
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.tipo === 'jogo-pontuacao-atualizada') {
        carregarPontuacaoJogo(jogoAtualAberto || undefined);
    }
});

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
// VIEW: ESTATÍSTICAS (gráficos por matéria, por jogo, por plano de
// estudos e evolução de questões resolvidas — usando Chart.js)
// ==================================================================

let graficosEstatisticas = {}; // id curto -> instância Chart.js ativa (destruída antes de redesenhar)
let sessoesEstatisticasCache = []; // todas as sessões, de todos os planos

// Filtro de data da aba Estatísticas: "dia" (hoje), "semana" (últimos 7
// dias), "mes" (últimos 30 dias) ou "intervalo" (datas escolhidas pela
// pessoa). Persistido, pra manter a escolha entre visitas à aba.
let filtroEstatisticasAtivo = localStorage.getItem('estat_filtro') || 'mes';
let filtroEstatisticasIntervalo = {
    inicio: localStorage.getItem('estat_intervalo_inicio') || '',
    fim: localStorage.getItem('estat_intervalo_fim') || ''
};

// Lê uma cor do tema atual (CSS custom property), pra os gráficos
// acompanharem tema claro/escuro e as cores de fundo escolhidas.
function corCssVar(nome, fallback) {
    const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return valor || fallback;
}

function destruirGraficoEstatistica(id) {
    if (graficosEstatisticas[id]) {
        graficosEstatisticas[id].destroy();
        delete graficosEstatisticas[id];
    }
}

// Calcula o intervalo [inicio, fim] (objetos Date) de acordo com o filtro
// ativo. "Semana" e "Mês" são janelas móveis (últimos 7/30 dias, incluindo
// hoje), no mesmo espírito do gráfico "Últimos 30 dias" do Resumo.
function obterIntervaloFiltroEstatisticas() {
    const agora = new Date();
    const fimPadrao = new Date(agora);
    fimPadrao.setHours(23, 59, 59, 999);

    if (filtroEstatisticasAtivo === 'dia') {
        const inicio = new Date(agora);
        inicio.setHours(0, 0, 0, 0);
        return { inicio, fim: fimPadrao };
    }
    if (filtroEstatisticasAtivo === 'semana') {
        const inicio = new Date(agora);
        inicio.setDate(inicio.getDate() - 6);
        inicio.setHours(0, 0, 0, 0);
        return { inicio, fim: fimPadrao };
    }
    if (filtroEstatisticasAtivo === 'intervalo') {
        const inicio = filtroEstatisticasIntervalo.inicio
            ? new Date(`${filtroEstatisticasIntervalo.inicio}T00:00:00`)
            : new Date(agora.getTime() - 29 * 24 * 60 * 60 * 1000);
        const fim = filtroEstatisticasIntervalo.fim
            ? new Date(`${filtroEstatisticasIntervalo.fim}T23:59:59`)
            : fimPadrao;
        return { inicio, fim };
    }
    // 'mes' (padrão)
    const inicio = new Date(agora);
    inicio.setDate(inicio.getDate() - 29);
    inicio.setHours(0, 0, 0, 0);
    return { inicio, fim: fimPadrao };
}

// Sessões (de todos os planos) que caem dentro do intervalo escolhido —
// usada pelos gráficos de matéria e de plano de estudos.
function sessoesEstatisticasFiltradas() {
    const { inicio, fim } = obterIntervaloFiltroEstatisticas();
    return sessoesEstatisticasCache.filter(s => {
        const d = new Date(s.fim);
        return d >= inicio && d <= fim;
    });
}

function textoPeriodoFiltroEstatisticas() {
    const { inicio, fim } = obterIntervaloFiltroEstatisticas();
    const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    if (filtroEstatisticasAtivo === 'dia') return 'Hoje';
    if (filtroEstatisticasAtivo === 'semana') return 'Últimos 7 dias';
    if (filtroEstatisticasAtivo === 'mes') return 'Últimos 30 dias';
    return `De ${fmt(inicio)} até ${fmt(fim)}`;
}

// Sincroniza os pills e os campos de data com o filtro salvo — chamada ao
// abrir a aba (os botões existem na primeira renderização do HTML, então
// não precisam ser recriados via JS, só marcados como ativo/inativo).
function inicializarFiltroEstatisticasUI() {
    document.querySelectorAll('#estat-filtro-row .escopo-pill[data-filtro]').forEach(btn => {
        btn.classList.toggle('ativo', btn.dataset.filtro === filtroEstatisticasAtivo);
    });
    const intervaloBox = document.getElementById('estat-filtro-intervalo');
    if (intervaloBox) intervaloBox.style.display = filtroEstatisticasAtivo === 'intervalo' ? 'flex' : 'none';
    const inicioInput = document.getElementById('estat-intervalo-inicio');
    const fimInput = document.getElementById('estat-intervalo-fim');
    if (inicioInput) inicioInput.value = filtroEstatisticasIntervalo.inicio || '';
    if (fimInput) fimInput.value = filtroEstatisticasIntervalo.fim || '';
}

function definirFiltroEstatisticas(filtro) {
    filtroEstatisticasAtivo = filtro;
    localStorage.setItem('estat_filtro', filtro);
    inicializarFiltroEstatisticasUI();
    renderizarGraficosComFiltroEstatisticas();
}

function atualizarIntervaloEstatisticas() {
    const inicioInput = document.getElementById('estat-intervalo-inicio');
    const fimInput = document.getElementById('estat-intervalo-fim');
    filtroEstatisticasIntervalo.inicio = inicioInput ? inicioInput.value : '';
    filtroEstatisticasIntervalo.fim = fimInput ? fimInput.value : '';
    localStorage.setItem('estat_intervalo_inicio', filtroEstatisticasIntervalo.inicio);
    localStorage.setItem('estat_intervalo_fim', filtroEstatisticasIntervalo.fim);
    if (filtroEstatisticasAtivo === 'intervalo') renderizarGraficosComFiltroEstatisticas();
}

// Os gráficos afetados pelo filtro de data (matéria, plano de estudos e
// evolução) — "Desempenho por jogo" fica de fora porque a pontuação dos
// jogos é um total acumulado, sem data por partida.
function renderizarGraficosComFiltroEstatisticas() {
    renderizarGraficoEstatMaterias();
    renderizarGraficoEstatPlanos();
    renderizarGraficoEstatEvolucao();
}

async function carregarEstatisticas() {
    try {
        const [resSessoes, dadosJogos] = await Promise.all([
            fetch('/api/sessoes?limite=3000'),
            obterPontuacaoJogoPorTipo()
        ]);
        sessoesEstatisticasCache = await resSessoes.json();
        if (Object.keys(materiasCores).length === 0) await carregarMateriasCores();

        const vazio = document.getElementById('estat-vazio');
        if (vazio) vazio.style.display = sessoesEstatisticasCache.length > 0 ? 'none' : 'block';

        inicializarFiltroEstatisticasUI();
        renderizarGraficoEstatMaterias();
        renderizarGraficoEstatJogos(dadosJogos);
        renderizarGraficoEstatPlanos();
        renderizarGraficoEstatEvolucao();
    } catch (err) {
        console.error('Erro ao carregar estatísticas:', err);
    }
}

// Doughnut: tempo de estudo (minutos) distribuído por matéria — mesma
// distribuição igualitária usada no Resumo (distribuirSegundosPorMateria).
function renderizarGraficoEstatMaterias() {
    const canvas = document.getElementById('chart-estat-materias');
    if (!canvas || typeof Chart === 'undefined') return;
    destruirGraficoEstatistica('materias');

    const subEl = document.getElementById('estat-materias-sub');
    if (subEl) subEl.textContent = `Distribuição do tempo estudado — ${textoPeriodoFiltroEstatisticas()}`;

    const porMateria = {};
    let semMateriaSegundos = 0;
    sessoesEstatisticasFiltradas().forEach(s => {
        const partes = distribuirSegundosPorMateria(s);
        const materias = Object.keys(partes);
        if (materias.length === 0) {
            semMateriaSegundos += s.duracaoSegundos;
        } else {
            materias.forEach(m => { porMateria[m] = (porMateria[m] || 0) + partes[m]; });
        }
    });

    const entradas = Object.entries(porMateria).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (semMateriaSegundos > 0) entradas.push(['Sem matéria vinculada', semMateriaSegundos]);
    const corTexto = corCssVar('--text-muted', '#64748b');

    graficosEstatisticas.materias = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: entradas.map(([m]) => m),
            datasets: [{
                data: entradas.map(([, seg]) => Math.round(seg / 60)),
                backgroundColor: entradas.map(([m]) => m === 'Sem matéria vinculada' ? '#cbd5e1' : corDaMateria(m)),
                borderColor: corCssVar('--card', '#fff'),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: corTexto, boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed} min` } }
            }
        }
    });
}

// Barras agrupadas: acertos x erros acumulados em cada um dos 3 jogos.
function renderizarGraficoEstatJogos(dadosJogos) {
    const canvas = document.getElementById('chart-estat-jogos');
    if (!canvas || typeof Chart === 'undefined') return;
    destruirGraficoEstatistica('jogos');

    const tipos = Object.keys(NOMES_JOGO_CHECKESTUDOS);
    const corTexto = corCssVar('--text-muted', '#64748b');
    const corGrade = corCssVar('--border', '#e2e8f0');

    graficosEstatisticas.jogos = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: tipos.map(t => NOMES_JOGO_CHECKESTUDOS[t]),
            datasets: [
                {
                    label: 'Acertos',
                    data: tipos.map(t => (dadosJogos[t] && dadosJogos[t].total.acertos) || 0),
                    backgroundColor: '#16a34a',
                    borderRadius: 4
                },
                {
                    label: 'Erros',
                    data: tipos.map(t => (dadosJogos[t] && dadosJogos[t].total.erros) || 0),
                    backgroundColor: '#dc2626',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: corTexto, boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: corTexto, font: { size: 11 } }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: corTexto, precision: 0 }, grid: { color: corGrade } }
            }
        }
    });
}

// Barras + linha (eixos duplos): questões resolvidas e % de acerto, por
// plano de estudos (edital) — pra comparar o desempenho entre planos.
function renderizarGraficoEstatPlanos() {
    const canvas = document.getElementById('chart-estat-planos');
    if (!canvas || typeof Chart === 'undefined') return;
    destruirGraficoEstatistica('planos');

    const subEl = document.getElementById('estat-planos-sub');
    if (subEl) subEl.textContent = `Questões resolvidas e % de acerto por edital — ${textoPeriodoFiltroEstatisticas()}`;

    const nomesPlanos = planosDisponiveis.map(p => p.nome);
    const porPlano = {};
    nomesPlanos.forEach(nome => { porPlano[nome] = { acertos: 0, erros: 0 }; });
    sessoesEstatisticasFiltradas().forEach(s => {
        if (!s.plano || !(s.plano in porPlano)) return;
        porPlano[s.plano].acertos += s.acertos || 0;
        porPlano[s.plano].erros += s.erros || 0;
    });

    const corTexto = corCssVar('--text-muted', '#64748b');
    const corGrade = corCssVar('--border', '#e2e8f0');
    const corPrimaria = corCssVar('--primary', '#2563eb');

    graficosEstatisticas.planos = new Chart(canvas, {
        data: {
            labels: nomesPlanos,
            datasets: [
                {
                    type: 'bar',
                    label: 'Questões resolvidas',
                    data: nomesPlanos.map(n => porPlano[n].acertos + porPlano[n].erros),
                    backgroundColor: corPrimaria,
                    borderRadius: 4,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: '% de acerto',
                    data: nomesPlanos.map(n => {
                        const total = porPlano[n].acertos + porPlano[n].erros;
                        return total > 0 ? Math.round((porPlano[n].acertos / total) * 100) : null;
                    }),
                    borderColor: '#f59e0b',
                    backgroundColor: '#f59e0b',
                    yAxisID: 'y1',
                    tension: 0.3,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: corTexto, boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: corTexto, font: { size: 11 } }, grid: { display: false } },
                y: { beginAtZero: true, position: 'left', ticks: { color: corTexto, precision: 0 }, grid: { color: corGrade } },
                y1: { beginAtZero: true, max: 100, position: 'right', ticks: { color: corTexto, callback: (v) => v + '%' }, grid: { display: false } }
            }
        }
    });
}

// Monta os "baldes" (buckets) de tempo pra distribuir as sessões no gráfico
// de evolução, adaptando o agrupamento ao tamanho do período escolhido no
// filtro: um dia só vira horas, um intervalo curto vira dias, um intervalo
// longo vira semanas (senão o gráfico fica com barras demais pra caber).
function gerarBucketsEvolucaoEstatisticas(inicio, fim) {
    const umDiaMs = 24 * 60 * 60 * 1000;
    const spanDias = (fim - inicio) / umDiaMs;
    const buckets = [];

    if (spanDias <= 1.5) {
        for (let h = 0; h < 24; h++) {
            const ini = new Date(inicio);
            ini.setHours(h, 0, 0, 0);
            const fimH = new Date(ini.getTime() + 60 * 60 * 1000);
            buckets.push({ inicio: ini, fim: fimH, label: `${String(h).padStart(2, '0')}h`, acertos: 0, erros: 0 });
        }
        return buckets;
    }

    if (spanDias <= 60) {
        const totalDias = Math.ceil(spanDias) + 1;
        for (let i = 0; i < totalDias; i++) {
            const ini = new Date(inicio.getTime() + i * umDiaMs);
            ini.setHours(0, 0, 0, 0);
            const fimD = new Date(ini.getTime() + umDiaMs);
            buckets.push({ inicio: ini, fim: fimD, label: ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), acertos: 0, erros: 0 });
        }
        return buckets;
    }

    const totalSemanas = Math.ceil(spanDias / 7) + 1;
    for (let i = 0; i < totalSemanas; i++) {
        const ini = new Date(inicio.getTime() + i * 7 * umDiaMs);
        ini.setHours(0, 0, 0, 0);
        const fimS = new Date(ini.getTime() + 7 * umDiaMs);
        buckets.push({ inicio: ini, fim: fimS, label: ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), acertos: 0, erros: 0 });
    }
    return buckets;
}

// Barras + linha: questões resolvidas e % de acerto ao longo do período
// escolhido no filtro de data — pra acompanhar a evolução do desempenho
// (independe do plano/edital).
function renderizarGraficoEstatEvolucao() {
    const canvas = document.getElementById('chart-estat-evolucao');
    if (!canvas || typeof Chart === 'undefined') return;
    destruirGraficoEstatistica('evolucao');

    const subEl = document.getElementById('estat-evolucao-sub');
    if (subEl) subEl.textContent = textoPeriodoFiltroEstatisticas();

    const { inicio, fim } = obterIntervaloFiltroEstatisticas();
    const buckets = gerarBucketsEvolucaoEstatisticas(inicio, fim);

    sessoesEstatisticasCache.forEach(s => {
        const dataFim = new Date(s.fim);
        if (dataFim < inicio || dataFim > fim) return;
        const bucket = buckets.find(b => dataFim >= b.inicio && dataFim < b.fim);
        if (!bucket) return;
        bucket.acertos += s.acertos || 0;
        bucket.erros += s.erros || 0;
    });

    const corTexto = corCssVar('--text-muted', '#64748b');
    const corGrade = corCssVar('--border', '#e2e8f0');
    const corPrimaria = corCssVar('--primary', '#2563eb');

    graficosEstatisticas.evolucao = new Chart(canvas, {
        data: {
            labels: buckets.map(b => b.label),
            datasets: [
                {
                    type: 'bar',
                    label: 'Questões resolvidas',
                    data: buckets.map(b => b.acertos + b.erros),
                    backgroundColor: corPrimaria,
                    borderRadius: 3,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: '% de acerto',
                    data: buckets.map(b => {
                        const total = b.acertos + b.erros;
                        return total > 0 ? Math.round((b.acertos / total) * 100) : null;
                    }),
                    borderColor: '#f59e0b',
                    backgroundColor: '#f59e0b',
                    yAxisID: 'y1',
                    tension: 0.3,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: corTexto, boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: corTexto, font: { size: 10 } }, grid: { display: false } },
                y: { beginAtZero: true, position: 'left', ticks: { color: corTexto, precision: 0 }, grid: { color: corGrade } },
                y1: { beginAtZero: true, max: 100, position: 'right', ticks: { color: corTexto, callback: (v) => v + '%' }, grid: { display: false } }
            }
        }
    });
}

// ==================================================================
// VIEW: FLASHCARDS (baralhos próprios + importação do Anki + revisão
// com repetição espaçada, no estilo SM-2/Anki). Baralhos são
// independentes dos planos de estudo (Edital) — só pertencem ao usuário.
// ==================================================================

let baralhosCache = [];
let baralhoAtualId = null; // baralho aberto na tela de detalhe
let cartoesDoBaralhoCache = [];
let baralhoEmEdicaoId = null; // null = criando um baralho novo no modal

let filaRevisaoCache = []; // cartões pendentes na sessão de revisão atual
let cartaoRevisaoAtual = null;
let respostaRevisaoRevelada = false;

let cartaoEmEdicaoId = null; // null = criando um cartão novo no modal

// Remove tags HTML de um texto (usado só pra montar prévias curtas nas
// listas — o conteúdo completo, com formatação/imagens, é mostrado sem
// alterações na tela de revisão).
function removerTagsHtmlFlashcard(html) {
    return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function carregarFlashcards() {
    mostrarTelaFlashcards('lista');
    try {
        const res = await fetch('/api/flashcards/baralhos');
        baralhosCache = await res.json();
    } catch (err) {
        console.error('Erro ao carregar baralhos:', err);
        baralhosCache = [];
    }
    renderizarBaralhos();
}

function mostrarTelaFlashcards(tela) {
    const blocoLista = document.getElementById('flashcards-lista-bloco');
    const blocoDetalhe = document.getElementById('flashcards-detalhe-bloco');
    const blocoRevisar = document.getElementById('flashcards-revisar-bloco');
    if (blocoLista) blocoLista.style.display = tela === 'lista' ? 'block' : 'none';
    if (blocoDetalhe) blocoDetalhe.style.display = tela === 'detalhe' ? 'block' : 'none';
    if (blocoRevisar) blocoRevisar.style.display = tela === 'revisar' ? 'block' : 'none';
}

function renderizarBaralhos() {
    const grid = document.getElementById('flashcards-baralhos-grid');
    const vazio = document.getElementById('flashcards-vazio');
    if (!grid) return;

    if (vazio) vazio.style.display = baralhosCache.length === 0 ? 'block' : 'none';

    grid.innerHTML = baralhosCache.map(b => `
        <div class="baralho-card">
            <div class="baralho-card-topo">
                <span class="baralho-card-nome">${b.nome}</span>
                ${b.materia ? `<span class="baralho-card-materia">${b.materia}</span>` : ''}
                ${b.origem === 'anki' ? `<span class="baralho-card-origem-anki">Anki</span>` : ''}
            </div>
            <div class="baralho-card-info">
                <span>${b.totalCartoes} cartão${b.totalCartoes === 1 ? '' : 'ões'}</span>
                ${b.aRevisar > 0 ? `<span class="baralho-card-badge">${b.aRevisar} pra revisar</span>` : ''}
            </div>
            <div class="baralho-card-acoes">
                <button type="button" class="btn-secundario" onclick="abrirBaralho('${b._id}')">📚 Ver cartões</button>
                ${b.aRevisar > 0 ? `<button type="button" onclick="iniciarRevisao('${b._id}')">▶ Revisar</button>` : ''}
                <button type="button" class="baralho-card-excluir" onclick="excluirBaralho('${b._id}')" title="Excluir baralho">🗑️</button>
            </div>
        </div>
    `).join('');
}

// --- MODAL: CRIAR/EDITAR BARALHO ---

function abrirModalNovoBaralho() {
    baralhoEmEdicaoId = null;
    document.getElementById('modal-baralho-titulo').textContent = 'Novo baralho';
    document.getElementById('baralho-nome-input').value = '';
    document.getElementById('baralho-materia-input').value = '';
    document.getElementById('modal-baralho-overlay').style.display = 'flex';
}

function abrirModalEditarBaralho() {
    const baralho = baralhosCache.find(b => b._id === baralhoAtualId);
    if (!baralho) return;
    baralhoEmEdicaoId = baralhoAtualId;
    document.getElementById('modal-baralho-titulo').textContent = 'Editar baralho';
    document.getElementById('baralho-nome-input').value = baralho.nome;
    document.getElementById('baralho-materia-input').value = baralho.materia || '';
    document.getElementById('modal-baralho-overlay').style.display = 'flex';
}

function fecharModalBaralho() {
    document.getElementById('modal-baralho-overlay').style.display = 'none';
}

async function salvarBaralho() {
    const nome = document.getElementById('baralho-nome-input').value.trim();
    const materia = document.getElementById('baralho-materia-input').value.trim();
    if (!nome) return;

    try {
        if (baralhoEmEdicaoId) {
            await fetch(`/api/flashcards/baralhos/${baralhoEmEdicaoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, materia })
            });
            const detalheNome = document.getElementById('flashcards-detalhe-nome');
            if (detalheNome && baralhoAtualId === baralhoEmEdicaoId) detalheNome.textContent = nome;
        } else {
            await fetch('/api/flashcards/baralhos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, materia })
            });
        }
        fecharModalBaralho();
        await carregarFlashcards();
    } catch (err) {
        console.error('Erro ao salvar baralho:', err);
    }
}

async function excluirBaralho(id) {
    if (!confirm('Excluir esse baralho e todos os seus cartões? Essa ação não pode ser desfeita.')) return;
    try {
        await fetch(`/api/flashcards/baralhos/${id}`, { method: 'DELETE' });
        await carregarFlashcards();
    } catch (err) {
        console.error('Erro ao excluir baralho:', err);
    }
}

// --- MODAL: IMPORTAR DO ANKI ---

function abrirModalImportarAnki() {
    document.getElementById('importar-anki-nome-input').value = '';
    document.getElementById('importar-anki-arquivo-input').value = '';
    document.getElementById('importar-anki-arquivo-nome').textContent = 'Nenhum arquivo selecionado';
    document.getElementById('modal-importar-anki-overlay').style.display = 'flex';
}

function fecharModalImportarAnki() {
    document.getElementById('modal-importar-anki-overlay').style.display = 'none';
}

function atualizarNomeArquivoAnki(event) {
    const arquivo = event.target.files && event.target.files[0];
    document.getElementById('importar-anki-arquivo-nome').textContent = arquivo ? arquivo.name : 'Nenhum arquivo selecionado';
}

async function confirmarImportarAnki() {
    const input = document.getElementById('importar-anki-arquivo-input');
    const arquivo = input.files && input.files[0];
    if (!arquivo) { alert('Escolha um arquivo .apkg pra importar.'); return; }

    const nome = document.getElementById('importar-anki-nome-input').value.trim();
    const btn = document.getElementById('btn-confirmar-importar-anki');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Importando...';

    try {
        const formData = new FormData();
        formData.append('arquivo', arquivo);
        if (nome) formData.append('nome', nome);

        const res = await fetch('/api/flashcards/baralhos/importar-anki', { method: 'POST', body: formData });
        const dados = await res.json();
        if (!dados.success) {
            alert(dados.error || 'Não foi possível importar esse baralho.');
            return;
        }
        fecharModalImportarAnki();
        await carregarFlashcards();
        alert(`Baralho importado! ${dados.totalImportado} cartões adicionados.`);
    } catch (err) {
        console.error('Erro ao importar baralho do Anki:', err);
        alert('Não foi possível importar esse baralho.');
    } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}

// --- DETALHE DO BARALHO (lista de cartões) ---

async function abrirBaralho(id) {
    baralhoAtualId = id;
    const baralho = baralhosCache.find(b => b._id === id);
    document.getElementById('flashcards-detalhe-nome').textContent = baralho ? baralho.nome : 'Baralho';

    mostrarTelaFlashcards('detalhe');
    try {
        const res = await fetch(`/api/flashcards/baralhos/${id}/cards`);
        cartoesDoBaralhoCache = await res.json();
    } catch (err) {
        console.error('Erro ao carregar cartões:', err);
        cartoesDoBaralhoCache = [];
    }
    renderizarCartoesDoBaralho();
}

function voltarListaBaralhos() {
    baralhoAtualId = null;
    carregarFlashcards();
}

function renderizarCartoesDoBaralho() {
    const lista = document.getElementById('flashcards-cartoes-lista');
    const vazio = document.getElementById('flashcards-cartoes-vazio');
    if (!lista) return;

    if (vazio) vazio.style.display = cartoesDoBaralhoCache.length === 0 ? 'block' : 'none';

    lista.innerHTML = cartoesDoBaralhoCache.map(c => `
        <div class="cartao-item">
            <div class="cartao-item-conteudo">
                <div class="cartao-item-frente">${removerTagsHtmlFlashcard(c.frente)}</div>
                <div class="cartao-item-verso">${removerTagsHtmlFlashcard(c.verso)}</div>
            </div>
            <div class="cartao-item-acoes">
                <button type="button" onclick="abrirModalEditarCartao('${c._id}')" title="Editar">✏️</button>
                <button type="button" onclick="excluirCartao('${c._id}')" title="Excluir">🗑️</button>
            </div>
        </div>
    `).join('');
}

// --- MODAL: CRIAR/EDITAR CARTÃO ---

function abrirModalNovoCartao() {
    cartaoEmEdicaoId = null;
    document.getElementById('modal-cartao-titulo').textContent = 'Novo cartão';
    document.getElementById('cartao-frente-input').value = '';
    document.getElementById('cartao-verso-input').value = '';
    document.getElementById('modal-cartao-overlay').style.display = 'flex';
}

function abrirModalEditarCartao(id) {
    const cartao = cartoesDoBaralhoCache.find(c => c._id === id);
    if (!cartao) return;
    cartaoEmEdicaoId = id;
    document.getElementById('modal-cartao-titulo').textContent = 'Editar cartão';
    document.getElementById('cartao-frente-input').value = cartao.frente;
    document.getElementById('cartao-verso-input').value = cartao.verso || '';
    document.getElementById('modal-cartao-overlay').style.display = 'flex';
}

function fecharModalCartao() {
    document.getElementById('modal-cartao-overlay').style.display = 'none';
}

async function salvarCartao() {
    const frente = document.getElementById('cartao-frente-input').value.trim();
    const verso = document.getElementById('cartao-verso-input').value.trim();
    if (!frente) return;

    try {
        if (cartaoEmEdicaoId) {
            await fetch(`/api/flashcards/cards/${cartaoEmEdicaoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frente, verso })
            });
        } else {
            await fetch(`/api/flashcards/baralhos/${baralhoAtualId}/cards`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frente, verso })
            });
        }
        fecharModalCartao();
        await abrirBaralho(baralhoAtualId);
    } catch (err) {
        console.error('Erro ao salvar cartão:', err);
    }
}

async function excluirCartao(id) {
    if (!confirm('Excluir esse cartão?')) return;
    try {
        await fetch(`/api/flashcards/cards/${id}`, { method: 'DELETE' });
        await abrirBaralho(baralhoAtualId);
    } catch (err) {
        console.error('Erro ao excluir cartão:', err);
    }
}

// --- SESSÃO DE REVISÃO (repetição espaçada, estilo SM-2/Anki) ---

async function iniciarRevisao(id) {
    try {
        const res = await fetch(`/api/flashcards/baralhos/${id}/revisar`);
        filaRevisaoCache = await res.json();
    } catch (err) {
        console.error('Erro ao carregar cartões pra revisar:', err);
        filaRevisaoCache = [];
    }

    baralhoAtualId = id;
    if (filaRevisaoCache.length === 0) {
        alert('Não há cartões pendentes de revisão nesse baralho agora.');
        return;
    }

    mostrarTelaFlashcards('revisar');
    document.getElementById('flashcards-revisao-concluida').style.display = 'none';
    document.getElementById('flashcards-card-revisao').style.display = 'flex';
    document.getElementById('flashcards-respostas').style.display = 'none';
    mostrarProximoCartaoRevisao();
}

function mostrarProximoCartaoRevisao() {
    const progresso = document.getElementById('flashcards-revisar-progresso');
    const totalRestante = filaRevisaoCache.length;

    if (totalRestante === 0) {
        document.getElementById('flashcards-card-revisao').style.display = 'none';
        document.getElementById('flashcards-respostas').style.display = 'none';
        document.getElementById('flashcards-revisao-concluida').style.display = 'flex';
        if (progresso) progresso.textContent = '';
        return;
    }

    cartaoRevisaoAtual = filaRevisaoCache[0];
    respostaRevisaoRevelada = false;

    if (progresso) progresso.textContent = `${totalRestante} restante${totalRestante === 1 ? '' : 's'}`;
    document.getElementById('flashcards-card-frente').innerHTML = cartaoRevisaoAtual.frente;
    document.getElementById('flashcards-card-verso').innerHTML = cartaoRevisaoAtual.verso || '<em>(sem verso)</em>';
    document.getElementById('flashcards-card-verso').style.display = 'none';
    document.getElementById('flashcards-card-dica').style.display = 'block';
    document.getElementById('flashcards-respostas').style.display = 'none';
}

function mostrarRespostaRevisao() {
    if (respostaRevisaoRevelada || !cartaoRevisaoAtual) return;
    respostaRevisaoRevelada = true;
    document.getElementById('flashcards-card-verso').style.display = 'block';
    document.getElementById('flashcards-card-dica').style.display = 'none';
    document.getElementById('flashcards-respostas').style.display = 'grid';
}

async function responderRevisao(qualidade) {
    if (!cartaoRevisaoAtual) return;
    const cartaoRespondido = cartaoRevisaoAtual;

    try {
        await fetch(`/api/flashcards/cards/${cartaoRespondido._id}/revisar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qualidade })
        });
    } catch (err) {
        console.error('Erro ao registrar revisão:', err);
    }

    filaRevisaoCache = filaRevisaoCache.filter(c => c._id !== cartaoRespondido._id);
    mostrarProximoCartaoRevisao();
}

function sairRevisao() {
    cartaoRevisaoAtual = null;
    filaRevisaoCache = [];
    carregarFlashcards();
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
// CRONÔMETRO DE ESTUDO (modo Livre ou Pomodoro)
// ==================================================================
// Estado persistido no localStorage para sobreviver a um F5 / fechar aba:
//   status: "parado" | "rodando" | "pausado"
//   inicioSegmentoAtual: epoch ms de quando o trecho atual começou a rodar (null se não estiver rodando)
//   acumuladoMs: soma dos trechos já rodados antes do segmento atual (do TRECHO/fase atual)
//
// No modo Pomodoro, o cronômetro acima passa a medir só a fase em curso
// (foco ou pausa); o tempo de foco acumulado entre fases fica à parte, em
// pomodoroEstado.focoAcumuladoMs — é só isso que vira sessão de estudo.

const CRONOMETRO_KEY = 'cronometro_estado';
const MODO_CRONOMETRO_KEY = 'cronometro_modo';
const POMODORO_ESTADO_KEY = 'pomodoro_estado';
const POMODORO_CONFIG_KEY = 'pomodoro_config';

let cronometroEstado = { status: 'parado', inicioSegmentoAtual: null, acumuladoMs: 0 };
let cronometroIntervalId = null;

let pomodoroEstado = { fase: null, cicloAtual: 0, focoAcumuladoMs: 0 };
let pomodoroConfig = { focoMin: 25, pausaCurtaMin: 5, pausaLongaMin: 15, ciclosParaPausaLonga: 4 };

const NOMES_FASE_POMODORO = { 'foco': 'Foco', 'pausa-curta': 'Pausa curta', 'pausa-longa': 'Pausa longa' };

function obterModoCronometro() {
    try {
        return localStorage.getItem(MODO_CRONOMETRO_KEY) || 'livre';
    } catch (err) {
        return 'livre';
    }
}

function salvarCronometroEstado() {
    localStorage.setItem(CRONOMETRO_KEY, JSON.stringify(cronometroEstado));
}

function salvarPomodoroEstado() {
    localStorage.setItem(POMODORO_ESTADO_KEY, JSON.stringify(pomodoroEstado));
}

function salvarConfigPomodoro() {
    localStorage.setItem(POMODORO_CONFIG_KEY, JSON.stringify(pomodoroConfig));
}

function duracaoFaseAtualMs() {
    const minutos = pomodoroEstado.fase === 'foco' ? pomodoroConfig.focoMin
        : pomodoroEstado.fase === 'pausa-longa' ? pomodoroConfig.pausaLongaMin
        : pomodoroConfig.pausaCurtaMin;
    return (Number(minutos) || 1) * 60 * 1000;
}

// Escolhe o modo (Livre/Pomodoro). Só é permitido trocar com o cronômetro
// parado, pra não perder o que já está em andamento.
function definirModoCronometro(modo) {
    if (cronometroEstado.status !== 'parado') return;
    try { localStorage.setItem(MODO_CRONOMETRO_KEY, modo); } catch (err) { /* segue sem salvar */ }
    renderizarConfigPomodoroInputs();
    atualizarBotoesCronometro();
    atualizarDisplayCronometro();
}

function renderizarConfigPomodoroInputs() {
    const linhaModo = document.getElementById('timer-modo-row');
    const config = document.getElementById('pomodoro-config');
    const btnLivre = document.getElementById('btn-modo-livre');
    const btnPomodoro = document.getElementById('btn-modo-pomodoro');
    if (!linhaModo) return;

    const modo = obterModoCronometro();
    if (btnLivre) btnLivre.classList.toggle('ativo', modo === 'livre');
    if (btnPomodoro) btnPomodoro.classList.toggle('ativo', modo === 'pomodoro');

    // Configuração de minutos só faz sentido editar com tudo parado —
    // mudar no meio de uma fase em andamento seria confuso.
    if (config) config.style.display = (modo === 'pomodoro' && cronometroEstado.status === 'parado') ? 'flex' : 'none';

    const inputFoco = document.getElementById('pomodoro-foco-min');
    const inputPausaCurta = document.getElementById('pomodoro-pausa-curta-min');
    const inputPausaLonga = document.getElementById('pomodoro-pausa-longa-min');
    if (inputFoco) inputFoco.value = pomodoroConfig.focoMin;
    if (inputPausaCurta) inputPausaCurta.value = pomodoroConfig.pausaCurtaMin;
    if (inputPausaLonga) inputPausaLonga.value = pomodoroConfig.pausaLongaMin;
}

function salvarConfigPomodoroInputs() {
    const foco = parseInt(document.getElementById('pomodoro-foco-min').value) || 25;
    const pausaCurta = parseInt(document.getElementById('pomodoro-pausa-curta-min').value) || 5;
    const pausaLonga = parseInt(document.getElementById('pomodoro-pausa-longa-min').value) || 15;
    pomodoroConfig = { ...pomodoroConfig, focoMin: foco, pausaCurtaMin: pausaCurta, pausaLongaMin: pausaLonga };
    salvarConfigPomodoro();
}

function restaurarCronometro() {
    try {
        const salvo = JSON.parse(localStorage.getItem(CRONOMETRO_KEY));
        if (salvo) cronometroEstado = salvo;
    } catch (err) { /* estado inválido, ignora */ }

    try {
        const salvo = JSON.parse(localStorage.getItem(POMODORO_ESTADO_KEY));
        if (salvo) pomodoroEstado = salvo;
    } catch (err) { /* estado inválido, ignora */ }

    try {
        const salvo = JSON.parse(localStorage.getItem(POMODORO_CONFIG_KEY));
        if (salvo) pomodoroConfig = { ...pomodoroConfig, ...salvo };
    } catch (err) { /* estado inválido, ignora */ }

    renderizarConfigPomodoroInputs();
    atualizarBotoesCronometro();
    atualizarDisplayCronometro();

    if (cronometroEstado.status === 'rodando') {
        iniciarIntervaloCronometro();
    }
}

// Elapsed da fase/trecho atual (o que o mostrador conta)
function calcularElapsedMs() {
    let total = cronometroEstado.acumuladoMs;
    if (cronometroEstado.status === 'rodando' && cronometroEstado.inicioSegmentoAtual) {
        total += Date.now() - cronometroEstado.inicioSegmentoAtual;
    }
    return total;
}

// Total de tempo de FOCO já acumulado no pomodoro atual (o que vira sessão de
// estudo ao finalizar) — soma das fases de foco já completas mais a fase de
// foco em andamento agora, se for o caso (pausas nunca contam).
function calcularFocoTotalPomodoroMs() {
    let total = pomodoroEstado.focoAcumuladoMs || 0;
    // Conta o trecho de foco em andamento (rodando) ou recém-pausado (o valor
    // já está acumulado em cronometroEstado.acumuladoMs nesse caso).
    if (pomodoroEstado.fase === 'foco' && (cronometroEstado.status === 'rodando' || cronometroEstado.status === 'pausado')) {
        total += calcularElapsedMs();
    }
    return total;
}

function atualizarDisplayCronometro() {
    const display = document.getElementById('timer-display');
    const cicloInfo = document.getElementById('pomodoro-ciclo-info');
    const bolhaTempo = document.getElementById('timer-bolha-tempo');
    if (!display) return;

    if (obterModoCronometro() === 'pomodoro' && pomodoroEstado.fase) {
        const restanteMs = Math.max(duracaoFaseAtualMs() - calcularElapsedMs(), 0);
        display.textContent = formatarHMS(restanteMs);
        if (cicloInfo) {
            cicloInfo.style.display = 'inline';
            cicloInfo.textContent = `${NOMES_FASE_POMODORO[pomodoroEstado.fase]} · ciclo ${pomodoroEstado.cicloAtual + 1} · foco total: ${formatarHMS(calcularFocoTotalPomodoroMs())}`;
        }
    } else {
        display.textContent = formatarHMS(calcularElapsedMs());
        if (cicloInfo) cicloInfo.style.display = 'none';
    }

    if (bolhaTempo) bolhaTempo.textContent = display.textContent;
}

function atualizarBotoesCronometro() {
    const btnIniciar = document.getElementById('btn-timer-iniciar');
    const btnPausar = document.getElementById('btn-timer-pausar');
    const btnRetomar = document.getElementById('btn-timer-retomar');
    const btnFinalizar = document.getElementById('btn-timer-finalizar');
    const label = document.getElementById('timer-status-label');
    const card = document.getElementById('timer-card');
    const bolha = document.getElementById('timer-bolha');
    const bolhaIcone = document.getElementById('timer-bolha-icone');
    if (!btnIniciar) return;

    const modo = obterModoCronometro();
    const emPomodoro = modo === 'pomodoro';

    btnIniciar.style.display = cronometroEstado.status === 'parado' ? 'inline-flex' : 'none';
    btnPausar.style.display = cronometroEstado.status === 'rodando' ? 'inline-flex' : 'none';
    btnRetomar.style.display = cronometroEstado.status === 'pausado' ? 'inline-flex' : 'none';
    // No pomodoro, "Finalizar" também aparece parado, desde que já tenha algum
    // foco acumulado (senão não tem o que salvar como sessão ainda).
    const temFocoParaSalvar = emPomodoro && calcularFocoTotalPomodoroMs() > 0;
    btnFinalizar.style.display = (cronometroEstado.status !== 'parado' || temFocoParaSalvar) ? 'inline-flex' : 'none';

    if (emPomodoro && pomodoroEstado.fase) {
        btnIniciar.textContent = `▶ Iniciar ${NOMES_FASE_POMODORO[pomodoroEstado.fase].toLowerCase()}`;
    } else {
        btnIniciar.textContent = '▶ Iniciar';
    }

    if (card) card.classList.toggle('timer-rodando', cronometroEstado.status === 'rodando');
    if (card) card.classList.toggle('timer-pausado', cronometroEstado.status === 'pausado');
    if (bolha) bolha.classList.toggle('timer-rodando', cronometroEstado.status === 'rodando');
    if (bolha) bolha.classList.toggle('timer-pausado', cronometroEstado.status === 'pausado');
    if (bolhaIcone) {
        bolhaIcone.textContent = cronometroEstado.status === 'rodando' ? (emPomodoro && pomodoroEstado.fase === 'foco' ? '🍅' : '▶')
            : cronometroEstado.status === 'pausado' ? '⏸'
            : '⏱';
    }

    if (label) {
        if (emPomodoro && pomodoroEstado.fase) {
            label.textContent = cronometroEstado.status === 'rodando' ? `${pomodoroEstado.fase === 'foco' ? '🍅 Focando' : '☕ Em pausa'}...`
                : cronometroEstado.status === 'pausado' ? 'Pausado'
                : `Pronto para ${NOMES_FASE_POMODORO[pomodoroEstado.fase].toLowerCase()}`;
        } else {
            label.textContent = cronometroEstado.status === 'rodando' ? 'Estudando agora...'
                : cronometroEstado.status === 'pausado' ? 'Pausado'
                : 'Pronto para começar';
        }
    }

    renderizarConfigPomodoroInputs();
}

// Abre/fecha o painel completo do cronômetro (a bolha flutuante fica sempre
// visível mostrando o tempo; clicar nela revela os controles normais).
function alternarPainelTimer() {
    const card = document.getElementById('timer-card');
    if (!card) return;
    card.style.display = card.style.display === 'flex' ? 'none' : 'flex';
}

function iniciarIntervaloCronometro() {
    if (cronometroIntervalId) clearInterval(cronometroIntervalId);
    cronometroIntervalId = setInterval(() => {
        atualizarDisplayCronometro();
        verificarTransicaoPomodoro();
    }, 1000);
}

function pararIntervaloCronometro() {
    if (cronometroIntervalId) clearInterval(cronometroIntervalId);
    cronometroIntervalId = null;
}

function iniciarCronometro() {
    if (obterModoCronometro() === 'pomodoro' && !pomodoroEstado.fase) {
        // Início de um pomodoro novo (não é retomada de uma fase seguinte)
        pomodoroEstado = { fase: 'foco', cicloAtual: 0, focoAcumuladoMs: 0 };
        salvarPomodoroEstado();
    }
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
    pomodoroEstado = { fase: null, cicloAtual: 0, focoAcumuladoMs: 0 };
    salvarPomodoroEstado();
    pararIntervaloCronometro();
    atualizarBotoesCronometro();
    atualizarDisplayCronometro();
}

// Checa, a cada segundo, se a fase atual do pomodoro já bateu o tempo
// configurado; se sim, fecha a fase (soma no foco acumulado, se era foco),
// decide a próxima fase e PARA o cronômetro — a próxima fase só começa
// quando o usuário clicar em "Iniciar" de novo, pra não rodar sem controle
// com a aba em segundo plano.
function verificarTransicaoPomodoro() {
    if (obterModoCronometro() !== 'pomodoro' || cronometroEstado.status !== 'rodando' || !pomodoroEstado.fase) return;

    const elapsed = calcularElapsedMs();
    if (elapsed < duracaoFaseAtualMs()) return;

    const faseQueTerminou = pomodoroEstado.fase;
    if (faseQueTerminou === 'foco') {
        pomodoroEstado.focoAcumuladoMs = (pomodoroEstado.focoAcumuladoMs || 0) + duracaoFaseAtualMs();
        pomodoroEstado.cicloAtual += 1;
        const pausaLonga = pomodoroEstado.cicloAtual % pomodoroConfig.ciclosParaPausaLonga === 0;
        pomodoroEstado.fase = pausaLonga ? 'pausa-longa' : 'pausa-curta';
    } else {
        pomodoroEstado.fase = 'foco';
    }
    salvarPomodoroEstado();

    cronometroEstado = { status: 'parado', inicioSegmentoAtual: null, acumuladoMs: 0 };
    salvarCronometroEstado();
    pararIntervaloCronometro();
    atualizarBotoesCronometro();
    atualizarDisplayCronometro();

    mostrarToastPomodoro(
        faseQueTerminou === 'foco'
            ? `🍅 Foco concluído! Hora de ${pomodoroEstado.fase === 'pausa-longa' ? 'uma pausa longa' : 'uma pausa curta'}.`
            : '☕ Pausa concluída! Hora de focar de novo.'
    );
}

let pomodoroToastTimeoutId = null;

function mostrarToastPomodoro(mensagem) {
    const toast = document.getElementById('pomodoro-toast');
    if (toast) {
        toast.textContent = mensagem;
        toast.style.display = 'block';
        if (pomodoroToastTimeoutId) clearTimeout(pomodoroToastTimeoutId);
        pomodoroToastTimeoutId = setTimeout(() => { toast.style.display = 'none'; }, 6000);
    }

    tocarBipPomodoro();

    try {
        if (typeof Notification !== 'undefined') {
            if (Notification.permission === 'granted') {
                new Notification('checkEstudos', { body: mensagem });
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission();
            }
        }
    } catch (err) { /* notificações indisponíveis, segue só com o toast */ }
}

// Bipe curto e simples via Web Audio API — não depende de nenhum arquivo de som.
function tocarBipPomodoro() {
    try {
        const AudioContextClasse = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClasse) return;
        const ctx = new AudioContextClasse();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
    } catch (err) { /* áudio indisponível, segue só com o toast/notificação */ }
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

    // Fecha o painel flutuante do cronômetro (se estiver aberto) — não faz
    // sentido os dois abertos ao mesmo tempo.
    const timerCard = document.getElementById('timer-card');
    if (timerCard) timerCard.style.display = 'none';

    idSessaoEmEdicao = null;
    topicosExtrasSessaoEmEdicao = [];
    document.getElementById('modal-sessao-titulo').textContent = 'Finalizar sessão de estudo';
    document.getElementById('btn-salvar-sessao').textContent = 'Salvar sessão';

    // No modo Pomodoro, só o tempo de FOCO acumulado vira sessão de estudo
    // (as pausas ficam de fora da duração sugerida).
    const elapsedMs = obterModoCronometro() === 'pomodoro' ? calcularFocoTotalPomodoroMs() : calcularElapsedMs();
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

// Escopo do Resumo: "geral" (todos os planos/editais) ou o nome de um plano
// específico. Independente do "planoAtual" da barra lateral — esse seletor
// vive só na página de Resumo e não afeta Edital/Estudos/registro de sessão.
let resumoEscopo = localStorage.getItem('resumo_escopo') || 'geral';

function renderizarSeletorEscopoResumo() {
    const row = document.getElementById('resumo-escopo-row');
    if (!row) return;

    // Se o plano salvo como escopo não existe mais, volta pro geral.
    if (resumoEscopo !== 'geral' && !planosDisponiveis.some(p => p.nome === resumoEscopo)) {
        resumoEscopo = 'geral';
        localStorage.setItem('resumo_escopo', resumoEscopo);
    }

    const pills = [`
        <button type="button" class="escopo-pill${resumoEscopo === 'geral' ? ' ativo' : ''}" onclick="definirEscopoResumo('geral')">
            <span class="escopo-pill-icone">🌐</span> Geral
        </button>
    `].concat(planosDisponiveis.map(plano => `
        <button type="button" class="escopo-pill${resumoEscopo === plano.nome ? ' ativo' : ''}" onclick="definirEscopoResumo('${plano.nome.replace(/'/g, "\\'")}')">
            <span class="escopo-pill-icone">📘</span> ${plano.nome}
        </button>
    `));

    row.innerHTML = pills.join('');
}

async function definirEscopoResumo(escopo) {
    if (escopo === resumoEscopo) return;
    resumoEscopo = escopo;
    localStorage.setItem('resumo_escopo', resumoEscopo);
    await carregarResumo();
}

async function carregarSessoesResumo() {
    try {
        const url = resumoEscopo === 'geral'
            ? `/api/sessoes?limite=3000`
            : `/api/sessoes?plano=${encodeURIComponent(resumoEscopo)}&limite=3000`;
        const res = await fetch(url);
        sessoesCache = await res.json();
    } catch (err) {
        console.error("Erro ao carregar sessões do resumo:", err);
        sessoesCache = [];
    }
}

async function carregarResumo() {
    renderizarSeletorEscopoResumo();
    await Promise.all([carregarSessoesResumo(), carregarMateriasCores(), atualizarStreak()]);
    renderizarDashboardResumo();
    renderizarGraficoTrintaDias();
    renderizarGraficoMateriasEmpilhado();
    renderizarGraficoTiposEmpilhado();
    renderizarIndicadoresMaterias();
    renderizarMapaDificuldades();
    renderizarConquistas();
}

// ==================================================================
// MAPA DE DIFICULDADES (tópicos com maior taxa de erro em questões)
// ==================================================================
// As sessões guardam acertos/erros por SESSÃO, não por tópico individual
// (uma sessão pode cobrir vários tópicos de uma vez). Pra estimar a
// dificuldade por tópico, distribuímos o resultado da sessão igualmente
// entre os tópicos que ela tocou — a mesma lógica já usada para dividir
// o tempo estudado entre matérias (distribuirSegundosPorMateria).
function renderizarMapaDificuldades() {
    const container = document.getElementById('mapa-dificuldades');
    if (!container) return;

    const porTopico = {}; // topicoId -> { materia, topico, acertos, erros }

    sessoesCache.forEach(s => {
        if (s.acertos === null || s.acertos === undefined) return; // sessão sem desempenho em questões
        const topicos = s.topicos || [];
        if (topicos.length === 0) return; // sem tópico vinculado, não dá pra atribuir

        const acertosParte = s.acertos / topicos.length;
        const errosParte = (s.erros || 0) / topicos.length;

        topicos.forEach(t => {
            if (!porTopico[t.topicoId]) {
                porTopico[t.topicoId] = { materia: t.materia, topico: t.topico, acertos: 0, erros: 0 };
            }
            porTopico[t.topicoId].acertos += acertosParte;
            porTopico[t.topicoId].erros += errosParte;
        });
    });

    const lista = Object.values(porTopico)
        .map(t => ({ ...t, total: t.acertos + t.erros, taxaErro: (t.acertos + t.erros) > 0 ? t.erros / (t.acertos + t.erros) : 0 }))
        .filter(t => t.total >= 1) // pelo menos 1 questão registrada (mesmo que fracionada entre tópicos)
        .sort((a, b) => b.taxaErro - a.taxaErro || b.total - a.total)
        .slice(0, 8);

    if (lista.length === 0) {
        container.innerHTML = `<div class="lista-vazia">Registre sessões com acertos/erros vinculadas a tópicos para ver seu mapa de dificuldades aqui.</div>`;
        return;
    }

    container.innerHTML = lista.map(t => {
        const perc = Math.round(t.taxaErro * 100);
        return `
            <div class="dificuldade-linha">
                <div class="dificuldade-nomes">
                    <div class="dificuldade-topico" title="${t.topico}">${t.topico}</div>
                    <div class="dificuldade-materia">${t.materia}</div>
                    <div class="dificuldade-barra-fundo">
                        <div class="dificuldade-barra" style="width:${perc}%"></div>
                    </div>
                </div>
                <div class="dificuldade-taxa">${perc}% erro</div>
            </div>
        `;
    }).join('');
}

// ==================================================================
// CONQUISTAS / MEDALHAS
// ==================================================================
// Calculadas a partir de dados que já temos (streak, sessões, horas
// estudadas, progresso do edital) — nada fica salvo à parte, o "desbloqueio"
// é sempre recalculado com base no histórico real.

const DEFINICOES_CONQUISTAS = [
    { id: 'streak-1', emoji: '🔥', nome: 'Primeira Chama', desc: '1 dia seguido estudando', meta: s => s.streak >= 1 },
    { id: 'streak-7', emoji: '🔥', nome: 'Uma Semana Direto', desc: '7 dias seguidos estudando', meta: s => s.streak >= 7 },
    { id: 'streak-30', emoji: '🔥', nome: 'Um Mês de Fogo', desc: '30 dias seguidos estudando', meta: s => s.streak >= 30 },
    { id: 'sessao-1', emoji: '📚', nome: 'Primeira Sessão', desc: 'Registrou a 1ª sessão de estudo', meta: s => s.totalSessoes >= 1 },
    { id: 'sessao-50', emoji: '📚', nome: '50 Sessões', desc: '50 sessões de estudo registradas', meta: s => s.totalSessoes >= 50 },
    { id: 'sessao-100', emoji: '📚', nome: '100 Sessões', desc: '100 sessões de estudo registradas', meta: s => s.totalSessoes >= 100 },
    { id: 'horas-10', emoji: '⏱️', nome: '10 Horas Estudadas', desc: '10h de estudo acumuladas', meta: s => s.totalHoras >= 10 },
    { id: 'horas-50', emoji: '⏱️', nome: '50 Horas Estudadas', desc: '50h de estudo acumuladas', meta: s => s.totalHoras >= 50 },
    { id: 'horas-100', emoji: '⏱️', nome: '100 Horas Estudadas', desc: '100h de estudo acumuladas', meta: s => s.totalHoras >= 100 },
    { id: 'edital-10', emoji: '✅', nome: '10% do Edital', desc: 'Primeiros 10% do plano atual concluídos', meta: s => s.percEdital >= 10 },
    { id: 'edital-25', emoji: '✅', nome: '25% do Edital', desc: '1/4 do plano atual concluído', meta: s => s.percEdital >= 25 },
    { id: 'edital-50', emoji: '✅', nome: '50% do Edital', desc: 'Metade do plano atual concluído', meta: s => s.percEdital >= 50 },
    { id: 'edital-75', emoji: '✅', nome: '75% do Edital', desc: '3/4 do plano atual concluído', meta: s => s.percEdital >= 75 },
    { id: 'edital-100', emoji: '🏆', nome: '100% do Edital', desc: 'Plano atual 100% concluído', meta: s => s.percEdital >= 100 }
];

function calcularEstatisticasConquistas() {
    const totalSegundos = sessoesTodasCache.reduce((soma, s) => soma + (s.duracaoSegundos || 0), 0);
    const streakEl = document.getElementById('streak-numero');
    const streak = streakEl ? parseInt(streakEl.textContent) || 0 : 0;

    const totalItens = itensAtuais.length;
    const concluidos = itensAtuais.filter(i => i.concluido).length;
    const percEdital = totalItens > 0 ? (concluidos / totalItens) * 100 : 0;

    return {
        streak,
        totalSessoes: sessoesTodasCache.length,
        totalHoras: totalSegundos / 3600,
        percEdital
    };
}

// No Resumo mostramos só as conquistas já desbloqueadas (lista compacta) —
// a lista completa (desbloqueadas + bloqueadas) fica na aba "Conquistas".
function renderizarConquistas() {
    const container = document.getElementById('conquistas-grid');
    if (!container) return;

    const stats = calcularEstatisticasConquistas();
    const desbloqueadas = DEFINICOES_CONQUISTAS.filter(c => c.meta(stats));

    if (desbloqueadas.length === 0) {
        container.innerHTML = `<div class="conquistas-vazio">Ainda sem conquistas desbloqueadas — continue estudando! Veja todos os marcos em <button type="button" class="link-botao" onclick="trocarView('conquistas')">🏅 Conquistas</button>.</div>`;
        return;
    }

    container.innerHTML = desbloqueadas.map(c => `
        <div class="conquista-card conquistada" title="${c.desc}">
            <span class="conquista-emoji">${c.emoji}</span>
            <div class="conquista-nome">${c.nome}</div>
            <div class="conquista-desc">${c.desc}</div>
        </div>
    `).join('');
}

// Aba "Conquistas": TODAS as medalhas (desbloqueadas e bloqueadas), com
// contador e botão de compartilhar (Instagram Stories) nas já conquistadas.
function renderizarConquistasCompleto() {
    const container = document.getElementById('conquistas-grid-completo');
    if (!container) return;

    const stats = calcularEstatisticasConquistas();
    const desbloqueadas = DEFINICOES_CONQUISTAS.filter(c => c.meta(stats)).length;

    const contador = document.getElementById('conquistas-contador');
    if (contador) contador.textContent = `${desbloqueadas}/${DEFINICOES_CONQUISTAS.length} desbloqueadas`;

    container.innerHTML = DEFINICOES_CONQUISTAS.map(c => {
        const conquistada = c.meta(stats);
        return `
            <div class="conquista-card ${conquistada ? 'conquistada' : 'bloqueada'}" title="${c.desc}">
                <span class="conquista-emoji">${conquistada ? c.emoji : '🔒'}</span>
                <div class="conquista-nome">${c.nome}</div>
                <div class="conquista-desc">${c.desc}</div>
                ${conquistada ? `<button type="button" class="conquista-compartilhar" onclick="compartilharConquista('${c.id}', this)">📤 Compartilhar</button>` : ''}
            </div>
        `;
    }).join('');
}

async function abrirConquistas() {
    // Garante que sessoesTodasCache está atualizado mesmo se a pessoa abrir
    // essa aba sem antes passar pelo Resumo nessa sessão.
    await atualizarStreak();
    renderizarConquistasCompleto();
}

// ==================================================================
// COMPARTILHAR CONQUISTA — gera uma imagem no formato Instagram Stories
// (1080x1920) com a medalha, pra ajudar a divulgar o app.
// ==================================================================

// Quebra um texto em várias linhas dentro de uma largura máxima no canvas,
// centralizado horizontalmente em x, a partir de y (linha a linha).
function quebrarTextoCanvas(ctx, texto, x, y, larguraMax, alturaLinha, fonte, cor) {
    ctx.font = fonte;
    ctx.fillStyle = cor;
    ctx.textAlign = 'center';
    const palavras = texto.split(' ');
    const linhas = [];
    let linhaAtual = '';
    palavras.forEach(palavra => {
        const tentativa = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
        if (ctx.measureText(tentativa).width > larguraMax && linhaAtual) {
            linhas.push(linhaAtual);
            linhaAtual = palavra;
        } else {
            linhaAtual = tentativa;
        }
    });
    if (linhaAtual) linhas.push(linhaAtual);

    const yInicial = y - ((linhas.length - 1) * alturaLinha) / 2;
    linhas.forEach((linha, i) => ctx.fillText(linha, x, yInicial + i * alturaLinha));
}

async function compartilharConquista(id, botaoEl) {
    const def = DEFINICOES_CONQUISTAS.find(c => c.id === id);
    if (!def) return;
    const stats = calcularEstatisticasConquistas();
    if (!def.meta(stats)) return; // só compartilha o que já foi conquistado

    const textoOriginal = botaoEl ? botaoEl.textContent : '';
    if (botaoEl) { botaoEl.textContent = 'Gerando...'; botaoEl.disabled = true; }

    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');

        // Fundo: gradiente diagonal na identidade visual do app (azul → escuro),
        // sempre na mesma paleta de marca, independente do tema escolhido —
        // é uma imagem pra compartilhar fora do app.
        const fundo = ctx.createLinearGradient(0, 0, 1080, 1920);
        fundo.addColorStop(0, '#1d4ed8');
        fundo.addColorStop(0.55, '#3b82f6');
        fundo.addColorStop(1, '#0f172a');
        ctx.fillStyle = fundo;
        ctx.fillRect(0, 0, 1080, 1920);

        // Círculos decorativos translúcidos.
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(120, 220, 260, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(980, 1700, 340, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Selo dourado com o emoji da conquista.
        ctx.save();
        ctx.beginPath();
        ctx.arc(540, 760, 220, 0, Math.PI * 2);
        const selo = ctx.createLinearGradient(320, 540, 760, 980);
        selo.addColorStop(0, '#f6d365');
        selo.addColorStop(1, '#c9962b');
        ctx.fillStyle = selo;
        ctx.fill();
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '190px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
        ctx.fillText(def.emoji, 540, 775);
        ctx.textBaseline = 'alphabetic';

        ctx.font = '700 34px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('CONQUISTA DESBLOQUEADA', 540, 1060);

        quebrarTextoCanvas(ctx, def.nome, 540, 1150, 900, 80, '800 76px Inter, sans-serif', '#ffffff');
        quebrarTextoCanvas(ctx, def.desc, 540, 1330, 820, 54, '400 40px Inter, sans-serif', 'rgba(255,255,255,0.85)');

        ctx.font = '700 46px Inter, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Direto à Posse', 540, 1780);
        ctx.font = '400 30px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('Rumo à aprovação 🎯', 540, 1830);

        await new Promise(resolve => {
            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `conquista-${def.id}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);
                resolve();
            }, 'image/png');
        });
    } catch (err) {
        console.error('Erro ao gerar imagem da conquista:', err);
    } finally {
        if (botaoEl) { botaoEl.textContent = textoOriginal; botaoEl.disabled = false; }
    }
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
    let totalQuestoesJogo = 0;
    let totalAcertosJogo = 0;
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
            // Sessões do tipo "Jogo" ficam de fora de "Questões resolvidas" —
            // têm seu próprio card ("Jogos resolvidos"), separado dos
            // exercícios/simulados de estudo de verdade.
            if (s.tipoEstudoNome === 'Jogo') {
                totalQuestoesJogo += s.acertos + (s.erros || 0);
                totalAcertosJogo += s.acertos;
            } else {
                totalQuestoes += s.acertos + (s.erros || 0);
                totalAcertos += s.acertos;
            }
        }
    });

    const mediaSegundosPorDia = diasComEstudo.size > 0 ? totalSegundos / diasComEstudo.size : 0;
    const ritmoLeitura = totalPaginasLeitura > 0 ? totalSegundosLeitura / totalPaginasLeitura : null;
    const percAcerto = totalQuestoes > 0 ? Math.round((totalAcertos / totalQuestoes) * 100) : null;
    const percAcertoJogo = totalQuestoesJogo > 0 ? Math.round((totalAcertosJogo / totalQuestoesJogo) * 100) : null;

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
        ${totalQuestoesJogo > 0 ? `
        <div class="stat-card">
            <span class="stat-card-label">🎮 Jogos resolvidos</span>
            <span class="stat-card-valor">${totalQuestoesJogo}</span>
            ${percAcertoJogo !== null ? `<span class="stat-card-extra">${percAcertoJogo}% de acerto</span>` : ''}
        </div>` : ''}
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
    let semMateriaSegundos = 0;
    sessoesCache.forEach(s => {
        const partes = distribuirSegundosPorMateria(s);
        const materiasDaSessao = Object.keys(partes);
        if (materiasDaSessao.length === 0) {
            semMateriaSegundos += s.duracaoSegundos;
        } else {
            materiasDaSessao.forEach(m => {
                segundosPorMateria[m] = (segundosPorMateria[m] || 0) + partes[m];
            });
        }
    });

    // Garante que matérias do edital sem tempo registrado ainda apareçam na lista
    const materiasEdital = new Set(itensAtuais.map(i => i.materia));
    materiasEdital.forEach(m => { if (!(m in segundosPorMateria)) segundosPorMateria[m] = 0; });

    const materiasOrdenadas = Object.entries(segundosPorMateria).sort((a, b) => b[1] - a[1]);
    if (semMateriaSegundos > 0) materiasOrdenadas.push(['__sem_materia__', semMateriaSegundos]);

    if (materiasOrdenadas.length === 0) {
        container.innerHTML = `<div class="lista-vazia">Cadastre matérias no Edital para ver os indicadores aqui.</div>`;
        return;
    }

    const maxSegundos = Math.max(...materiasOrdenadas.map(([, s]) => s), 1);
    const { segundos: segundosPorTopico, info: infoTopico } = construirSegundosPorTopico();

    container.innerHTML = materiasOrdenadas.map(([materia, segundos]) => {
        const isSemMateria = materia === '__sem_materia__';
        const nomeExibido = isSemMateria ? 'Sem matéria vinculada' : materia;
        const cor = isSemMateria ? '#cbd5e1' : corDaMateria(materia);
        const perc = Math.round((segundos / maxSegundos) * 100);
        const materiaEscapada = materia.replace(/'/g, "\\'");
        const expandida = !isSemMateria && materiasExpandidasIndicador.has(materia);
        const topicosDaMateria = expandida ? obterTopicosDaMateriaParaIndicador(materia, segundosPorTopico, infoTopico) : [];
        const maxSegundosTopico = Math.max(...topicosDaMateria.map(t => t.segundos), 1);

        if (isSemMateria) {
            return `
                <div class="materia-indicador">
                    <div class="materia-cor-swatch" style="background:${cor}" title="${nomeExibido}"></div>
                    <div class="materia-indicador-corpo">
                        <div class="materia-indicador-topo">
                            <span class="materia-indicador-nome">${nomeExibido}</span>
                            <span class="materia-indicador-tempo">${segundos > 0 ? formatarDuracaoCurta(segundos) : '—'}</span>
                        </div>
                        <div class="materia-indicador-barra-fundo">
                            <div class="materia-indicador-barra" style="width:${perc}%; background:${cor}"></div>
                        </div>
                    </div>
                </div>
            `;
        }

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
