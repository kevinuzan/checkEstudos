// --- SEGURANÇA: escapar texto vindo de fora antes de inserir no HTML ---
// Matéria/tópico/subtópico do Edital podem vir de um PDF processado por IA
// (sugestão de edital via PDF) — ou seja, o TEXTO É EFETIVAMENTE
// CONTROLÁVEL por quem monta o PDF. Sem escapar, um PDF malicioso poderia
// instruir a IA a devolver um "tópico" contendo HTML/JS (ex: uma tag
// <img onerror=...>), que rodaria no navegador de quem importou o edital
// quando a lista fosse exibida. Usar sempre que um desses textos for
// inserido via innerHTML/template string.
function escaparHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Pra texto que vai DENTRO de um onclick="...('${x}')": escapa primeiro pro
// contexto de string JS (aspas simples/barra invertida) e depois pro
// contexto de atributo HTML (protege contra a própria string quebrar o
// atributo com uma aspas dupla, escapando pra fora do onclick).
function escaparParaOnclick(str) {
    const paraJs = String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return escaparHtml(paraJs);
}

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

// Tópicos com subtópicos expandidos no Edital (não persiste — some ao recarregar a página)
let topicosExpandidosEdital = new Set();

// View ativa: "resumo", "edital" ou "estudos"
let viewAtual = 'resumo';

// Jogo escolhido na tela de seleção, aguardando a resposta do modal
// "iniciar o cronômetro?" antes de efetivamente abrir o iframe.
let jogoTipoPendente = null;

// Filtro de jogos por plano ("geral" ou o nome de um plano específico),
// mostrado no cabeçalho da aba Jogo. Persiste entre sessões.
let jogoFiltroPlano = localStorage.getItem('jogo_filtro_plano') || 'geral';

// Filtro de baralhos por matéria ("geral" ou o nome de uma matéria específica),
// mostrado no cabeçalho da aba Flashcards. Persiste entre sessões.
let flashcardsFiltroMateria = localStorage.getItem('flashcards_filtro_materia') || 'geral';

async function iniciar() {
    renderizarSeletorTema();
    renderizarSeletorFundo();
    atualizarRotuloFonteEscala();
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

// --- TAMANHO DO TEXTO (controle único, vale pro app inteiro) ---
// Usa a propriedade CSS "zoom" no <html> (ver style.css), que amplia a
// página toda de forma proporcional — texto, espaçamentos, ícones — sem
// precisar mexer em cada font-size do site. Guardado no localStorage,
// aplicado também no <script> do <head> (antes da página desenhar) pra não
// "piscar" no tamanho padrão a cada carregamento.
const FONTE_ESCALA_KEY = 'checkestudos_fonte_escala';
const FONTE_ESCALA_MIN = 0.8;
const FONTE_ESCALA_MAX = 1.5;
const FONTE_ESCALA_PADRAO = 1;

function obterFonteEscalaSalva() {
    try {
        const salvo = parseFloat(localStorage.getItem(FONTE_ESCALA_KEY));
        return Number.isFinite(salvo) ? salvo : FONTE_ESCALA_PADRAO;
    } catch (err) {
        return FONTE_ESCALA_PADRAO;
    }
}

function aplicarFonteEscala(escala) {
    const valor = Math.round(Math.min(FONTE_ESCALA_MAX, Math.max(FONTE_ESCALA_MIN, escala)) * 100) / 100;
    document.documentElement.style.setProperty('--fonte-escala', valor);
    try { localStorage.setItem(FONTE_ESCALA_KEY, String(valor)); } catch (err) { /* segue sem salvar */ }
    atualizarRotuloFonteEscala();
}

function ajustarFonteEscala(delta) {
    aplicarFonteEscala(obterFonteEscalaSalva() + delta);
}

function redefinirFonteEscala() {
    aplicarFonteEscala(FONTE_ESCALA_PADRAO);
}

function atualizarRotuloFonteEscala() {
    const el = document.getElementById('fonte-escala-valor');
    if (el) el.textContent = `${Math.round(obterFonteEscalaSalva() * 100)}%`;
}

// --- TAMANHO DO TEXTO DO CARTÃO (só o campo de digitação do modal "Novo cartão") ---
// Controle separado do de cima: mexe só no font-size do ".editor-campo" (ver
// style.css), sem dar zoom no resto do modal. Também guardado no localStorage
// e restaurado cedo no <script> do <head>, pra não "piscar" no tamanho padrão.
const FONTE_EDITOR_ESCALA_KEY = 'checkestudos_fonte_editor_escala';
const FONTE_EDITOR_ESCALA_MIN = 0.8;
const FONTE_EDITOR_ESCALA_MAX = 2;
const FONTE_EDITOR_ESCALA_PADRAO = 1;

function obterFonteEditorEscalaSalva() {
    try {
        const salvo = parseFloat(localStorage.getItem(FONTE_EDITOR_ESCALA_KEY));
        return Number.isFinite(salvo) ? salvo : FONTE_EDITOR_ESCALA_PADRAO;
    } catch (err) {
        return FONTE_EDITOR_ESCALA_PADRAO;
    }
}

function aplicarFonteEditorEscala(escala) {
    const valor = Math.round(Math.min(FONTE_EDITOR_ESCALA_MAX, Math.max(FONTE_EDITOR_ESCALA_MIN, escala)) * 100) / 100;
    document.documentElement.style.setProperty('--fonte-editor-escala', valor);
    try { localStorage.setItem(FONTE_EDITOR_ESCALA_KEY, String(valor)); } catch (err) { /* segue sem salvar */ }
}

function ajustarFonteEditorCartao(delta) {
    aplicarFonteEditorEscala(obterFonteEditorEscalaSalva() + delta);
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

// Visual igual ao das pílulas do Resumo (escopo-pill) — só que aqui é sempre
// um plano por vez (sem "Geral"). O botão de renomear (✎) só aparece na aba
// Edital, que é onde faz sentido editar o edital em si.
function renderizarTabsPlanos() {
    const nav = document.getElementById('planos-tabs');
    if (!nav) return;
    nav.innerHTML = '';

    const mostrarRenomear = viewAtual === 'edital';

    planosDisponiveis.forEach(plano => {
        const wrap = document.createElement('div');
        wrap.className = 'plano-tab-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'escopo-pill' + (plano.nome === planoAtual ? ' ativo' : '');
        btn.innerHTML = `<span class="escopo-pill-icone">📘</span> ${plano.nome}`;
        btn.onclick = () => trocarPlano(plano.nome);
        wrap.appendChild(btn);

        if (mostrarRenomear) {
            const btnRenomear = document.createElement('button');
            btnRenomear.type = 'button';
            btnRenomear.className = 'plano-tab-renomear';
            btnRenomear.textContent = '✎';
            btnRenomear.title = `Renomear "${plano.nome}"`;
            btnRenomear.onclick = (ev) => { ev.stopPropagation(); renomearPlano(plano.nome); };
            wrap.appendChild(btnRenomear);

            const btnExcluir = document.createElement('button');
            btnExcluir.type = 'button';
            btnExcluir.className = 'plano-tab-excluir';
            btnExcluir.textContent = '🗑️';
            btnExcluir.title = `Excluir "${plano.nome}"`;
            btnExcluir.onclick = (ev) => { ev.stopPropagation(); excluirPlano(plano.nome); };
            wrap.appendChild(btnExcluir);
        }

        nav.appendChild(wrap);
    });

    const btnNovo = document.createElement('button');
    btnNovo.type = 'button';
    btnNovo.className = 'escopo-pill plano-tab-novo';
    btnNovo.textContent = '+ Novo plano';
    btnNovo.onclick = criarPlano;
    nav.appendChild(btnNovo);
}

// Renomeia um plano (edital) já existente — o backend já cuida de atualizar
// o nome em todos os tópicos que referenciam esse plano, então aqui é só
// recarregar tudo depois de confirmar.
async function renomearPlano(nomeAtual) {
    const novoNome = prompt('Novo nome para este plano/edital:', nomeAtual);
    if (!novoNome || !novoNome.trim() || novoNome.trim() === nomeAtual) return;
    const nomeFinal = novoNome.trim();

    if (planosDisponiveis.some(p => p.nome === nomeFinal)) {
        return alert(`Já existe um plano chamado "${nomeFinal}".`);
    }

    const res = await fetch(`/api/planos/${encodeURIComponent(nomeAtual)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeFinal })
    });
    const resultado = await res.json();
    if (!resultado.success) return alert(resultado.error || 'Não foi possível renomear o plano.');

    if (planoAtual === nomeAtual) {
        planoAtual = nomeFinal;
        localStorage.setItem('edital_plano_atual', planoAtual);
    }

    await carregarPlanos();
    await carregarEdital();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();
}

// Exclui um plano de estudos. O backend já cuida de: apagar os tópicos que
// pertenciam SOMENTE a esse plano, e apenas desvincular (mantendo) os que são
// compartilhados com outros planos. Não deixa excluir o último plano restante,
// já que o app sempre espera ter pelo menos um.
async function excluirPlano(nome) {
    if (planosDisponiveis.length <= 1) {
        alert('Não é possível excluir o único plano de estudos que você tem. Crie outro plano antes de excluir este.');
        return;
    }

    const confirmar = confirm(
        `Excluir o plano "${nome}"?\n\n` +
        `Tópicos que pertencem SOMENTE a esse plano serão apagados. Tópicos ` +
        `compartilhados com outros planos continuam existindo normalmente neles.\n\n` +
        `Essa ação não pode ser desfeita.`
    );
    if (!confirmar) return;

    const res = await fetch(`/api/planos/${encodeURIComponent(nome)}`, { method: 'DELETE' });
    const resultado = await res.json();
    if (!resultado.success) {
        alert(resultado.error || 'Não foi possível excluir o plano.');
        return;
    }

    if (planoAtual === nome) {
        planoAtual = null;
        localStorage.removeItem('edital_plano_atual');
    }

    await carregarPlanos();
    await carregarEdital();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();
}

async function trocarPlano(nome) {
    if (nome === planoAtual) return;
    planoAtual = nome;
    localStorage.setItem('edital_plano_atual', planoAtual);
    modoSelecaoEdital = false;
    itensSelecionadosEdital.clear();
    atualizarBarraSelecaoEdital();
    renderizarTabsPlanos();
    atualizarCabecalhoPlanoAtual();
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

// Conta quantas "unidades" de progresso um tópico representa e quantas já
// foram concluídas — um tópico normal vale 1 unidade (seu próprio check);
// um tópico com subtópicos vale um pra cada subtópico (o check do tópico em
// si deixa de existir, ele vira só um container).
function contarProgressoItem(item) {
    if (Array.isArray(item.subtopicos) && item.subtopicos.length > 0) {
        return { total: item.subtopicos.length, concluidos: item.subtopicos.filter(s => s.concluido).length };
    }
    return { total: 1, concluidos: item.concluido ? 1 : 0 };
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
    let totalGeral = 0;
    let concluidosGeral = 0;
    itens.forEach(item => {
        const { total, concluidos } = contarProgressoItem(item);
        totalGeral += total;
        concluidosGeral += concluidos;
    });

    for (const materia in grupos) {
        // Por padrão as matérias começam fechadas (menos poluição visual ao
        // abrir a aba) — só ficam abertas se a pessoa já clicou pra expandir
        // antes (fica salvo por matéria no localStorage).
        const estaMinimizado = materia in estadosMinimizados ? estadosMinimizados[materia] : true;
        let totalMat = 0;
        let concluidosMat = 0;
        grupos[materia].forEach(item => {
            const { total, concluidos } = contarProgressoItem(item);
            totalMat += total;
            concluidosMat += concluidos;
        });

        // CÁLCULO DA PORCENTAGEM DA MATÉRIA
        const percMat = totalMat > 0 ? Math.round((concluidosMat / totalMat) * 100) : 0;

        const divMateria = document.createElement('div');
        divMateria.className = 'materia-group';

        divMateria.innerHTML = `
            <div class="materia-header" onclick="toggleMateria('${escaparParaOnclick(materia)}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                <div class="materia-info">
                    <span class="seta">${estaMinimizado ? '▶' : '▼'}</span>
                    <strong class="materia-title">${escaparHtml(materia)}</strong>
                    <button type="button" class="btn-renomear-materia" title="Renomear matéria &quot;${escaparHtml(materia)}&quot;"
                        onclick="event.stopPropagation(); renomearMateria('${escaparParaOnclick(materia)}')">✎</button>
                    <span class="stats-label">(${concluidosMat}/${totalMat}) - ${percMat}%</span>
                </div>
                <button type="button" class="btn-add-topico-materia" title="Adicionar tópico em ${escaparHtml(materia)}"
                    onclick="event.stopPropagation(); abrirModalNovoTopico('${escaparParaOnclick(materia)}')">+ Tópico</button>
            </div>
            <div class="materia-content" style="display: ${estaMinimizado ? 'none' : 'block'}">
                ${grupos[materia].map(item => renderizarItemEdital(item)).join('')}
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

// Renderiza uma linha de tópico do Edital — com subtópicos (container
// expansível, sem check próprio) ou sem (item normal, como sempre foi).
function renderizarItemEdital(item) {
    const temSubtopicos = Array.isArray(item.subtopicos) && item.subtopicos.length > 0;
    const badgePlanos = item.planos && item.planos.length > 1
        ? `<span class="badge-compartilhado" title="Compartilhado entre: ${item.planos.join(', ')}">⇄ ${item.planos.join(' + ')}</span>`
        : '';

    if (temSubtopicos) {
        const concluidosSub = item.subtopicos.filter(s => s.concluido).length;
        const totalSub = item.subtopicos.length;
        const expandido = topicosExpandidosEdital.has(item._id);

        return `
            <div class="item-check item-com-subtopicos ${modoSelecaoEdital && itensSelecionadosEdital.has(item._id) ? 'selecionado' : ''}">
                <div class="topico-com-subtopicos-header" onclick="${modoSelecaoEdital ? `toggleSelecaoItemEdital('${item._id}', !itensSelecionadosEdital.has('${item._id}'))` : `toggleSubtopicosExpandido('${item._id}')`}">
                    ${modoSelecaoEdital ? `
                        <input type="checkbox" class="checkbox-selecao-item" ${itensSelecionadosEdital.has(item._id) ? 'checked' : ''}
                            onclick="event.stopPropagation()" onchange="toggleSelecaoItemEdital('${item._id}', this.checked)">
                    ` : `<span class="seta-subtopicos">${expandido ? '▾' : '▸'}</span>`}
                    <span class="topico-texto">
                        ${escaparHtml(item.topico)}
                        <span class="subtopicos-contador">(${concluidosSub}/${totalSub})</span>
                        ${badgePlanos}
                    </span>
                    ${modoSelecaoEdital ? '' : `
                        <div class="actions">
                            <button class="btn-edit" onclick="event.stopPropagation(); abrirModalEdicao('${item._id}')">✎</button>
                            <button class="btn-delete" onclick="event.stopPropagation(); deletarTopico('${item._id}')">🗑️</button>
                        </div>
                    `}
                </div>
                ${expandido && !modoSelecaoEdital ? `
                    <div class="subtopicos-lista">
                        ${item.subtopicos.map(sub => `
                            <div class="subtopico-item ${sub.concluido ? 'done' : ''}">
                                <input type="checkbox" ${sub.concluido ? 'checked' : ''}
                                    onchange="toggleCheckSubtopico('${item._id}', '${sub.id}', this.checked)">
                                <span class="subtopico-texto">${escaparHtml(sub.texto)}</span>
                                <button type="button" class="btn-delete-subtopico" onclick="removerSubtopico('${item._id}', '${sub.id}')" title="Remover subtópico">✕</button>
                            </div>
                        `).join('')}
                        <div class="subtopico-add-linha">
                            <textarea id="novo-subtopico-${item._id}" placeholder="Novo(s) subtópico(s) — um por linha" rows="2"></textarea>
                            <button type="button" class="btn-secundario" onclick="adicionarSubtopicos('${item._id}')">+ Adicionar</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Um tópico "normal" (sem subtópicos ainda) também pode ganhar
    // subtópicos digitados livremente — não só dividindo o texto por ";".
    // A caixinha de adicionar abre/fecha reaproveitando o mesmo Set de
    // "expandidos" usado pelos tópicos que já têm subtópicos.
    const caixaAddAberta = topicosExpandidosEdital.has(item._id);

    return `
        <div class="item-check ${item.concluido ? 'done' : ''} ${modoSelecaoEdital && itensSelecionadosEdital.has(item._id) ? 'selecionado' : ''}">
            ${modoSelecaoEdital ? `
                <input type="checkbox" class="checkbox-selecao-item" ${itensSelecionadosEdital.has(item._id) ? 'checked' : ''}
                    onchange="toggleSelecaoItemEdital('${item._id}', this.checked)">
            ` : `
                <input type="checkbox" ${item.concluido ? 'checked' : ''}
                    onchange="toggleCheck('${item._id}', this.checked)">
            `}
            <span class="topico-texto" onclick="${modoSelecaoEdital ? `toggleSelecaoItemEdital('${item._id}', !itensSelecionadosEdital.has('${item._id}'))` : `abrirModalEdicao('${item._id}')`}">
                ${escaparHtml(item.topico)}
                ${badgePlanos}
            </span>
            ${modoSelecaoEdital ? '' : `
                <div class="actions">
                    <button class="btn-quebrar" onclick="toggleSubtopicosExpandido('${item._id}')" title="Adicionar subtópico(s) a esse tópico">➕≡</button>
                    <button class="btn-edit" onclick="abrirModalEdicao('${item._id}')">✎</button>
                    <button class="btn-delete" onclick="deletarTopico('${item._id}')">🗑️</button>
                </div>
            `}
        </div>
        ${caixaAddAberta && !modoSelecaoEdital ? `
            <div class="subtopico-add-linha subtopico-add-linha-solta">
                <textarea id="novo-subtopico-${item._id}" placeholder="Novo(s) subtópico(s) — um por linha" rows="2"></textarea>
                <div class="subtopico-add-linha-acoes">
                    <button type="button" class="btn-secundario" onclick="adicionarSubtopicos('${item._id}')">+ Adicionar</button>
                    <button type="button" class="btn-quebrar" onclick="quebrarEmSubtopicos('${item._id}')" title="Em vez de digitar, dividir o texto atual do tópico (separado por ;) em subtópicos">⋮≡ Dividir texto atual</button>
                </div>
            </div>
        ` : ''}
    `;
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

// --- SUBTÓPICOS ---
// Um tópico com texto corrido demais (várias coisas separadas por ";")
// pode ser dividido em vários subtópicos, cada um com seu próprio check.

function toggleSubtopicosExpandido(id) {
    if (topicosExpandidosEdital.has(id)) topicosExpandidosEdital.delete(id);
    else topicosExpandidosEdital.add(id);
    carregarEdital();
}

async function toggleCheckSubtopico(topicoId, subId, concluido) {
    await fetch(`/api/edital/item/${topicoId}/subtopicos/${subId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concluido })
    });
    carregarEdital();
}

async function adicionarSubtopicos(topicoId) {
    const textarea = document.getElementById(`novo-subtopico-${topicoId}`);
    if (!textarea) return;
    const textos = textarea.value.split('\n').map(t => t.trim()).filter(t => t !== '');
    if (textos.length === 0) return;

    await fetch(`/api/edital/item/${topicoId}/subtopicos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textos })
    });
    topicosExpandidosEdital.add(topicoId);
    carregarEdital();
}

async function removerSubtopico(topicoId, subId) {
    if (!confirm('Remover esse subtópico?')) return;
    await fetch(`/api/edital/item/${topicoId}/subtopicos/${subId}`, { method: 'DELETE' });
    topicosExpandidosEdital.add(topicoId);
    carregarEdital();
}

// Divide o texto atual do tópico em vários subtópicos, separando por ";" —
// pensado pra casos tipo "Coesão e coerência textuais; mecanismos de
// referenciação, substituição e retomada; conectores e sequenciação
// textual; tempos e modos verbais". O texto do tópico principal continua o
// mesmo depois (pode ser encurtado depois, editando pelo ✎), só os
// subtópicos são criados.
async function quebrarEmSubtopicos(id) {
    const item = itensAtuais.find(i => i._id === id);
    if (!item) return;

    const partes = (item.topico || '').split(';').map(p => p.trim()).filter(p => p !== '');
    if (partes.length < 2) {
        return alert('Não encontrei pelo menos 2 partes separadas por ";" no texto desse tópico. Se quiser, edite o texto do tópico (✎) separando as partes por ";" e tente de novo.');
    }

    if (!confirm(`Isso vai criar ${partes.length} subtópicos a partir desse texto:\n\n${partes.map(p => `• ${p}`).join('\n')}\n\nO texto do tópico principal continua o mesmo (você pode encurtar depois, editando com o ✎). Continuar?`)) {
        return;
    }

    await fetch(`/api/edital/item/${id}/subtopicos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textos: partes })
    });
    topicosExpandidosEdital.add(id);
    carregarEdital();
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

// Renomeia uma matéria — vale pra TODOS os planos que compartilham essa
// matéria (ela não é vinculada a um plano só), já que é só um texto comum a
// vários tópicos. A cor customizada da matéria (se tiver) migra junto.
async function renomearMateria(materiaAtual) {
    const novoNome = prompt(`Novo nome para a matéria "${materiaAtual}" (isso muda o nome em todos os planos que usam essa matéria):`, materiaAtual);
    if (!novoNome || !novoNome.trim() || novoNome.trim() === materiaAtual) return;
    const nomeFinal = novoNome.trim();

    const res = await fetch('/api/edital/materia', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materiaAtual, novoNome: nomeFinal })
    });
    const resultado = await res.json();
    if (!resultado.success) return alert(resultado.error || 'Não foi possível renomear a matéria.');

    // Preserva o estado de aberta/fechada da matéria com o novo nome
    if (materiaAtual in estadosMinimizados) {
        estadosMinimizados[nomeFinal] = estadosMinimizados[materiaAtual];
        delete estadosMinimizados[materiaAtual];
        localStorage.setItem('editais_minimizados', JSON.stringify(estadosMinimizados));
    }

    await carregarMateriasCores();
    await carregarEdital();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();
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

// --- SUGESTÃO DE EDITAL A PARTIR DE PDF (IA) ---
// Manda o PDF pro servidor, que extrai o texto e pede pra IA organizar em
// matérias/tópicos. O resultado é só uma sugestão editável — nada é salvo
// no banco até a pessoa revisar e confirmar a importação no modal.

let sugestaoEditalAtual = null; // { formato, nomeEdital, materias: [{materia, topicos}] }
let sugestaoPdfProgressoIntervalo = null;

// Não temos progresso real do servidor (é uma única chamada que só responde
// no final), então simula um avanço que desacelera perto do topo — sobe
// rápido no começo e vai ficando mais devagar, sem nunca completar sozinho,
// só "arrematando" pra 100% quando a resposta chega de verdade.
function iniciarProgressoSugestaoPdf() {
    const barra = document.getElementById('sugestao-pdf-progresso-barra');
    const fundo = document.getElementById('sugestao-pdf-progresso-fundo');
    if (!barra || !fundo) return;

    let progresso = 0;
    fundo.style.display = 'block';
    barra.style.width = '0%';

    if (sugestaoPdfProgressoIntervalo) clearInterval(sugestaoPdfProgressoIntervalo);
    sugestaoPdfProgressoIntervalo = setInterval(() => {
        const restante = 92 - progresso;
        progresso += Math.max(0.3, restante * 0.06);
        if (progresso > 92) progresso = 92;
        barra.style.width = `${progresso}%`;
    }, 400);
}

function finalizarProgressoSugestaoPdf(sucesso) {
    if (sugestaoPdfProgressoIntervalo) {
        clearInterval(sugestaoPdfProgressoIntervalo);
        sugestaoPdfProgressoIntervalo = null;
    }
    const barra = document.getElementById('sugestao-pdf-progresso-barra');
    const fundo = document.getElementById('sugestao-pdf-progresso-fundo');
    if (!barra || !fundo) return;
    if (sucesso) {
        barra.style.width = '100%';
        setTimeout(() => { fundo.style.display = 'none'; barra.style.width = '0%'; }, 500);
    } else {
        fundo.style.display = 'none';
        barra.style.width = '0%';
    }
}

async function gerarSugestaoEditalPdf(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    const nomeEl = document.getElementById('edital-pdf-nome');
    const statusEl = document.getElementById('sugestao-pdf-status');
    const botaoLabel = document.querySelector('label[for="edital-pdf-input"]');
    if (nomeEl) nomeEl.textContent = arquivo.name;
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent = '🧠 Lendo o PDF e gerando a sugestão... isso pode levar até 1 minuto.';
    }
    if (botaoLabel) botaoLabel.classList.add('arquivo-botao-desabilitado');
    iniciarProgressoSugestaoPdf();

    try {
        const formData = new FormData();
        formData.append('arquivo', arquivo);

        const res = await fetch('/api/edital/sugestao-pdf', { method: 'POST', body: formData });
        const resultado = await res.json();

        event.target.value = '';
        if (nomeEl) nomeEl.textContent = 'Nenhum arquivo selecionado';
        if (statusEl) statusEl.style.display = 'none';
        if (botaoLabel) botaoLabel.classList.remove('arquivo-botao-desabilitado');
        finalizarProgressoSugestaoPdf(resultado.success);

        if (!resultado.success) {
            alert(resultado.error || 'Não foi possível gerar a sugestão a partir desse PDF.');
            return;
        }

        abrirModalSugestaoEdital(resultado.dados);
    } catch (err) {
        console.error('Erro ao gerar sugestão de edital a partir de PDF:', err);
        event.target.value = '';
        if (nomeEl) nomeEl.textContent = 'Nenhum arquivo selecionado';
        if (statusEl) statusEl.style.display = 'none';
        if (botaoLabel) botaoLabel.classList.remove('arquivo-botao-desabilitado');
        finalizarProgressoSugestaoPdf(false);
        alert('Não foi possível processar esse PDF agora.');
    }
}

function abrirModalSugestaoEdital(dados) {
    sugestaoEditalAtual = dados;
    document.getElementById('sugestao-plano-input').value = dados.nomeEdital || planoAtual;
    renderizarBlocosMateriaSugestao();
    document.getElementById('modal-sugestao-edital-overlay').style.display = 'flex';
}

function fecharModalSugestaoEdital() {
    sugestaoEditalAtual = null;
    document.getElementById('modal-sugestao-edital-overlay').style.display = 'none';
}

// Um tópico sugerido pode vir como string solta (formato antigo/manual) ou
// como {topico, subtopicos} (formato novo, usado pela sugestão via PDF —
// já divide o parágrafo denso do edital em partes menores e legíveis). Pra
// continuar editável como texto simples (igual sempre foi), cada subtópico
// vira uma linha indentada logo abaixo do tópico principal.
function formatarTopicosParaTextarea(topicos) {
    return (topicos || []).map(t => {
        if (typeof t === 'string') return t;
        const linhas = [(t.topico || '').trim()];
        (t.subtopicos || []).forEach(s => { if ((s || '').trim()) linhas.push(`    - ${s.trim()}`); });
        return linhas.join('\n');
    }).filter(bloco => bloco.trim() !== '').join('\n');
}

// Lê de volta o texto editado: uma linha sem indentação é um novo tópico;
// uma linha indentada (começando com espaços/tab, com ou sem "-") vira
// subtópico do tópico anterior.
function lerTopicosDoTextarea(texto) {
    const topicos = [];
    for (const linhaBruta of texto.split('\n')) {
        if (linhaBruta.trim() === '') continue;
        const ehSubtopico = /^\s+/.test(linhaBruta) && topicos.length > 0;
        if (ehSubtopico) {
            const conteudo = linhaBruta.replace(/^\s+[-•]?\s*/, '').trim();
            if (conteudo) topicos[topicos.length - 1].subtopicos.push(conteudo);
        } else {
            topicos.push({ topico: linhaBruta.trim(), subtopicos: [] });
        }
    }
    return topicos;
}

function renderizarBlocosMateriaSugestao() {
    const container = document.getElementById('sugestao-materias-lista');
    if (!container || !sugestaoEditalAtual) return;
    container.innerHTML = sugestaoEditalAtual.materias.map((bloco, i) => `
        <div class="sugestao-materia-bloco">
            <div class="sugestao-materia-topo">
                <input type="text" class="sugestao-materia-nome" data-indice="${i}" value="${escaparHtml(bloco.materia || '')}" placeholder="Nome da matéria">
                <button type="button" class="btn-remover-materia-sugestao" onclick="removerBlocoMateriaSugestao(${i})" title="Remover matéria">🗑️</button>
            </div>
            <textarea class="sugestao-materia-topicos" data-indice="${i}" placeholder="Um tópico por linha. Linhas indentadas (com espaço/tab antes) viram subtópicos do tópico logo acima.">${escaparHtml(formatarTopicosParaTextarea(bloco.topicos))}</textarea>
        </div>
    `).join('');
}

function adicionarBlocoMateriaSugestao() {
    if (!sugestaoEditalAtual) return;
    sincronizarBlocosMateriaSugestao();
    sugestaoEditalAtual.materias.push({ materia: '', topicos: [] });
    renderizarBlocosMateriaSugestao();
}

function removerBlocoMateriaSugestao(indice) {
    if (!sugestaoEditalAtual) return;
    sincronizarBlocosMateriaSugestao();
    sugestaoEditalAtual.materias.splice(indice, 1);
    renderizarBlocosMateriaSugestao();
}

// Lê o que a pessoa editou nos campos de volta pro objeto sugestaoEditalAtual
// — chamado antes de adicionar/remover um bloco (pra não perder edição em
// andamento) e antes de confirmar a importação.
function sincronizarBlocosMateriaSugestao() {
    if (!sugestaoEditalAtual) return;
    document.querySelectorAll('.sugestao-materia-nome').forEach(input => {
        const i = Number(input.dataset.indice);
        if (sugestaoEditalAtual.materias[i]) sugestaoEditalAtual.materias[i].materia = input.value;
    });
    document.querySelectorAll('.sugestao-materia-topicos').forEach(textarea => {
        const i = Number(textarea.dataset.indice);
        if (sugestaoEditalAtual.materias[i]) {
            sugestaoEditalAtual.materias[i].topicos = lerTopicosDoTextarea(textarea.value);
        }
    });
}

async function confirmarImportacaoSugestaoEdital() {
    if (!sugestaoEditalAtual) return;
    sincronizarBlocosMateriaSugestao();

    const plano = document.getElementById('sugestao-plano-input').value.trim();
    if (!plano) return alert('Informe o nome do plano para importar.');

    const materiasValidas = sugestaoEditalAtual.materias
        .map(b => ({
            materia: (b.materia || '').trim(),
            topicos: (b.topicos || []).filter(t => (typeof t === 'string' ? t.trim() : (t.topico || '').trim()) !== '')
        }))
        .filter(b => b.materia !== '' && b.topicos.length > 0);

    if (materiasValidas.length === 0) return alert('Adicione ao menos uma matéria com tópicos antes de importar.');

    const dados = { formato: sugestaoEditalAtual.formato, nomeEdital: sugestaoEditalAtual.nomeEdital, materias: materiasValidas };

    const res = await fetch('/api/edital/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dados, plano })
    });
    const resultado = await res.json();

    if (!resultado.success) {
        alert(resultado.error || 'Não foi possível importar o edital.');
        return;
    }

    fecharModalSugestaoEdital();

    await carregarPlanos();
    planoAtual = resultado.plano;
    localStorage.setItem('edital_plano_atual', planoAtual);
    renderizarTabsPlanos();
    await carregarEdital();
    if (viewAtual === 'estudos') await carregarPainelEstudos();
    if (viewAtual === 'resumo') await carregarResumo();

    alert(`Edital importado para "${resultado.plano}": ${resultado.criados} tópico(s) novo(s), ${resultado.vinculados} já existiam e foram vinculados.`);
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

    // Cabeçalhos contextuais: mostram, bem visível no topo da aba, qual
    // plano/edital (Edital e Estudos) ou qual filtro (Jogo e Flashcards)
    // está em foco no momento.
    const cabecalhoPlanos = document.getElementById('cabecalho-planos-edital-estudos');
    const cabecalhoJogo = document.getElementById('cabecalho-filtro-jogo');
    const cabecalhoFlashcards = document.getElementById('cabecalho-filtro-flashcards');
    if (cabecalhoPlanos) cabecalhoPlanos.style.display = (nome === 'edital' || nome === 'estudos') ? 'flex' : 'none';
    if (cabecalhoJogo) cabecalhoJogo.style.display = nome === 'jogo' ? 'flex' : 'none';
    if (cabecalhoFlashcards) cabecalhoFlashcards.style.display = nome === 'flashcards' ? 'flex' : 'none';
    if (nome === 'edital' || nome === 'estudos') {
        renderizarTabsPlanos();
        atualizarCabecalhoPlanoAtual();
    }
    if (nome === 'jogo') renderizarFiltroJogo();

    if (nome === 'resumo') await carregarResumo();
    if (nome === 'estudos') await carregarPainelEstudos();
    if (nome === 'flashcards') await carregarFlashcards();
    if (nome === 'jogo') { mostrarSelecaoJogo(); await carregarPontuacaoJogo(); }
    if (nome === 'estatisticas') await carregarEstatisticas();
    if (nome === 'conquistas') await abrirConquistas();
    if (nome === 'configuracoes') await abrirConfiguracoes();
}

// Atualiza o texto "Você está vendo: <plano>" do cabeçalho de Edital/Estudos.
function atualizarCabecalhoPlanoAtual() {
    const el = document.getElementById('cabecalho-plano-atual-nome');
    if (el) el.textContent = planoAtual || '—';
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
function alternarImportacaoEdital() {
    const conteudo = document.getElementById('conteudo-importacao-edital');
    const seta = document.getElementById('seta-importacao-edital');
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
    aplicarFiltroJogoNaTela();
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

// Catálogo de jogos: cada jogo pode, opcionalmente, ficar restrito a um ou
// mais planos específicos (lista de nomes de plano em "planos"). Quando
// "planos" é null/vazio o jogo é universal e aparece em qualquer filtro,
// inclusive "🌐 Geral" — que sempre mostra todos os jogos, sem exceção. Por
// enquanto, todos os jogos existentes são universais (aparecem em TRT, ENAM
// e em qualquer outro plano que for criado); no futuro um jogo novo pode já
// nascer restrito a um plano específico, bastando listar o nome dele aqui.
const CATALOGO_JOGOS = {
    mnemonicos: { planos: null },
    competencias: { planos: null },
    lacunas: { planos: null },
};

function jogoVisivelNoFiltro(tipo, filtro) {
    if (!filtro || filtro === 'geral') return true;
    const info = CATALOGO_JOGOS[tipo];
    if (!info || !info.planos || info.planos.length === 0) return true;
    return info.planos.includes(filtro);
}

// Monta as pílulas "🌐 Geral" + cada plano no cabeçalho da aba Jogo, e
// aplica o filtro escolhido aos cartões de seleção de jogo já na tela.
function renderizarFiltroJogo() {
    const row = document.getElementById('jogo-escopo-row');
    if (!row) return;
    row.innerHTML = '';

    const btnGeral = document.createElement('button');
    btnGeral.type = 'button';
    btnGeral.className = 'escopo-pill' + (jogoFiltroPlano === 'geral' ? ' ativo' : '');
    btnGeral.innerHTML = '<span class="escopo-pill-icone">🌐</span> Geral';
    btnGeral.onclick = () => definirFiltroJogo('geral');
    row.appendChild(btnGeral);

    planosDisponiveis.forEach(plano => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'escopo-pill' + (jogoFiltroPlano === plano.nome ? ' ativo' : '');
        btn.textContent = plano.nome;
        btn.onclick = () => definirFiltroJogo(plano.nome);
        row.appendChild(btn);
    });

    const nomeEl = document.getElementById('cabecalho-jogo-filtro-nome');
    if (nomeEl) nomeEl.textContent = jogoFiltroPlano === 'geral' ? 'Geral' : jogoFiltroPlano;

    aplicarFiltroJogoNaTela();
}

function definirFiltroJogo(nome) {
    jogoFiltroPlano = nome;
    localStorage.setItem('jogo_filtro_plano', jogoFiltroPlano);
    renderizarFiltroJogo();
}

function aplicarFiltroJogoNaTela() {
    document.querySelectorAll('#jogo-selecao-bloco .jogo-selecao-card').forEach(card => {
        const tipo = card.getAttribute('data-jogo');
        card.style.display = jogoVisivelNoFiltro(tipo, jogoFiltroPlano) ? '' : 'none';
    });
}

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

// Pastas expandidas na árvore de baralhos (visão "Geral", que reproduz a
// estrutura de pastas do Anki) — guarda o caminho completo (ex:
// "ENAM::Direito Administrativo") de cada pasta aberta. Não persiste.
let flashcardsPastasExpandidas = new Set();

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
    renderizarFiltroFlashcards();
    renderizarBaralhos();
}

// Nome do "baralho inteiro" (nível raiz) de cada baralho salvo — pra quem
// veio de importação do Anki, é o primeiro segmento do caminho (ex: "ENAM",
// ignorando matéria/tópico/subtópico); pra baralho avulso (sem pastas),
// é a própria matéria informada na criação. Cada raiz vira 1 pílula.
function raizDoBaralho(b) {
    if ((b.caminho || []).length > 0) return b.caminho[0];
    // Baralho avulso (sem "::" no nome) é raiz dele mesmo — igual a um
    // deck de primeiro nível no Anki — e ganha sua própria pílula.
    return (b.materia || '').trim() || b.nome;
}

// Monta as pílulas "🌐 Geral" + cada baralho inteiro (raiz) existente no
// cabeçalho da aba Flashcards — clicar em "Geral" mostra tudo; clicar numa
// pílula mostra só aquele baralho (com todas as suas matérias/tópicos por
// dentro), nunca um tópico solto no menu de cima.
function renderizarFiltroFlashcards() {
    const row = document.getElementById('flashcards-escopo-row');
    if (!row) return;

    const raizes = [...new Set(baralhosCache.map(raizDoBaralho).filter(r => r !== ''))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    // Se a raiz escolhida no filtro não existe mais em nenhum baralho, volta pra Geral.
    if (flashcardsFiltroMateria !== 'geral' && !raizes.includes(flashcardsFiltroMateria)) {
        flashcardsFiltroMateria = 'geral';
        localStorage.setItem('flashcards_filtro_materia', flashcardsFiltroMateria);
    }

    row.innerHTML = '';
    const btnGeral = document.createElement('button');
    btnGeral.type = 'button';
    btnGeral.className = 'escopo-pill' + (flashcardsFiltroMateria === 'geral' ? ' ativo' : '');
    btnGeral.innerHTML = '<span class="escopo-pill-icone">🌐</span> Geral';
    btnGeral.onclick = () => definirFiltroFlashcards('geral');
    row.appendChild(btnGeral);

    raizes.forEach(raiz => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'escopo-pill' + (flashcardsFiltroMateria === raiz ? ' ativo' : '');
        btn.innerHTML = '<span class="escopo-pill-icone">📘</span> ' + raiz;
        btn.onclick = () => definirFiltroFlashcards(raiz);
        row.appendChild(btn);
    });

    const nomeEl = document.getElementById('cabecalho-flashcards-filtro-nome');
    if (nomeEl) nomeEl.textContent = flashcardsFiltroMateria === 'geral' ? 'Geral' : flashcardsFiltroMateria;
}

function definirFiltroFlashcards(materia) {
    flashcardsFiltroMateria = materia;
    localStorage.setItem('flashcards_filtro_materia', flashcardsFiltroMateria);
    renderizarFiltroFlashcards();
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

// --- ÁRVORE DE BARALHOS (visão "Geral") ---
// Reproduz o navegador de baralhos do Anki: pastas (matéria/subpasta, vindas
// do "caminho" de cada baralho importado) expansíveis, com Novo/Aprender/
// Revisar somados por pasta, e os baralhos-folha com seus próprios números.

// Cada NÓ da árvore mora numa posição de caminho completo (matéria/tópico/
// subtópico/nome) e pode, ao mesmo tempo, ter cartões PRÓPRIOS (nodo.baralho
// preenchido) e ter filhos (subbaralhos dentro dele) — exatamente como um
// deck no Anki, que pode ter cartas e subdecks ao mesmo tempo. Não existe
// mais uma separação rígida entre "pasta" e "baralho-folha": um baralho que
// já tem cartões vira automaticamente um "baralho-pai" assim que alguém cria
// outro baralho com o caminho dele como prefixo — sem precisar converter nada.
function construirArvoreBaralhos(baralhos) {
    const raiz = { nome: null, filhos: new Map(), baralho: null };
    baralhos.forEach(b => {
        const caminhoCompleto = [...(b.caminho || []), b.nome];
        let nodo = raiz;
        caminhoCompleto.forEach(segmento => {
            if (!nodo.filhos.has(segmento)) nodo.filhos.set(segmento, { nome: segmento, filhos: new Map(), baralho: null });
            nodo = nodo.filhos.get(segmento);
        });
        nodo.baralho = b;
    });
    return raiz;
}

function agregarContagensArvore(nodo) {
    let novos = 0, aprender = 0, revisar = 0;
    if (nodo.baralho) {
        novos += nodo.baralho.novos || 0;
        aprender += nodo.baralho.aprender || 0;
        revisar += nodo.baralho.revisar || 0;
    }
    nodo.filhos.forEach(filho => {
        const sub = agregarContagensArvore(filho);
        novos += sub.novos; aprender += sub.aprender; revisar += sub.revisar;
    });
    return { novos, aprender, revisar };
}

function renderizarContagensArvore(cont) {
    return `
        <span class="baralho-arvore-contagens">
            <span class="contagem-novo" title="Novos">${cont.novos || 0}</span>
            <span class="contagem-aprender" title="Aprendendo">${cont.aprender || 0}</span>
            <span class="contagem-revisar" title="Pra revisar">${cont.revisar || 0}</span>
        </span>
    `;
}

function renderizarNodoArvoreBaralhos(nodo, caminhoAtual, profundidade) {
    let html = '';

    const filhosOrdenados = [...nodo.filhos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    filhosOrdenados.forEach(filho => {
        const caminhoFilho = [...caminhoAtual, filho.nome];
        const chave = caminhoFilho.join('::');
        const chaveEscapada = chave.replace(/'/g, "\\'");
        const nomeEscapado = filho.nome.replace(/"/g, '&quot;');
        const temFilhos = filho.filhos.size > 0;
        const expandido = temFilhos && flashcardsPastasExpandidas.has(chave);
        const cont = agregarContagensArvore(filho);
        const temPendente = cont.revisar > 0 || cont.novos > 0 || cont.aprender > 0;
        const b = filho.baralho; // preenchido quando esse nó também é um baralho com cartões próprios

        // Um baralho SEM nenhum cartão que só está servindo de pasta (tem
        // subbaralhos dentro) é tratado visualmente como uma pasta pura —
        // sem o ícone de baralho, badge do Anki, nome clicável ou lixeira —
        // exatamente como "Direito Administrativo" etc. no ENAM, que nunca
        // chegaram a virar um documento próprio. Isso evita que criar
        // subbaralhos por "+" (que agora sempre cria um documento vazio nesse
        // nível) deixe a árvore cheia de "baralhos" que na prática são só
        // organização, sem cartão nenhum.
        const ehBaralhoDeVerdade = b && (!temFilhos || (b.totalCartoes || 0) > 0);

        html += `
            <div class="baralho-arvore-pasta">
                <div class="baralho-arvore-pasta-header" style="--profundidade:${profundidade}" onclick="${temFilhos ? `toggleFlashcardsPasta('${chaveEscapada}')` : (ehBaralhoDeVerdade ? `abrirBaralho('${b._id}')` : '')}">
                    <span class="seta-subtopicos">${temFilhos ? (expandido ? '▾' : '▸') : ''}</span>
                    <span class="baralho-arvore-pasta-nome" ${ehBaralhoDeVerdade && temFilhos ? `onclick="event.stopPropagation(); abrirBaralho('${b._id}')" title="Ver cartões"` : ''}>
                        ${ehBaralhoDeVerdade ? '📘 ' : ''}${filho.nome}${ehBaralhoDeVerdade && b.origem === 'anki' ? ' <span class="baralho-card-origem-anki">Anki</span>' : ''}
                    </span>
                    <span class="baralho-arvore-quebra"></span>
                    ${renderizarContagensArvore(cont)}
                    <span class="baralho-arvore-acoes">
                        ${temPendente
                            ? `<button type="button" class="baralho-arvore-revisar-pasta" onclick="event.stopPropagation(); revisarPasta('${chaveEscapada}')" title="Revisar tudo em &quot;${nomeEscapado}&quot;">▶</button>`
                            : ''}
                        <button type="button" class="baralho-arvore-add-sub" onclick="event.stopPropagation(); abrirModalNovoBaralho('${chaveEscapada}')" title="Novo baralho dentro de &quot;${nomeEscapado}&quot;">+</button>
                        ${ehBaralhoDeVerdade ? `<button type="button" class="baralho-arvore-excluir" onclick="event.stopPropagation(); excluirBaralho('${b._id}')" title="Excluir baralho">🗑️</button>` : ''}
                    </span>
                </div>
                ${expandido ? renderizarNodoArvoreBaralhos(filho, caminhoFilho, profundidade + 1) : ''}
            </div>
        `;
    });

    return html;
}

function toggleFlashcardsPasta(chave) {
    if (flashcardsPastasExpandidas.has(chave)) flashcardsPastasExpandidas.delete(chave);
    else flashcardsPastasExpandidas.add(chave);
    renderizarBaralhos();
}

// Baralhos que ficam dentro (ou exatamente na raiz) de um nó da árvore —
// tanto os cartões do próprio baralho daquele nó (se ele tiver) quanto os
// de todo subbaralho aninhado nele.
function baralhosDaPasta(chave) {
    const segmentos = chave.split('::');
    return baralhosCache.filter(b => {
        const caminhoCompleto = [...(b.caminho || []), b.nome];
        if (caminhoCompleto.length < segmentos.length) return false;
        return segmentos.every((seg, i) => caminhoCompleto[i] === seg);
    });
}

// "▶" no cabeçalho de um nó — revisa TODOS os cartões pendentes daquele nó
// (incluindo os dele mesmo, se for um baralho-pai) e de tudo que está
// aninhado dentro, de uma vez só.
function revisarPasta(chave) {
    const ids = baralhosDaPasta(chave).map(b => b._id);
    if (ids.length === 0) return;
    iniciarRevisao(ids);
}

function renderizarBaralhos() {
    const grid = document.getElementById('flashcards-baralhos-grid');
    const vazio = document.getElementById('flashcards-vazio');
    if (!grid) return;

    if (baralhosCache.length === 0) {
        if (vazio) {
            vazio.style.display = 'block';
            vazio.textContent = 'Você ainda não tem nenhum baralho. Crie um do zero ou importe um baralho do Anki (.apkg) pra começar!';
        }
        grid.innerHTML = '';
        grid.classList.remove('modo-arvore');
        return;
    }

    // "Geral" mostra a árvore inteira; qualquer outra pílula é sempre um
    // baralho INTEIRO (raiz) — mostra a mesma árvore, só que filtrada pra
    // conter apenas esse baralho (com todas as matérias/tópicos por dentro),
    // nunca uma lista solta de tópicos.
    const baralhosNoEscopo = flashcardsFiltroMateria === 'geral'
        ? baralhosCache
        : baralhosCache.filter(b => raizDoBaralho(b) === flashcardsFiltroMateria);

    if (vazio) {
        vazio.style.display = baralhosNoEscopo.length === 0 ? 'block' : 'none';
        vazio.textContent = flashcardsFiltroMateria === 'geral'
            ? 'Você ainda não tem nenhum baralho. Crie um do zero ou importe um baralho do Anki (.apkg) pra começar!'
            : `Nenhum cartão em "${flashcardsFiltroMateria}" ainda.`;
    }

    grid.classList.add('modo-arvore');
    const arvore = construirArvoreBaralhos(baralhosNoEscopo);
    grid.innerHTML = `
        <div class="baralho-arvore-cabecalho">
            <span class="baralho-arvore-cabecalho-nome">Baralho</span>
            <span class="baralho-arvore-quebra"></span>
            <span class="baralho-arvore-contagens">
                <span class="contagem-novo" title="Novos">Novo</span>
                <span class="contagem-aprender" title="Aprendendo">Aprender</span>
                <span class="contagem-revisar" title="Pra revisar">Revisar</span>
            </span>
            <span class="baralho-arvore-acoes"></span>
        </div>
        <div class="baralho-arvore">${renderizarNodoArvoreBaralhos(arvore, [], 0)}</div>
    `;
}

// --- MODAL: CRIAR/EDITAR BARALHO ---
// O campo "Nome do baralho" aceita caminho com "::" igual ao Anki — o
// último pedaço é o nome do baralho em si, e os anteriores são as pastas
// (matéria/tópico/subtópico) onde ele vai morar na árvore.

// Separador visual usado só no campo "Pasta" do modal — bem mais amigável
// que pedir pra pessoa digitar "::" toda vez (o "::" continua existindo só
// como identificador interno da árvore, nunca aparece pra quem usa o app).
const SEPARADOR_PASTA_EXIBICAO = ' › ';

// Lê o campo "Pasta" (aceita o separador bonito " › ", mas também aceita
// "/" ou ">" soltos, pra ser tolerante com quem digitar diferente) e devolve
// o array de segmentos do caminho.
function lerCaminhoDoCampoPasta(texto) {
    return texto.split(/\s*[›/>]\s*|::/).map(s => s.trim()).filter(s => s !== '');
}

// Todas as pastas já existentes (cada prefixo do caminho de cada baralho),
// pra alimentar o autocomplete do campo "Pasta" — assim a pessoa escolhe
// entre as que já existem em vez de ter que lembrar/digitar tudo de novo.
function todasAsPastasConhecidas() {
    const caminhos = new Set();
    baralhosCache.forEach(b => {
        const completo = [...(b.caminho || []), b.nome];
        // Cada prefixo do caminho completo é uma pasta navegável (o próprio
        // baralho incluso, já que ele pode virar pai de outros a qualquer momento).
        for (let i = 1; i <= completo.length; i++) {
            caminhos.add(completo.slice(0, i).join(SEPARADOR_PASTA_EXIBICAO));
        }
    });
    return [...caminhos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function atualizarDatalistPastas() {
    const datalist = document.getElementById('baralho-pastas-datalist');
    if (!datalist) return;
    datalist.innerHTML = todasAsPastasConhecidas().map(p => `<option value="${p.replace(/"/g, '&quot;')}"></option>`).join('');
}

// Chamada tanto pelo botão geral "+ Novo baralho" (sem prefixo, ou com o
// baralho raiz atualmente selecionado no filtro) quanto pelo botão "+" de
// cada nó da árvore (com o caminho daquele nó já pré-preenchido no campo
// "Pasta", pra só faltar digitar o nome do novo subbaralho).
function abrirModalNovoBaralho(prefixoCaminho) {
    baralhoEmEdicaoId = null;
    document.getElementById('modal-baralho-titulo').textContent = 'Novo baralho';
    atualizarDatalistPastas();
    const prefixo = prefixoCaminho || (flashcardsFiltroMateria !== 'geral' ? flashcardsFiltroMateria : '');
    document.getElementById('baralho-pasta-input').value = prefixo ? prefixo.split('::').join(SEPARADOR_PASTA_EXIBICAO) : '';
    document.getElementById('baralho-nome-input').value = '';
    document.getElementById('modal-baralho-overlay').style.display = 'flex';
    document.getElementById('baralho-nome-input').focus();
}

function abrirModalEditarBaralho() {
    const baralho = baralhosCache.find(b => b._id === baralhoAtualId);
    if (!baralho) return;
    baralhoEmEdicaoId = baralhoAtualId;
    document.getElementById('modal-baralho-titulo').textContent = 'Editar baralho';
    atualizarDatalistPastas();
    document.getElementById('baralho-pasta-input').value = (baralho.caminho || []).join(SEPARADOR_PASTA_EXIBICAO);
    document.getElementById('baralho-nome-input').value = baralho.nome;
    document.getElementById('modal-baralho-overlay').style.display = 'flex';
}

function fecharModalBaralho() {
    document.getElementById('modal-baralho-overlay').style.display = 'none';
}

async function salvarBaralho() {
    const caminho = lerCaminhoDoCampoPasta(document.getElementById('baralho-pasta-input').value.trim());
    const nome = document.getElementById('baralho-nome-input').value.trim();
    if (!nome) return;

    try {
        let resultado;
        if (baralhoEmEdicaoId) {
            const res = await fetch(`/api/flashcards/baralhos/${baralhoEmEdicaoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, caminho })
            });
            resultado = await res.json();
            const detalheNome = document.getElementById('flashcards-detalhe-nome');
            if (detalheNome && baralhoAtualId === baralhoEmEdicaoId) detalheNome.textContent = nome;
        } else {
            const res = await fetch('/api/flashcards/baralhos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, caminho })
            });
            resultado = await res.json();
        }
        fecharModalBaralho();
        await carregarFlashcards();

        // Quando o baralho criado/editado fica dentro de outro que já tinha
        // cartões direto nele, o servidor move esses cartões automaticamente
        // pra um subbaralho "Geral" — avisa aqui pra não parecer mágica.
        if (resultado && resultado.migracao) {
            const m = resultado.migracao;
            alert(`"${m.nomeAntigo}" tinha ${m.totalCartoes} cartão(ões) direto nele. Pra abrir espaço pro(s) subbaralho(s), eles foram movidos automaticamente pra um novo subbaralho chamado "${m.novoNome}", dentro de "${m.nomeAntigo}". Você pode renomear esse subbaralho quando quiser.`);
        }
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
        flashcardsFiltroMateria = 'geral';
        localStorage.setItem('flashcards_filtro_materia', 'geral');
        await carregarFlashcards();
        const rotuloBaralhos = dados.totalBaralhos === 1 ? '1 baralho' : `${dados.totalBaralhos} baralhos`;
        alert(`Importação concluída! ${rotuloBaralhos}, ${dados.totalImportado} cartões — mantendo a estrutura de pastas do Anki (veja em "🌐 Geral").`);
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

    // Troca de baralho encerra qualquer seleção em massa que tenha ficado
    // pendente (evita "selecionado(s)" fantasma vindo de outro baralho).
    if (modoSelecaoCartoes || cartoesSelecionados.size > 0) {
        modoSelecaoCartoes = false;
        cartoesSelecionados.clear();
        atualizarBarraSelecaoCartoes();
    }

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
        <div class="cartao-item ${modoSelecaoCartoes && cartoesSelecionados.has(c._id) ? 'selecionado' : ''}"
            ${modoSelecaoCartoes ? `onclick="toggleSelecaoCartao('${c._id}', !cartoesSelecionados.has('${c._id}'))"` : ''}>
            ${modoSelecaoCartoes ? `
                <input type="checkbox" class="checkbox-selecao-item" ${cartoesSelecionados.has(c._id) ? 'checked' : ''}
                    onclick="event.stopPropagation()" onchange="toggleSelecaoCartao('${c._id}', this.checked)">
            ` : ''}
            <div class="cartao-item-conteudo">
                ${c.tipo === 'cloze' ? `<span class="cartao-item-tipo-badge">🕳️ Omissão${c.clozeIndice ? ` c${c.clozeIndice}` : ''}</span>` : ''}
                <div class="cartao-item-frente">${removerTagsHtmlFlashcard(c.frente)}</div>
                <div class="cartao-item-verso">${removerTagsHtmlFlashcard(c.verso)}</div>
            </div>
            ${modoSelecaoCartoes ? '' : `
                <div class="cartao-item-acoes">
                    <button type="button" onclick="abrirModalEditarCartao('${c._id}')" title="Editar">✏️</button>
                    <button type="button" onclick="abrirModalMoverCartao('${c._id}')" title="Mover ou copiar pra outro baralho">↗️</button>
                    <button type="button" onclick="excluirCartao('${c._id}')" title="Excluir">🗑️</button>
                </div>
            `}
        </div>
    `).join('');
}

// --- EDITOR RICO (usado nos campos de frente/verso/texto com omissão) ---
// Os campos são <div contenteditable>, não <textarea>, pra permitir negrito/
// itálico/etc — o "conteúdo" deles é o próprio innerHTML.

// Guarda a última seleção de texto feita DENTRO de um campo editável, porque
// clicar num botão da barra de formatação tira o foco do campo (perderíamos
// a seleção se não guardássemos antes).
let ultimoRangeEditor = null;
let ultimoEditorFocadoId = null;

function salvarSelecaoEditor(event) {
    const el = event.currentTarget;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        ultimoRangeEditor = sel.getRangeAt(0).cloneRange();
        ultimoEditorFocadoId = el.id;
    }
}

// No celular, selecionar mais de uma palavra normalmente é: toca numa
// palavra (seleciona só ela) e depois ARRASTA as alcinhas azuis pra
// estender a seleção pras palavras ao lado. Esse arrastar não dispara
// mouseup/keyup/focus no campo (os eventos que o salvarSelecaoEditor acima
// escuta) — então a seleção "guardada" ficava travada só na primeira
// palavra tocada, e o "Omitir" acabava escondendo só ela, mesmo a pessoa
// vendo a frase inteira destacada na tela. O evento "selectionchange" do
// próprio documento, por outro lado, dispara continuamente enquanto a
// seleção muda (incluindo esse arrastar de alcinha) — então usamos ele
// pra manter a seleção sempre atualizada de verdade, em vez de confiar só
// nos eventos de mouse/teclado.
document.addEventListener('selectionchange', () => {
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('editor-campo')) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        ultimoRangeEditor = sel.getRangeAt(0).cloneRange();
        ultimoEditorFocadoId = el.id;
    }
});

function restaurarSelecaoEditor() {
    if (!ultimoRangeEditor || !ultimoEditorFocadoId) return null;
    const el = document.getElementById(ultimoEditorFocadoId);
    if (!el) return null;
    el.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(ultimoRangeEditor);
    return el;
}

function aplicarFormatoTexto(comando, valor) {
    restaurarSelecaoEditor();
    document.execCommand(comando, false, valor || null);
}

// Envolve o trecho selecionado num "cartão-mostrador" de omissão numerado
// (1, 2, 3...) — cada número novo vira um cartão diferente ao salvar, igual
// ao Anki (c1/c2/c3 no mesmo texto = cartões separados).
function proximoNumeroCloze(containerEl) {
    let max = 0;
    containerEl.querySelectorAll('.cloze-editor-marca').forEach(s => {
        const n = Number(s.dataset.cloze);
        if (n > max) max = n;
    });
    return max + 1;
}

// Número do "cartão ativo" — todo trecho marcado com "🕳️ Omitir" vira parte
// DESSE cartão (podendo ter vários trechos omitidos no mesmo cartão). Só
// muda quando a pessoa clica em "🕳️+ Novo cartão" ou mexe manualmente no
// contador acima do editor.
let clozeNumeroAtivo = 1;

function atualizarIndicadorClozeAtivo() {
    const el = document.getElementById('cloze-numero-ativo-valor');
    if (el) el.textContent = String(clozeNumeroAtivo);
}

function definirClozeNumeroAtivo(delta) {
    clozeNumeroAtivo = Math.max(1, clozeNumeroAtivo + delta);
    atualizarIndicadorClozeAtivo();
}

// Maior número cN encontrado num texto cloze salvo — usado ao reabrir um
// cartão pra edição, pra já deixar o "cartão ativo" no último número usado
// (ela pode então diminuir manualmente se quiser editar um cartão anterior).
function maiorNumeroClozeNoTexto(clozeTexto) {
    if (!clozeTexto) return 1;
    let max = 0;
    const regexNumerado = /\{\{c(\d+)::/g;
    let m;
    while ((m = regexNumerado.exec(clozeTexto)) !== null) {
        const n = Number(m[1]);
        if (n > max) max = n;
    }
    if (max === 0 && /\{\{[^{}:][^{}]*\}\}/.test(clozeTexto)) max = 1;
    return max > 0 ? max : 1;
}

// Envolve o trecho selecionado num "cartão-mostrador" de omissão com o
// número passado — usada tanto por "🕳️ Omitir" (mantém o cartão ativo)
// quanto por "🕳️+ Novo cartão" (usa um número novo).
function marcarSelecaoComoCloze(numero) {
    const editor = restaurarSelecaoEditor();
    if (!editor || editor.id !== 'cartao-cloze-input') {
        alert('Clique no campo de texto, selecione o trecho que quer esconder e tente de novo.');
        return;
    }
    const selecao = window.getSelection();
    if (!selecao || selecao.rangeCount === 0 || selecao.isCollapsed) {
        alert('Selecione o trecho do texto que você quer omitir, e clique em "🕳️ Omitir" de novo.');
        return;
    }
    const range = selecao.getRangeAt(0);
    const frag = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(frag);
    const conteudoHtml = div.innerHTML || div.textContent;

    range.deleteContents();
    const span = document.createElement('span');
    span.className = 'cloze-editor-marca';
    span.contentEditable = 'false';
    span.dataset.cloze = String(numero);
    span.title = 'Clique pra desomitir';
    span.setAttribute('onclick', 'desomitirMarca(this)');
    span.innerHTML = `${conteudoHtml}<sup class="cloze-editor-numero">${numero}</sup>`;
    range.insertNode(span);

    // Move o cursor pra depois do trecho recém-marcado.
    const novaSelecao = window.getSelection();
    const novoRange = document.createRange();
    novoRange.setStartAfter(span);
    novoRange.collapse(true);
    novaSelecao.removeAllRanges();
    novaSelecao.addRange(novoRange);
}

// "🕳️ Omitir" — continua omitindo no cartão ativo atual (não muda o número).
function omitirSelecao() {
    marcarSelecaoComoCloze(clozeNumeroAtivo);
}

// "🕳️+ Novo cartão" — o próximo trecho omitido vira um cartão SEPARADO.
function omitirSelecaoNovoCartao() {
    const editor = document.getElementById('cartao-cloze-input');
    clozeNumeroAtivo = proximoNumeroCloze(editor);
    atualizarIndicadorClozeAtivo();
    marcarSelecaoComoCloze(clozeNumeroAtivo);
}

// Clicar num trecho já omitido desfaz a omissão, devolvendo o texto puro
// (sem o "cartão-mostrador" nem o numerozinho sobrescrito).
function desomitirMarca(spanEl) {
    // Usa o innerHTML sem o <sup> pra preservar formatação (negrito/itálico
    // etc.) que porventura exista dentro do trecho omitido.
    const clone = spanEl.cloneNode(true);
    clone.querySelectorAll('.cloze-editor-numero').forEach(b => b.remove());
    const frag = document.createDocumentFragment();
    Array.from(clone.childNodes).forEach(n => frag.appendChild(n));
    spanEl.replaceWith(frag);
}

// Serializa o editor de omissão pro formato bruto {{cN::conteúdo}} guardado
// no banco (o mesmo formato que o Anki usa).
function converterEditorParaClozeTexto(editorEl) {
    const clone = editorEl.cloneNode(true);
    clone.querySelectorAll('.cloze-editor-numero').forEach(b => b.remove());
    let html = clone.innerHTML;
    html = html.replace(/<span class="cloze-editor-marca"[^>]*data-cloze="(\d+)"[^>]*>([\s\S]*?)<\/span>/g, (m, n, conteudo) => `{{c${n}::${conteudo}}}`);
    return html.trim();
}

// Reconstrói o HTML do editor a partir do texto bruto salvo (pra reabrir um
// cartão cloze existente pra edição, com as marcações visuais de volta).
function converterClozeTextoParaEditorHtml(clozeTexto) {
    if (!clozeTexto) return '';
    let html = clozeTexto.replace(/\{\{c(\d+)::([\s\S]*?)\}\}/g, (m, n, conteudo) => {
        const partes = conteudo.split('::');
        return `<span class="cloze-editor-marca" contenteditable="false" data-cloze="${n}" title="Clique pra desomitir" onclick="desomitirMarca(this)">${partes[0]}<sup class="cloze-editor-numero">${n}</sup></span>`;
    });
    // Formato antigo (sem número), de cartões criados antes desse editor.
    html = html.replace(/\{\{([^{}:][^{}]*)\}\}/g, (m, conteudo) => `<span class="cloze-editor-marca" contenteditable="false" data-cloze="1" title="Clique pra desomitir" onclick="desomitirMarca(this)">${conteudo}<sup class="cloze-editor-numero">1</sup></span>`);
    return html;
}

// --- MODAL: CRIAR/EDITAR CARTÃO ---

// Tipo de cartão selecionado no momento no modal: "basico" (frente/verso
// normais) ou "cloze" (texto único com trecho(s) omitidos, numerados).
let cartaoTipoAtual = 'basico';
// Quando o cartão está sendo editado a partir da tela de revisão (botão
// "✏️ Editar cartão"), salvar não deve sair da revisão — só atualizar a
// fila e continuar de onde estava.
let cartaoEdicaoEmRevisao = false;

function definirTipoCartao(tipo) {
    cartaoTipoAtual = tipo === 'cloze' ? 'cloze' : 'basico';
    document.getElementById('btn-tipo-basico').classList.toggle('ativo', cartaoTipoAtual === 'basico');
    document.getElementById('btn-tipo-cloze').classList.toggle('ativo', cartaoTipoAtual === 'cloze');
    document.getElementById('cartao-campos-basico').style.display = cartaoTipoAtual === 'basico' ? 'block' : 'none';
    document.getElementById('cartao-campos-cloze').style.display = cartaoTipoAtual === 'cloze' ? 'block' : 'none';
}

function abrirModalNovoCartao() {
    cartaoEmEdicaoId = null;
    cartaoEdicaoEmRevisao = false;
    document.getElementById('modal-cartao-titulo').textContent = 'Novo cartão';
    document.getElementById('cartao-frente-input').innerHTML = '';
    document.getElementById('cartao-verso-input').innerHTML = '';
    document.getElementById('cartao-cloze-input').innerHTML = '';
    document.getElementById('cartao-cloze-extra-input').innerHTML = '';
    definirTipoCartao('basico');
    clozeNumeroAtivo = 1;
    atualizarIndicadorClozeAtivo();
    document.getElementById('modal-cartao-overlay').style.display = 'flex';
}

function preencherModalCartaoComDados(cartao) {
    const ehCloze = cartao.tipo === 'cloze';
    document.getElementById('modal-cartao-titulo').textContent = 'Editar cartão';
    document.getElementById('cartao-frente-input').innerHTML = ehCloze ? '' : (cartao.frente || '');
    document.getElementById('cartao-verso-input').innerHTML = ehCloze ? '' : (cartao.verso || '');
    document.getElementById('cartao-cloze-input').innerHTML = ehCloze ? converterClozeTextoParaEditorHtml(cartao.clozeTexto) : '';
    document.getElementById('cartao-cloze-extra-input').innerHTML = ehCloze ? (cartao.clozeExtra || '') : '';
    definirTipoCartao(ehCloze ? 'cloze' : 'basico');
    clozeNumeroAtivo = ehCloze ? maiorNumeroClozeNoTexto(cartao.clozeTexto) : 1;
    atualizarIndicadorClozeAtivo();
    document.getElementById('modal-cartao-overlay').style.display = 'flex';
}

function abrirModalEditarCartao(id) {
    const cartao = cartoesDoBaralhoCache.find(c => c._id === id);
    if (!cartao) return;
    cartaoEmEdicaoId = id;
    cartaoEdicaoEmRevisao = false;
    preencherModalCartaoComDados(cartao);
}

// Editar o cartão que está sendo revisado NA HORA, sem sair da tela de
// revisão — útil quando a pessoa percebe um erro ou quer ajustar algo no
// meio da sessão.
function editarCartaoDuranteRevisao() {
    if (!cartaoRevisaoAtual) return;
    cartaoEmEdicaoId = cartaoRevisaoAtual._id;
    cartaoEdicaoEmRevisao = true;
    preencherModalCartaoComDados(cartaoRevisaoAtual);
}

function fecharModalCartao() {
    document.getElementById('modal-cartao-overlay').style.display = 'none';
}

async function salvarCartao() {
    const corpo = { tipo: cartaoTipoAtual };

    if (cartaoTipoAtual === 'cloze') {
        const editor = document.getElementById('cartao-cloze-input');
        const clozeTexto = converterEditorParaClozeTexto(editor);
        if (!clozeTexto || !/\{\{c\d+::/.test(clozeTexto)) {
            alert('Selecione ao menos um trecho do texto e clique em "🕳️ Omitir" pra criar a lacuna.');
            return;
        }
        corpo.clozeTexto = clozeTexto;
        corpo.clozeExtra = document.getElementById('cartao-cloze-extra-input').innerHTML.trim();
    } else {
        const frente = document.getElementById('cartao-frente-input').innerHTML.trim();
        const verso = document.getElementById('cartao-verso-input').innerHTML.trim();
        if (!frente || frente === '<br>') return;
        corpo.frente = frente;
        corpo.verso = verso;
    }

    try {
        let res;
        if (cartaoEmEdicaoId) {
            res = await fetch(`/api/flashcards/cards/${cartaoEmEdicaoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo)
            });
        } else {
            res = await fetch(`/api/flashcards/baralhos/${baralhoAtualId}/cards`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo)
            });
        }
        const dados = await res.json();
        if (!dados.success) {
            alert(dados.error || 'Não foi possível salvar esse cartão.');
            return;
        }

        fecharModalCartao();

        if (cartaoEdicaoEmRevisao) {
            cartaoEdicaoEmRevisao = false;
            // Atualiza a fila de revisão do zero (somando de novo todos os
            // baralhos da sessão, mesmo quando é uma revisão de pasta inteira)
            // — o cartão editado continua devido, então ele deve reaparecer,
            // e a sessão continua normal.
            const idsFila = revisaoIdsAtual.length > 0 ? revisaoIdsAtual : [baralhoAtualId];
            filaRevisaoCache = await buscarFilaRevisaoParaIds(idsFila);
            mostrarProximoCartaoRevisao();
        } else {
            await abrirBaralho(baralhoAtualId);
        }
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

// --- SELEÇÃO EM MASSA DE CARTÕES (mover/copiar vários de uma vez) ---

let modoSelecaoCartoes = false;
let cartoesSelecionados = new Set();

function alternarModoSelecaoCartoes() {
    modoSelecaoCartoes = !modoSelecaoCartoes;
    if (!modoSelecaoCartoes) cartoesSelecionados.clear();
    atualizarBarraSelecaoCartoes();
    renderizarCartoesDoBaralho();
}

function cancelarSelecaoCartoes() {
    modoSelecaoCartoes = false;
    cartoesSelecionados.clear();
    atualizarBarraSelecaoCartoes();
    renderizarCartoesDoBaralho();
}

function toggleSelecaoCartao(id, marcado) {
    if (marcado) cartoesSelecionados.add(id);
    else cartoesSelecionados.delete(id);
    atualizarBarraSelecaoCartoes();
    renderizarCartoesDoBaralho();
}

// Alterna entre selecionar todos os cartões do baralho aberto e limpar a
// seleção — se já estiverem todos selecionados, o clique desmarca todos.
function alternarSelecaoTodosCartoes() {
    const todosJaSelecionados = cartoesDoBaralhoCache.length > 0
        && cartoesDoBaralhoCache.every(c => cartoesSelecionados.has(c._id));

    if (todosJaSelecionados) {
        cartoesSelecionados.clear();
    } else {
        cartoesDoBaralhoCache.forEach(c => cartoesSelecionados.add(c._id));
    }
    atualizarBarraSelecaoCartoes();
    renderizarCartoesDoBaralho();
}

function atualizarBarraSelecaoCartoes() {
    const btnToggle = document.getElementById('btn-toggle-selecao-cartoes');
    const acoes = document.getElementById('cartoes-selecao-acoes');
    const contador = document.getElementById('cartoes-selecao-contador');
    const btnTodos = document.getElementById('btn-selecionar-todos-cartoes');
    if (!btnToggle || !acoes) return;

    btnToggle.textContent = modoSelecaoCartoes ? '✖ Sair da seleção' : '☑️ Selecionar vários';
    acoes.style.display = modoSelecaoCartoes ? 'flex' : 'none';
    if (contador) contador.textContent = `${cartoesSelecionados.size} selecionado(s)`;

    if (btnTodos) {
        const todosJaSelecionados = cartoesDoBaralhoCache.length > 0
            && cartoesDoBaralhoCache.every(c => cartoesSelecionados.has(c._id));
        btnTodos.textContent = todosJaSelecionados ? '☐ Desmarcar todos' : '☑️ Selecionar todos';
    }
}

// --- MODAL: MOVER/COPIAR CARTÃO(ÕES) PRA OUTRO BARALHO ---
// O mesmo modal serve pro botão "↗️" de um cartão só e pra ação em massa —
// "moverEmMassaAtivo" decide se a confirmação usa o(s) cartão(ões)
// selecionado(s) ou só o cartaoParaMoverId de um clique individual.

let cartaoParaMoverId = null;
let moverEmMassaAtivo = false;

function preencherSelectDestinoCartao() {
    const select = document.getElementById('mover-cartao-destino-select');
    if (!select) return;
    const opcoes = baralhosCache
        .map(b => ({ id: b._id, rotulo: [...(b.caminho || []), b.nome].join(' › ') }))
        .filter(o => o.id !== baralhoAtualId)
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
    select.innerHTML = opcoes.map(o => `<option value="${o.id}">${o.rotulo}</option>`).join('');
}

function abrirModalMoverCartao(id) {
    cartaoParaMoverId = id;
    moverEmMassaAtivo = false;
    preencherSelectDestinoCartao();
    document.getElementById('modal-mover-cartao-overlay').style.display = 'flex';
}

function abrirModalMoverCartaoEmMassa() {
    if (cartoesSelecionados.size === 0) return alert('Selecione ao menos um cartão primeiro.');
    cartaoParaMoverId = null;
    moverEmMassaAtivo = true;
    preencherSelectDestinoCartao();
    document.getElementById('modal-mover-cartao-overlay').style.display = 'flex';
}

function fecharModalMoverCartao() {
    cartaoParaMoverId = null;
    moverEmMassaAtivo = false;
    document.getElementById('modal-mover-cartao-overlay').style.display = 'none';
}

async function confirmarMoverCopiarCartao(mover) {
    const destinoId = document.getElementById('mover-cartao-destino-select').value;
    if (!destinoId) return;

    try {
        let res;
        if (moverEmMassaAtivo) {
            if (cartoesSelecionados.size === 0) return;
            res = await fetch(`/api/flashcards/cards/${mover ? 'mover-em-massa' : 'copiar-em-massa'}`, {
                method: mover ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(cartoesSelecionados), baralhoId: destinoId })
            });
        } else {
            if (!cartaoParaMoverId) return;
            res = await fetch(`/api/flashcards/cards/${cartaoParaMoverId}/${mover ? 'mover' : 'copiar'}`, {
                method: mover ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baralhoId: destinoId })
            });
        }
        const dados = await res.json();
        if (!dados.success) {
            alert(dados.error || 'Não foi possível concluir a ação.');
            return;
        }
        const eraEmMassa = moverEmMassaAtivo;
        fecharModalMoverCartao();
        cancelarSelecaoCartoes();
        await abrirBaralho(baralhoAtualId);
        if (eraEmMassa && typeof dados.total === 'number') {
            alert(`${dados.total} cartão(ões) ${mover ? 'movido(s)' : 'copiado(s)'} com sucesso.`);
        }
    } catch (err) {
        console.error('Erro ao mover/copiar cartão:', err);
    }
}

// --- EXPORTAR / IMPORTAR BARALHO (JSON, pra compartilhar com outras pessoas) ---

async function exportarBaralhoAtual() {
    if (!baralhoAtualId) return;
    try {
        const res = await fetch(`/api/flashcards/baralhos/${baralhoAtualId}/exportar`);
        if (!res.ok) throw new Error('Falha ao exportar');
        const dados = await res.json();
        const baralho = baralhosCache.find(b => b._id === baralhoAtualId);
        const nomeArquivo = `baralho-${(baralho?.nome || 'checkestudos').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
        baixarArquivoJson(dados, nomeArquivo);
    } catch (err) {
        console.error('Erro ao exportar baralho:', err);
        alert('Não foi possível exportar esse baralho agora.');
    }
}

async function importarArquivoBaralho(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    try {
        const texto = await arquivo.text();
        const dados = JSON.parse(texto);

        const pastaTexto = prompt('Importar dentro de qual pasta? (opcional — deixe em branco pra criar como baralho(s) raiz)', '');
        event.target.value = '';
        if (pastaTexto === null) return; // cancelou

        const pastaDestino = lerCaminhoDoCampoPasta(pastaTexto);

        const res = await fetch('/api/flashcards/baralhos/importar-json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dados, pastaDestino })
        });
        const resultado = await res.json();

        if (!resultado.success) {
            alert(resultado.error || 'Não foi possível importar o arquivo.');
            return;
        }

        alert(`Importado! ${resultado.baralhosCriados} baralho(s) e ${resultado.cartoesCriados} cartão(ões) criados.`);
        await carregarFlashcards();
    } catch (err) {
        console.error('Erro ao importar baralho:', err);
        event.target.value = '';
        alert('Não foi possível importar esse arquivo — confira se é um JSON exportado pelo checkEstudos.');
    }
}

// --- SESSÃO DE REVISÃO (repetição espaçada, estilo SM-2/Anki) ---

// IDs dos baralhos envolvidos na sessão de revisão atual — um único id
// quando a revisão partiu de um baralho específico, ou vários quando
// partiu de "▶" numa pasta (revisando o tópico/subtópico inteiro).
let revisaoIdsAtual = [];

async function buscarFilaRevisaoParaIds(ids) {
    const listas = await Promise.all(ids.map(async id => {
        try {
            const res = await fetch(`/api/flashcards/baralhos/${id}/revisar`);
            return await res.json();
        } catch (err) {
            console.error('Erro ao carregar cartões pra revisar:', err);
            return [];
        }
    }));
    return listas.flat().sort((a, b) => new Date(a.dataProximaRevisao) - new Date(b.dataProximaRevisao));
}

// Aceita tanto um único id de baralho quanto uma lista de ids (revisão de
// uma pasta/tópico inteiro, somando os cartões pendentes de todos eles).
async function iniciarRevisao(idOuIds) {
    const ids = Array.isArray(idOuIds) ? idOuIds : [idOuIds];
    filaRevisaoCache = await buscarFilaRevisaoParaIds(ids);

    revisaoIdsAtual = ids;
    baralhoAtualId = ids.length === 1 ? ids[0] : null;
    if (filaRevisaoCache.length === 0) {
        alert('Não há cartões pendentes de revisão nesse baralho agora.');
        return;
    }

    mostrarTelaFlashcards('revisar');
    document.getElementById('flashcards-revisao-concluida').style.display = 'none';
    document.getElementById('flashcards-card-revisao').style.display = 'flex';
    document.getElementById('flashcards-respostas').style.display = 'none';
    const ultimaRespostaEl = document.getElementById('flashcards-revisar-ultima-resposta');
    if (ultimaRespostaEl) { ultimaRespostaEl.style.display = 'none'; ultimaRespostaEl.textContent = ''; }
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
    document.getElementById('flashcards-card-frente').style.display = 'block';
    document.getElementById('flashcards-card-verso').innerHTML = cartaoRevisaoAtual.verso || '<em>(sem verso)</em>';
    document.getElementById('flashcards-card-verso').style.display = 'none';
    document.getElementById('flashcards-card-verso').classList.remove('flashcards-card-verso-sozinho');
    document.getElementById('flashcards-card-dica').style.display = 'block';
    document.getElementById('flashcards-respostas').style.display = 'none';

    // Mostra em cima de cada botão daqui a quanto tempo o cartão volta se
    // essa for a resposta escolhida — igual ao Anki ("<10min", "2 dias"...).
    const previews = cartaoRevisaoAtual.previews || {};
    [0, 1, 2, 3].forEach(q => {
        const el = document.getElementById(`flashcards-preview-${q}`);
        if (el) el.textContent = previews[q] || '';
    });

    // Mostra de qual baralho/tópico esse cartão é — útil sobretudo revisando
    // um tópico inteiro (vários baralhos de uma vez), pra saber onde está.
    const origemEl = document.getElementById('flashcards-revisar-origem');
    if (origemEl) {
        const baralho = baralhosCache.find(b => b._id === cartaoRevisaoAtual.baralhoId);
        origemEl.textContent = baralho ? '📘 ' + [...(baralho.caminho || []), baralho.nome].join(' › ') : '';
    }
}

function mostrarRespostaRevisao() {
    if (respostaRevisaoRevelada || !cartaoRevisaoAtual) return;
    respostaRevisaoRevelada = true;

    // Num cartão de omissão (cloze), a "frente" e o "verso" são a MESMA
    // frase — só muda o trecho que estava escondido (que no verso já vem
    // destacado em azul, pronto). Mostrar os dois juntos duplicava a frase
    // inteira na tela sem necessidade; nesse caso a gente troca a frente
    // pelo verso, em vez de empilhar os dois. Num cartão básico (pergunta
    // separada da resposta), continua mostrando os dois, porque aí o
    // conteúdo é mesmo diferente.
    if (cartaoRevisaoAtual.tipo === 'cloze') {
        document.getElementById('flashcards-card-frente').style.display = 'none';
        document.getElementById('flashcards-card-verso').classList.add('flashcards-card-verso-sozinho');
    }
    document.getElementById('flashcards-card-verso').style.display = 'block';
    document.getElementById('flashcards-card-dica').style.display = 'none';
    document.getElementById('flashcards-respostas').style.display = 'grid';
}

const RESPOSTA_REVISAO_ROTULOS = ['❌ Errei', '😓 Difícil', '👍 Bom', '😄 Fácil'];

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

    // Mostra o resultado da resposta que acabou de ser dada (fica visível
    // até a próxima resposta) — usa o preview que já veio junto com o
    // cartão, calculado com o estado de ANTES de responder.
    const ultimaRespostaEl = document.getElementById('flashcards-revisar-ultima-resposta');
    if (ultimaRespostaEl) {
        const previewTexto = (cartaoRespondido.previews || {})[qualidade];
        ultimaRespostaEl.textContent = `${RESPOSTA_REVISAO_ROTULOS[qualidade]} — próxima revisão em ${previewTexto || '...'}`;
        ultimaRespostaEl.style.display = 'block';
    }

    filaRevisaoCache = filaRevisaoCache.filter(c => c._id !== cartaoRespondido._id);
    mostrarProximoCartaoRevisao();
}

function sairRevisao() {
    cartaoRevisaoAtual = null;
    filaRevisaoCache = [];
    revisaoIdsAtual = [];
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

// Chaves de seleção: o id do tópico (quando ele não tem subtópicos), ou
// "topicoId::subtopicoId" (quando a pessoa marcou um subtópico específico).
let topicosSelecionadosSessao = new Set();
// Id da sessão em edição (null quando o modal está criando uma sessão nova)
let idSessaoEmEdicao = null;
// Tópicos/subtópicos da sessão em edição que não existem mais no plano
// selecionado no modal (apagados ou desvinculados) — preservados ao salvar.
let topicosExtrasSessaoEmEdicao = [];
// Tópicos disponíveis pro plano selecionado NO MODAL — independente do
// plano/aba aberta no resto do app, já que a pessoa pode finalizar uma
// sessão de um plano diferente do que está vendo no momento.
let sessaoTopicosDisponiveis = [];
// Guarda qual plano está carregado no momento no modal (pra poder reverter o
// <select> se a pessoa cancelar a troca por ter seleção em andamento).
let sessaoPlanoCarregadoAtual = null;
// Estado (só de tela, reseta a cada abertura do modal) de quais matérias e
// tópicos-com-subtópicos estão expandidos na árvore de seleção.
let sessaoMateriasExpandidas = new Set();
let sessaoTopicosExpandidos = new Set();

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

// Valor especial do <select> pra "Todos os planos" — não é o nome de um
// plano de verdade (evita colidir com um plano que a pessoa batize de
// "Todos"), só um sinalizador pro resto do código saber que é pra buscar
// tópicos de TODOS os planos ao mesmo tempo.
const SESSAO_PLANO_TODOS = '__todos__';

// Preenche o seletor "Edital (plano)" do modal de sessão com "Todos os
// planos" + os planos disponíveis, selecionando o nome informado (se
// existir na lista, ou o próprio "Todos").
function preencherSeletorPlanoSessao(nomeSelecionado) {
    const select = document.getElementById('sessao-plano-select');
    if (!select) return;
    const opcaoTodos = `<option value="${SESSAO_PLANO_TODOS}">Todos os planos</option>`;
    const opcoesPlanos = planosDisponiveis.map(p =>
        `<option value="${p.nome.replace(/"/g, '&quot;')}">${p.nome}</option>`
    ).join('');
    select.innerHTML = opcaoTodos + opcoesPlanos;
    if (nomeSelecionado === SESSAO_PLANO_TODOS || planosDisponiveis.some(p => p.nome === nomeSelecionado)) {
        select.value = nomeSelecionado;
    } else {
        select.value = SESSAO_PLANO_TODOS;
    }
}

// Busca os tópicos a mostrar no modal pro plano selecionado — ou de TODOS os
// planos do usuário, se "Todos os planos" estiver escolhido.
async function buscarTopicosDoPlanoSessao(nomePlano) {
    try {
        const url = nomePlano === SESSAO_PLANO_TODOS ? '/api/edital' : `/api/edital?plano=${encodeURIComponent(nomePlano)}`;
        const res = await fetch(url);
        return await res.json();
    } catch (err) {
        console.error('Erro ao carregar tópicos do plano selecionado:', err);
        return [];
    }
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

    // Por padrão mostra os tópicos de TODOS os planos (mais fácil de achar o
    // tópico certo sem ter que lembrar em qual plano ele está) — a pessoa
    // pode filtrar por um plano específico no seletor, se quiser.
    preencherSeletorPlanoSessao(SESSAO_PLANO_TODOS);
    sessaoPlanoCarregadoAtual = SESSAO_PLANO_TODOS;
    sessaoTopicosDisponiveis = [];
    buscarTopicosDoPlanoSessao(SESSAO_PLANO_TODOS).then(itens => {
        sessaoTopicosDisponiveis = itens;
        renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
    });
    topicosSelecionadosSessao = new Set();
    sessaoMateriasExpandidas = new Set();
    sessaoTopicosExpandidos = new Set();

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

// Chamado quando a pessoa troca o plano/edital no select do modal — busca os
// tópicos daquele plano (sem afetar a aba de Edital aberta no resto do app)
// e limpa a seleção de tópicos, já que ela é específica de cada plano.
async function trocarPlanoSessaoModal() {
    const select = document.getElementById('sessao-plano-select');
    if (!select) return;
    const novoPlano = select.value;

    if (topicosSelecionadosSessao.size > 0) {
        if (!confirm('Trocar o plano/edital vai limpar os tópicos selecionados até agora. Continuar?')) {
            select.value = sessaoPlanoCarregadoAtual || novoPlano;
            return;
        }
    }

    sessaoTopicosDisponiveis = await buscarTopicosDoPlanoSessao(novoPlano);

    sessaoPlanoCarregadoAtual = novoPlano;
    topicosSelecionadosSessao = new Set();
    topicosExtrasSessaoEmEdicao = [];
    sessaoMateriasExpandidas = new Set();
    sessaoTopicosExpandidos = new Set();
    renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
}

// Abre o mesmo modal, mas pré-preenchido para editar uma sessão já registrada
// (usada pelo botão de editar no histórico de sessões). É assíncrona porque
// busca os tópicos do plano AO QUAL A SESSÃO PERTENCE (que pode não ser o
// plano/aba aberto no momento no resto do app).
async function abrirModalEdicaoSessao(id) {
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

    // Sugere o plano ao qual a sessão pertence (não necessariamente o que
    // está aberto na tela agora) — se ele não existir mais, cai pro atual.
    const planoDaSessao = planosDisponiveis.some(p => p.nome === sessao.plano) ? sessao.plano : planoAtual;
    preencherSeletorPlanoSessao(planoDaSessao);
    sessaoPlanoCarregadoAtual = planoDaSessao;
    try {
        const res = await fetch(`/api/edital?plano=${encodeURIComponent(planoDaSessao)}`);
        sessaoTopicosDisponiveis = await res.json();
    } catch (err) {
        console.error('Erro ao carregar tópicos do plano da sessão:', err);
        sessaoTopicosDisponiveis = [];
    }

    const topicosDaSessao = sessao.topicos || [];
    topicosSelecionadosSessao = new Set(
        topicosDaSessao.map(t => t.subtopicoId ? `${t.topicoId}::${t.subtopicoId}` : t.topicoId)
    );

    // Preserva tópicos/subtópicos que já não existem mais no plano da sessão
    // (apagados ou desvinculados), pra não perdê-los ao salvar.
    topicosExtrasSessaoEmEdicao = topicosDaSessao.filter(t => {
        const item = sessaoTopicosDisponiveis.find(i => i._id === t.topicoId);
        if (!item) return true;
        if (t.subtopicoId) {
            return !(Array.isArray(item.subtopicos) && item.subtopicos.some(s => s.id === t.subtopicoId));
        }
        // Selecionado como tópico inteiro na época, mas hoje esse tópico virou
        // um container de subtópicos — preserva como estava, em vez de sumir.
        return Array.isArray(item.subtopicos) && item.subtopicos.length > 0;
    });

    // Já abre expandido nas matérias/tópicos que tiverem algo selecionado,
    // pra pessoa ver de cara o que estava marcado antes.
    sessaoMateriasExpandidas = new Set();
    sessaoTopicosExpandidos = new Set();
    sessaoTopicosDisponiveis.forEach(item => {
        const selecionadoInteiro = topicosSelecionadosSessao.has(item._id);
        const temSubSelecionado = Array.isArray(item.subtopicos) &&
            item.subtopicos.some(s => topicosSelecionadosSessao.has(`${item._id}::${s.id}`));
        if (selecionadoInteiro || temSubSelecionado) {
            sessaoMateriasExpandidas.add(item.materia);
            if (temSubSelecionado) sessaoTopicosExpandidos.add(item._id);
        }
    });

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

// Conta quantos itens marcáveis (o tópico inteiro, ou seus subtópicos um a
// um) estão selecionados dentro de um tópico — usado pro contador ao lado
// do nome da matéria/tópico na árvore.
function contarSelecionadosItemSessao(item) {
    if (Array.isArray(item.subtopicos) && item.subtopicos.length > 0) {
        return item.subtopicos.filter(s => topicosSelecionadosSessao.has(`${item._id}::${s.id}`)).length;
    }
    return topicosSelecionadosSessao.has(item._id) ? 1 : 0;
}

// Renderiza um tópico dentro da árvore de seleção — como um checkbox simples
// (sem subtópicos) ou como um nó expansível com um checkbox por subtópico
// (mesma lógica de "quem tem subtópicos não tem check próprio" do Edital).
function renderizarItemTopicoSessao(item, forcarExpandido) {
    const temSubtopicos = Array.isArray(item.subtopicos) && item.subtopicos.length > 0;

    if (!temSubtopicos) {
        return `
            <label class="sessao-topico-item">
                <input type="checkbox" value="${item._id}" ${topicosSelecionadosSessao.has(item._id) ? 'checked' : ''}
                    onchange="toggleTopicoSessao('${item._id}')">
                ${escaparHtml(item.topico)}
            </label>
        `;
    }

    const expandido = forcarExpandido || sessaoTopicosExpandidos.has(item._id);
    const selecionados = item.subtopicos.filter(s => topicosSelecionadosSessao.has(`${item._id}::${s.id}`)).length;

    return `
        <div class="sessao-topico-com-subtopicos">
            <div class="sessao-topico-titulo" onclick="toggleTopicoSessaoExpandido('${item._id}')">
                <span class="seta-sessao">${expandido ? '▾' : '▸'}</span>
                <span class="sessao-topico-titulo-texto">${escaparHtml(item.topico)}</span>
                <span class="sessao-subtopicos-contador">${selecionados}/${item.subtopicos.length}</span>
            </div>
            ${expandido ? `
                <div class="sessao-subtopicos-lista">
                    ${item.subtopicos.map(sub => `
                        <label class="sessao-topico-item sessao-subtopico-item">
                            <input type="checkbox" value="${sub.id}" ${topicosSelecionadosSessao.has(`${item._id}::${sub.id}`) ? 'checked' : ''}
                                onchange="toggleSubtopicoSessao('${item._id}', '${sub.id}')">
                            ${escaparHtml(sub.texto)}
                        </label>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

// Árvore de seleção: Matéria → Tópico → Subtópico, cada nível expansível —
// com busca ativa, tudo fica forçado expandido pra não esconder resultados.
function renderizarTopicosSessao(filtro) {
    const container = document.getElementById('sessao-topicos-lista');
    if (!container) return;

    const termo = (filtro || '').toLowerCase();
    const grupos = sessaoTopicosDisponiveis.reduce((acc, item) => {
        const combinaSubtopico = Array.isArray(item.subtopicos) && item.subtopicos.some(s => s.texto.toLowerCase().includes(termo));
        const combina = !termo || item.materia.toLowerCase().includes(termo) || item.topico.toLowerCase().includes(termo) || combinaSubtopico;
        if (!combina) return acc;
        acc[item.materia] = acc[item.materia] || [];
        acc[item.materia].push(item);
        return acc;
    }, {});

    const materias = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    let html = '';

    if (materias.length === 0 && topicosExtrasSessaoEmEdicao.length === 0) {
        html = `<div class="sessao-topicos-vazio">Nenhum tópico encontrado. Cadastre tópicos na aba Edital.</div>`;
    } else {
        const forcarExpandido = !!termo;

        html = materias.map(materia => {
            const expandida = forcarExpandido || sessaoMateriasExpandidas.has(materia);
            const totalSelecionados = grupos[materia].reduce((n, item) => n + contarSelecionadosItemSessao(item), 0);
            const materiaEscapada = escaparParaOnclick(materia);

            return `
                <div class="sessao-materia-grupo">
                    <div class="sessao-materia-titulo" onclick="toggleMateriaSessaoExpandida('${materiaEscapada}')">
                        <span class="seta-sessao">${expandida ? '▾' : '▸'}</span>
                        <span>${escaparHtml(materia)}</span>
                        ${totalSelecionados > 0 ? `<span class="sessao-selecionados-badge">${totalSelecionados}</span>` : ''}
                    </div>
                    ${expandida ? `
                        <div class="sessao-materia-topicos">
                            ${grupos[materia].map(item => renderizarItemTopicoSessao(item, forcarExpandido)).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        if (topicosExtrasSessaoEmEdicao.length > 0) {
            html += `
                <div class="sessao-materia-grupo">
                    <div class="sessao-materia-titulo sessao-materia-titulo-fixa">Outros (fora do edital atual)</div>
                    <div class="sessao-materia-topicos">
                        ${topicosExtrasSessaoEmEdicao.map(t => `
                            <label class="sessao-topico-item sessao-topico-item-fixo">
                                <input type="checkbox" checked disabled>
                                ${t.subtopicoId ? (t.subtopico || t.topico) : t.topico}
                                <span class="sessao-topico-materia-extra">(${t.materia}${t.subtopicoId ? ` → ${t.topico}` : ''})</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }

    container.innerHTML = html;
}

function filtrarTopicosSessao() {
    renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
}

function toggleMateriaSessaoExpandida(materia) {
    if (sessaoMateriasExpandidas.has(materia)) sessaoMateriasExpandidas.delete(materia);
    else sessaoMateriasExpandidas.add(materia);
    renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
}

function toggleTopicoSessaoExpandido(topicoId) {
    if (sessaoTopicosExpandidos.has(topicoId)) sessaoTopicosExpandidos.delete(topicoId);
    else sessaoTopicosExpandidos.add(topicoId);
    renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
}

function toggleTopicoSessao(id) {
    if (topicosSelecionadosSessao.has(id)) topicosSelecionadosSessao.delete(id);
    else topicosSelecionadosSessao.add(id);
    renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
}

function toggleSubtopicoSessao(topicoId, subId) {
    const chave = `${topicoId}::${subId}`;
    if (topicosSelecionadosSessao.has(chave)) topicosSelecionadosSessao.delete(chave);
    else topicosSelecionadosSessao.add(chave);
    renderizarTopicosSessao(document.getElementById('sessao-busca-topicos').value);
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

    // Monta a lista de tópicos/subtópicos selecionados: um tópico sem
    // subtópicos entra inteiro (topicoId), um tópico com subtópicos entra
    // um item por subtópico marcado (topicoId + subtopicoId).
    const topicos = [];
    sessaoTopicosDisponiveis.forEach(item => {
        if (Array.isArray(item.subtopicos) && item.subtopicos.length > 0) {
            item.subtopicos.forEach(sub => {
                if (topicosSelecionadosSessao.has(`${item._id}::${sub.id}`)) {
                    topicos.push({
                        topicoId: item._id, materia: item.materia, topico: item.topico,
                        subtopicoId: sub.id, subtopico: sub.texto
                    });
                }
            });
        } else if (topicosSelecionadosSessao.has(item._id)) {
            topicos.push({ topicoId: item._id, materia: item.materia, topico: item.topico });
        }
    });
    topicosExtrasSessaoEmEdicao.forEach(t => {
        const jaExiste = topicos.find(x => x.topicoId === t.topicoId && x.subtopicoId === t.subtopicoId);
        if (!jaExiste) topicos.push(t);
    });

    const revisaoMarcada = document.getElementById('sessao-revisao-check').checked;
    const revisaoDias = parseInt(document.getElementById('sessao-revisao-dias').value) || 7;

    // "Todos os planos" é só um jeito de FILTRAR/ACHAR o tópico na hora de
    // marcar — não é um plano de verdade, então nunca pode ser salvo como o
    // "plano" da sessão (isso é usado como fallback pra sessões sem tópico
    // vinculado a nenhum plano específico; salvar "__todos__" ali faria a
    // sessão sumir de todas as telas de plano). Cai pro plano que está aberto
    // no resto do app nesse caso.
    const planoSelecionadoBruto = document.getElementById('sessao-plano-select').value;
    const planoSelecionadoModal = (planoSelecionadoBruto && planoSelecionadoBruto !== SESSAO_PLANO_TODOS)
        ? planoSelecionadoBruto
        : planoAtual;

    const corpo = {
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        duracaoSegundos,
        plano: planoSelecionadoModal,
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

// Rótulo do cabeçalho de cada grupo de data — "Hoje" / "Ontem" / dia da
// semana + data, igual à ordenação por data do Windows Explorer.
function rotuloDataHistorico(data) {
    const hojeISO = formatarDataISO(new Date());
    const ontemISO = formatarDataISO(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const iso = formatarDataISO(data);
    if (iso === hojeISO) return 'Hoje';
    if (iso === ontemISO) return 'Ontem';
    const rotulo = data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    return rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
}

function renderizarCardHistorico(s) {
    const data = new Date(s.fim);
    const horario = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
                <span class="historico-data" title="Horário">${horario}</span>
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
}

// Agrupa o histórico por data (já vem do servidor ordenado do mais recente
// pro mais antigo) — cada grupo de data vira uma "linha" com cabeçalho
// (Hoje/Ontem/dia da semana), e só cartões da MESMA data ficam lado a lado
// dentro dela, igual a ordenação por data do Windows Explorer.
function renderizarHistorico() {
    const lista = document.getElementById('lista-historico');
    if (!lista) return;

    if (sessoesCache.length === 0) {
        lista.innerHTML = `<div class="lista-vazia">Nenhuma sessão registrada ainda neste plano. Inicie o cronômetro para começar!</div>`;
        return;
    }

    const sessoes = sessoesCache.slice(0, 60);
    const grupos = [];
    let grupoAtual = null;
    sessoes.forEach(s => {
        const dataItem = new Date(s.fim);
        const iso = formatarDataISO(dataItem);
        if (!grupoAtual || grupoAtual.iso !== iso) {
            grupoAtual = { iso, data: dataItem, itens: [] };
            grupos.push(grupoAtual);
        }
        grupoAtual.itens.push(s);
    });

    lista.innerHTML = grupos.map(grupo => `
        <div class="historico-data-grupo">
            <div class="historico-data-cabecalho">${rotuloDataHistorico(grupo.data)}</div>
            <div class="historico-data-linha">
                ${grupo.itens.map(s => renderizarCardHistorico(s)).join('')}
            </div>
        </div>
    `).join('');
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
    renderizarMapaDificuldadesFlashcards();
    renderizarConquistas();
}

// ==================================================================
// MAPA DE DIFICULDADES DOS FLASHCARDS (baralhos com mais "Errei"/"Difícil")
// ==================================================================
async function renderizarMapaDificuldadesFlashcards() {
    const container = document.getElementById('mapa-dificuldades-flashcards');
    if (!container) return;

    let lista = [];
    try {
        const res = await fetch('/api/flashcards/dificuldades');
        lista = await res.json();
    } catch (err) {
        console.error('Erro ao carregar mapa de dificuldades dos flashcards:', err);
    }

    if (!Array.isArray(lista) || lista.length === 0) {
        container.innerHTML = `<div class="lista-vazia">Responda pelo menos algumas revisões de flashcards (Errei/Difícil/Bom/Fácil) pra ver esse mapa aqui.</div>`;
        return;
    }

    container.innerHTML = lista.map(b => {
        const perc = Math.round(b.taxaErro * 100);
        const subtitulo = b.caminho.length > 0 ? b.caminho.join(' › ') : (b.materia || '');
        return `
            <div class="dificuldade-linha">
                <div class="dificuldade-nomes">
                    <div class="dificuldade-topico" title="${b.nome}">📘 ${b.nome}</div>
                    ${subtitulo ? `<div class="dificuldade-materia">${subtitulo}</div>` : ''}
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

    let totalItens = 0;
    let concluidos = 0;
    itensAtuais.forEach(item => {
        const { total, concluidos: c } = contarProgressoItem(item);
        totalItens += total;
        concluidos += c;
    });
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

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const nomeArquivo = `conquista-${def.id}.png`;

        // No celular, tenta abrir a folha de compartilhamento nativa do
        // sistema (Web Share API) — é ali que o Instagram Stories aparece
        // como opção, junto com WhatsApp e outros apps. Não existe uma forma
        // confiável de pular essa folha e abrir direto no Stories a partir
        // de um site (isso só é possível para apps nativos registrados no
        // Meta for Developers). Em navegadores/computadores sem suporte,
        // cai no comportamento antigo de baixar a imagem.
        const arquivo = new File([blob], nomeArquivo, { type: 'image/png' });
        const podeCompartilhar = navigator.canShare && navigator.canShare({ files: [arquivo] });

        if (podeCompartilhar) {
            try {
                await navigator.share({
                    files: [arquivo],
                    title: def.nome,
                    text: `Desbloqueei a conquista "${def.nome}" no Direto à Posse! 🎯`
                });
            } catch (err) {
                // AbortError = a pessoa cancelou a folha de compartilhamento
                // de propósito — não é um erro de verdade, não faz nada.
                if (err && err.name !== 'AbortError') {
                    console.error('Erro ao compartilhar conquista:', err);
                }
            }
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nomeArquivo;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        }
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
    const hojeISO = formatarDataISO(new Date());
    let totalSegundosHoje = 0;

    sessoesCache.forEach(s => {
        totalSegundos += s.duracaoSegundos;
        if (s.duracaoSegundos > 0) diasComEstudo.add(formatarDataISO(new Date(s.fim)));
        if (formatarDataISO(new Date(s.fim)) === hojeISO) totalSegundosHoje += s.duracaoSegundos;

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
        <div class="stat-card stat-card-destaque">
            <span class="stat-card-label">⏱ Estudado hoje</span>
            <span class="stat-card-valor">${formatarDuracaoCurta(totalSegundosHoje)}</span>
        </div>
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
        const materiaEscapada = escaparParaOnclick(materia);
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
                    onclick="abrirSeletorCorMateria('${materiaEscapada}')" title="Trocar cor de ${escaparHtml(materia)}"></button>
                <div class="materia-indicador-corpo" onclick="alternarIndicadorMateria('${materiaEscapada}')" style="cursor:pointer;">
                    <div class="materia-indicador-topo">
                        <span class="materia-indicador-nome">
                            <span class="materia-indicador-seta">${expandida ? '▾' : '▸'}</span> ${escaparHtml(materia)}
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
