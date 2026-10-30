// Leitura de leis (texto compilado do Planalto) para a aba "Leis".
//
// Este módulo é PURO (não mexe em Mongo nem em Express) para poder ser testado
// com um HTML salvo em disco. Faz três coisas:
//   1. parseLeiHtml  — HTML do Planalto -> lista ordenada de itens (estrutura,
//      artigos, §, incisos, alíneas) com id ESTÁVEL, texto, notas legislativas
//      e flag de revogado.
//   2. validarLei    — trava de segurança: recusa um parse "estranho" (ex.: o
//      Planalto mudou o HTML) para nunca substituir uma versão boa por lixo.
//   3. compararLeis  — diferença entre duas versões, agrupada por artigo, que
//      alimenta o "o que mudou" da aba.
//
// Por que id estável: o grifo do aluno se prende em (lei, id do dispositivo,
// posição no texto). Se o id dependesse da ordem no HTML, qualquer inclusão de
// artigo quebraria todos os grifos seguintes.

import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

// Catálogo das leis. Cada lei é um texto compilado do Planalto; as diferenças de
// formato entre elas (ADCT, rubricas, onde o texto começa/termina) ficam aqui.
//   arquivo      HTML salvo em ferramentas/dados/ (carga inicial sem depender da rede)
//   minArtigos   piso de artigos: abaixo disso o parse é considerado quebrado
//   sentinelas   ids que TÊM de existir (conferência extra contra página quebrada)
//   inicio       regex da linha a partir da qual o texto da lei começa (pula o decreto/ementa)
//   terminador   regex da linha de data/assinatura que encerra o texto
//   fimAposArtigo id do último artigo, quando a lei não termina com data (ex.: CLT + anexos)
//   rubricas     o Planalto traz o título de cada artigo em linha própria (Código Penal)
export const LEIS = {
    cf: {
        id: 'cf', nome: 'Constituição Federal', sigla: 'CF/88',
        url: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm',
        arquivo: 'constituicao.htm',
        minArtigos: 300, sentinelas: ['art-5', 'adct-art-1'],
        temAdct: true   // a CF tem o ADCT na mesma página; seus artigos recomeçam do 1º
    },
    cp: {
        id: 'cp', nome: 'Código Penal', sigla: 'CP',
        url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm',
        arquivo: 'codigo-penal.htm', cabecalhosH: true, descartarSuperados: true,
        minArtigos: 330, sentinelas: ['art-1', 'art-121', 'art-361'],
        terminador: /^(Rio de Janeiro|Bras[ií]lia),\s+\d+\s*[º°o]?\s+de\s+\S+\s+de\s+\d{4}/i,
        rubricas: true
    },
    cc: {
        id: 'cc', nome: 'Código Civil', sigla: 'CC',
        url: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm',
        arquivo: 'codigo-civil.htm', cabecalhosH: true, descartarSuperados: true,
        minArtigos: 1900, sentinelas: ['art-1', 'art-1196', 'art-2046'],
        terminador: /^(Rio de Janeiro|Bras[ií]lia),\s+\d+\s*[º°o]?\s+de\s+\S+\s+de\s+\d{4}/i
    },
    cpc: {
        id: 'cpc', nome: 'Código de Processo Civil', sigla: 'CPC',
        url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm',
        arquivo: 'cpc.htm', cabecalhosH: true, descartarSuperados: true, versoes: true,
        minArtigos: 1000, sentinelas: ['art-1', 'art-300', 'art-1072'],
        terminador: /^(Rio de Janeiro|Bras[ií]lia),\s+\d+\s*[º°o]?\s+de\s+\S+\s+de\s+\d{4}/i
    },
    clt: {
        id: 'clt', nome: 'Consolidação das Leis do Trabalho', sigla: 'CLT',
        url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm',
        arquivo: 'clt.htm', cabecalhosH: true, descartarSuperados: true, versoes: true,
        minArtigos: 900, sentinelas: ['art-1', 'art-58', 'art-922'],
        // O HTML começa com o decreto que aprova a CLT (cujo "Art. 1º" não é o da CLT) e termina com anexos.
        inicio: /^CONSOLIDAÇÃO DAS LEIS DO TRABALHO$/,
        fimAposArtigo: 'art-922'
    }
};

const RE_NOTA = /\((?:Redação dada|Redação anterior|Incluíd[oa]|Revogad[oa]|Vide|Regulament|Vigência|Produção de efeito|Promulgaç|Declarad|Suspens|Expressão|Execução|Texto|Renumerad|Acrescid|Alterad|Veto|Vetad|Prazo|Eficácia)[^()]*(?:\([^()]*\)[^()]*)*\)/gi;

const RE_ESTRUTURA = /^(PARTE|LIVRO|T[IÍ]TULO|SUBT[IÍ]TULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO)\s+([IVXLCDM]+(?:-[A-Z])?|ÚNIC[OA]|GERAL|ESPECIAL|COMPLEMENTAR)\b/i;
// "Art. 1º", "Art. 121-A.", "Art. 1.045.", "Art. 99 - A pena..." (aqui o "- A" é texto, não sufixo:
// sufixo de verdade vem COLADO ao número) e os erros de digitação do Planalto ("Art . 168", "Art. . 188").
const RE_ARTIGO = /^Art\s*\.{0,2}\s*(\d+(?:\.\d{3})*)\s*(?:[º°]|o(?![a-zA-Zà-ú]))?(?:-([A-Z]{1,2}(?:-[A-Z]{1,2})*)(?![a-zà-ú]))?/;
const RE_PARAGRAFO = /^(?:§{1,2}\s*(\d+)\s*[º°o]?\s*(?:-\s*([A-Z]))?|Parágrafo\s+único)/i;
const RE_INCISO = /^([IVXLCDM]+)(?:\s*-\s*([A-Z]))?\s*[-–—]\s*/;
// Inciso incluído por emenda: "I-A o Conselho..." (letra colada ao número, sem 2º travessão).
const RE_INCISO_SUFIXO = /^([IVXLCDM]+)-([A-Z])\s+/;
const RE_ALINEA = /^([a-z])\)\s*/;
const RE_ITEM = /^(\d{1,2})\s*[.)-]\s+/;
const RE_PENA = /^Pen[ae]s?\s*[-–—]/;   // "Pena - reclusão, de..." (Código Penal)

const NIVEL_ESTRUTURA = { parte: 0, livro: 1, titulo: 2, subtitulo: 3, capitulo: 4, secao: 5, subsecao: 6 };
const NOMES_ESTRUTURA = { PARTE: 'parte', LIVRO: 'livro', 'TÍTULO': 'titulo', TITULO: 'titulo', 'SUBTÍTULO': 'subtitulo', SUBTITULO: 'subtitulo', 'CAPÍTULO': 'capitulo', 'SEÇÃO': 'secao', 'SUBSEÇÃO': 'subsecao' };

function limpar(str) {
    return String(str || '').replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function hashItem(item) {
    return createHash('sha1')
        .update(`${item.texto || ''}|${(item.notas || []).join(';')}|${item.revogado ? 1 : 0}|${item.rot || ''}|${item.nome || ''}${item.rubrica ? '|' + item.rubrica : ''}`)
        .digest('hex')
        .slice(0, 16);
}

// Garante id único: se o mesmo id aparecer de novo (ex.: texto repetido), anexa ~2, ~3...
function criarGeradorIds() {
    const usados = new Map();
    return id => {
        const n = (usados.get(id) || 0) + 1;
        usados.set(id, n);
        return n === 1 ? id : `${id}~${n}`;
    };
}

// Separa o texto "vigente" do texto riscado (revogado) de um <p>.
// Retorna { texto, revogado }. Se mais da metade do conteúdo está riscada, o
// dispositivo inteiro é tratado como revogado (e o texto riscado é mantido,
// para o aluno ainda poder ler o que foi revogado).
// O HTML do Planalto (FrontPage) tem <font>/<span> mal fechados que fazem alguns
// parsers "fecharem" o <p> antes do texto do artigo (ex.: o caput do art. 57 some).
// Por isso cada <p> é isolado por texto (do "<p" até o "</p>") e interpretado
// sozinho: um erro de aninhamento nunca atravessa para o parágrafo vizinho.
function lerFragmento(frag) {
    const html = '<p' + frag.split(/<\/(?:p|h[1-6])\s*>/i)[0] + '</p>';
    const $ = cheerio.load(html, null, false);
    const total = limpar($.root().text());
    $('strike, s, del').remove();
    const vigente = limpar($.root().text());
    return { total, vigente };
}

// Separa o texto "vigente" do texto riscado (revogado) de um parágrafo.
// Se mais da metade do conteúdo está riscada, o dispositivo inteiro é tratado
// como revogado (e o texto riscado é mantido, para o aluno ainda poder ler).
function lerParagrafo(total, vigente) {
    if (!total) return { texto: '', revogado: false };
    const riscado = total.length - vigente.length;
    const revogadoPorRisco = riscado > 0 && riscado >= total.length * 0.5;
    // Texto riscado SEM a palavra "Revogado" é uma redação antiga que o Planalto mantém na página
    // logo antes da nova (CLT, CPC): não é um dispositivo revogado, é uma versão superada.
    if (revogadoPorRisco) return { texto: total, revogado: true, superado: !/revogad/i.test(total) };
    return { texto: vigente, revogado: /\(\s*Revogad[oa]\b/i.test(vigente) && vigente.replace(RE_NOTA, '').length < 40 };
}

function extrairNotas(texto) {
    const notas = [];
    const semNotas = texto.replace(RE_NOTA, m => {
        notas.push(limpar(m.slice(1, -1)));
        return ' ';
    });
    return { texto: limpar(semNotas), notas };
}


// Algumas páginas (CLT, CPC) mantêm TODAS as redações históricas de um mesmo dispositivo, uma
// depois da outra (ex.: art. 47 da CLT aparece 5 vezes: original, Decreto-lei 229, Lei 13.467,
// MP 905...). Para o aluno só interessa a redação em vigor: entre as repetidas, fica a ÚLTIMA que
// não esteja marcada como revogada / "vigência encerrada" (se todas estiverem, fica a última).
// O dispositivo carrega junto seus filhos (§, incisos, alíneas), então uma redação antiga do
// artigo some por inteiro, com tudo o que estava debaixo dela.
function podarVersoes(itens) {
    const chaveDe = (it) => it.k === 'art' ? it.id.replace(/~\d+$/, '') : it.id.split('.').pop().replace(/~\d+$/, '');
    const ruim = (it) => !!it.revogado || (it.notas || []).some(n => /Vig[êe]ncia encerrada|Revogad/i.test(n));
    const fim = (i, hi) => { let j = i + 1; while (j < hi && itens[j].k !== 'est' && itens[j].nivel > itens[i].nivel) j++; return j; };
    const saida = [];
    const filtrar = (lo, hi) => {
        const nos = [];
        for (let i = lo; i < hi;) {
            const it = itens[i];
            if (it.k === 'est' || it.k === 'pena') { saida.push({ i, j: i + 1, solto: true }); i++; continue; }
            const j = fim(i, hi);
            nos.push({ i, j, chave: chaveDe(it), ordem: saida.length });
            saida.push({ i, j, no: nos[nos.length - 1] });
            i = j;
        }
        // Escolhe a redação vigente de cada chave repetida.
        const porChave = new Map();
        for (const n of nos) { if (!porChave.has(n.chave)) porChave.set(n.chave, []); porChave.get(n.chave).push(n); }
        const vence = new Set();
        for (const lista of porChave.values()) {
            const bons = lista.filter(n => !ruim(itens[n.i]));
            vence.add((bons.length ? bons[bons.length - 1] : lista[lista.length - 1]));
        }
        return vence;
    };
    // Percorre em largura por nível: cada chamada decide os irmãos de um mesmo pai.
    const resultado = [];
    const desce = (lo, hi) => {
        const ini = saida.length;
        const vence = filtrar(lo, hi);
        const meus = saida.splice(ini);
        for (const m of meus) {
            if (m.solto) { resultado.push(itens[m.i]); continue; }
            if (!vence.has(m.no)) continue;
            resultado.push(itens[m.i]);
            if (m.j > m.i + 1) desce(m.i + 1, m.j);
        }
    };
    desce(0, itens.length);
    // Títulos/capítulos também ficam repetidos quando a página mantém o nome antigo e o novo
    // (ex.: TÍTULO VII da CLT). Se o mesmo cabeçalho reaparece sem nenhum artigo no meio, o anterior
    // (e o que estava pendurado nele) era uma redação velha: sai.
    const base = (id) => id.replace(/~\d+/g, '');
    const ultimoEst = new Map();   // id sem ~ -> posição em 'resultado'
    const sai = new Set();
    let nArts = 0;
    const nArtsEm = [];
    resultado.forEach((it, p) => {
        nArtsEm[p] = nArts;
        if (it.k === 'art') nArts++;
        if (it.k !== 'est') return;
        const b = base(it.id);
        if (ultimoEst.has(b)) {
            const q = ultimoEst.get(b);
            if (nArtsEm[q] === nArts) for (let r = q; r < p; r++) if (resultado[r].k === 'est') sai.add(r);
        }
        ultimoEst.set(b, p);
    });
    const finais = resultado.filter((_, p) => !sai.has(p));
    // Sem as redações repetidas, os ids não precisam mais do sufixo ~N (ficam estáveis entre atualizações).
    const usados = new Set();
    for (const it of finais) {
        const limpo = base(it.id);
        if (limpo !== it.id && !usados.has(limpo)) { it.id = limpo; if (it.k === 'art') it.art = limpo; }
        usados.add(it.id);
    }
    // Filhos apontam para o artigo pelo campo art: reaponta para o id (possivelmente limpo) do artigo.
    let artId = null;
    for (const it of finais) { if (it.k === 'art') artId = it.id; else if (it.art && artId) it.art = artId; }
    return finais;
}

export function parseLeiHtml(html, cfg) {
    const gerarId = criarGeradorIds();
    const itens = [];
    let secao = '';            // '' = texto principal, 'adct-' = ADCT
    let terminou = false;
    let iniciou = !cfg.inicio; // leis com preâmbulo/decreto só começam depois da linha cfg.inicio
    let fimPendente = false;   // passou do último artigo: só aceita seus filhos (§, incisos...)

    let artAtual = null;       // id do artigo corrente
    let parAtual = null;       // id do § corrente
    let incAtual = null;       // id do inciso corrente
    let aliAtual = null;
    let ultimaEstrutura = null;
    let rubricaPendente = '';  // título do artigo (Código Penal) lido antes do "Art."
    let viuArtigo = false;
    const prefixos = [];       // ids de Parte>Livro>Título>Capítulo>Seção atuais: cada nível recomeça em I sob o de cima

    // Cria um item de estrutura a partir de "TÍTULO I DOS CRIMES..." (rótulo + nome na mesma linha).
    // Se o resto da linha for OUTRA estrutura ("PARTE GERAL TÍTULO I DA APLICAÇÃO..."), cria as duas.
    const abrirEstrutura = (linha) => {
        const m = linha.match(RE_ESTRUTURA);
        const tipo = NOMES_ESTRUTURA[m[1].toUpperCase()];
        const num = m[2].toUpperCase();
        const nivelEst = NIVEL_ESTRUTURA[tipo];
        const base = prefixos.slice(0, nivelEst).filter(Boolean).join('');
        const item = { id: gerarId(`${secao}${base}est-${tipo}-${num}`), k: 'est', tipo, rot: limpar(m[0]).toUpperCase().replace(/^TITULO/, 'TÍTULO').replace(/^SUBTITULO/, 'SUBTÍTULO'), nome: '', texto: '', secao: secao ? 'adct' : 'cf' };
        const resto = limpar(linha.slice(m[0].length).replace(/^[\s\-–—.:]+/, ''));
        prefixos.length = nivelEst;
        prefixos[nivelEst] = `${tipo}-${num}.`;
        itens.push(item);
        artAtual = parAtual = incAtual = aliAtual = null;
        rubricaPendente = '';
        if (resto && RE_ESTRUTURA.test(resto)) { ultimaEstrutura = null; abrirEstrutura(resto); return; }
        if (resto) item.nome = resto;
        ultimaEstrutura = item.nome ? null : item;
    };

    const processar = (frag) => {
        if (terminou) return;
        const { total: bruto, vigente: vigenteFrag } = lerFragmento(frag);
        if (!bruto) return;

        if (!iniciou) { if (cfg.inicio.test(bruto)) iniciou = true; return; }

        if (cfg.temAdct) {
            // Data de promulgação: no fim do texto principal (e de novo no fim do ADCT).
            if (/^Bras[ií]lia,.*1988\.?$/i.test(bruto)) {
                if (secao === 'adct-') { terminou = true; return; }
                artAtual = parAtual = incAtual = aliAtual = null;   // o que vem depois (assinaturas) não é dispositivo
                return;
            }
            // Título do ADCT em MAIÚSCULAS (sensível a caixa de propósito: o índice no topo da
            // página traz o mesmo nome em minúsculas e não pode ser confundido com ele).
            if (/^ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS$/.test(bruto)) {
                secao = 'adct-';
                artAtual = parAtual = incAtual = aliAtual = null;
                prefixos.length = 0; prefixos[0] = 'adct.';
                itens.push({ id: gerarId('est-adct'), k: 'est', tipo: 'adct', rot: 'ADCT', nome: 'Ato das Disposições Constitucionais Transitórias', texto: '', secao: 'adct' });
                ultimaEstrutura = null;
                return;
            }
        }
        // Linha de data/assinatura que encerra a lei (só vale depois do 1º artigo).
        if (cfg.terminador && viuArtigo && cfg.terminador.test(bruto)) { terminou = true; return; }

        const { texto: lido, revogado, superado } = lerParagrafo(bruto, vigenteFrag);
        // Redação antiga riscada (inclusive títulos/capítulos antigos): descartada, a nova vem em seguida.
        if (superado && cfg.descartarSuperados) return;
        let { texto, notas } = extrairNotas(lido);
        if (!texto && !notas.length) return;

        // Ordinal vem como <sup>o</sup> ("Art. 1o", "§ 2o"): vira "º" como nas demais leis.
        if (cfg.cabecalhosH) texto = texto.replace(/\b(arts?\.\s*\d+(?:\.\d{3})*(?:-[A-Z]{1,2})?)\s?o(?![a-zà-ú])/gi, '$1º').replace(/(§§?\s*\d+(?:-[A-Z]{1,2})?)\s?o(?![a-zà-ú])/g, '$1º');

        // Código Civil: "P A R T E  G E R A L" vem com as letras espaçadas.
        if (/^P ?A ?R ?T ?E\b/.test(texto) && /^(?:\p{Lu} ){4,}/u.test(texto)) {
            const junto = texto.replace(/ /g, '');
            texto = /ESPECIAL/.test(junto) ? 'PARTE ESPECIAL' : 'PARTE GERAL';
        }

        // --- Estrutura (Parte, Livro, Título, Capítulo, Seção...) ---
        if (RE_ESTRUTURA.test(texto) && !RE_ARTIGO.test(texto)) {
            if (fimPendente) { terminou = true; return; }
            abrirEstrutura(texto);
            return;
        }

        // --- Artigo ---
        const mArt = texto.match(RE_ARTIGO);
        // Nome da estrutura que veio na linha seguinte ao rótulo ("TÍTULO II" / "DOS DIREITOS...").
        if (ultimaEstrutura && !mArt) { ultimaEstrutura.nome = texto; ultimaEstrutura = null; return; }
        if (mArt) {
            if (fimPendente) { terminou = true; return; }
            const n = mArt[1].replace(/\./g, '');
            const suf = mArt[2] || '';
            const id = gerarId(`${secao}art-${n}${suf ? '-' + suf : ''}`);
            const item = { id, k: 'art', n, suf, art: id, texto, notas, revogado, nivel: 0 };
            if (cfg.rubricas && rubricaPendente) item.rubrica = rubricaPendente;
            itens.push(item);
            artAtual = id; parAtual = incAtual = aliAtual = null; ultimaEstrutura = null;
            rubricaPendente = ''; viuArtigo = true;
            if (cfg.fimAposArtigo && id === cfg.fimAposArtigo) fimPendente = true;
            return;
        }

        if (!artAtual && !viuArtigo) {
            // Texto antes do 1º artigo (preâmbulo) não entra; só a rubrica do artigo 1º é guardada (Código Penal).
            if (cfg.rubricas && texto.length <= 140 && !RE_PARAGRAFO.test(texto)) rubricaPendente = texto;
            return;
        }

        // --- Parágrafo ---
        const mPar = texto.match(RE_PARAGRAFO);
        if (mPar) {
            const num = mPar[1] ? `${mPar[1]}${mPar[2] ? '-' + mPar[2] : ''}` : 'u';
            const id = gerarId(`${artAtual}.par-${num}`);
            itens.push({ id, k: 'par', art: artAtual, texto, notas, revogado, nivel: 1 });
            parAtual = id; incAtual = aliAtual = null;
            return;
        }

        // --- Pena (Código Penal: "Pena - reclusão, de um a quatro anos.") ---
        if (artAtual && RE_PENA.test(texto)) {
            const base = parAtual || artAtual;
            const id = gerarId(`${base}.pena`);
            itens.push({ id, k: 'pena', art: artAtual, texto, notas, revogado, nivel: parAtual ? 2 : 1 });
            return;
        }

        if (!artAtual) {
            // Entre uma estrutura e o 1º artigo dela: título (rubrica) do próximo artigo.
            if (cfg.rubricas && texto.length <= 140) rubricaPendente = texto;
            return;
        }

        // --- Inciso (pertence ao § corrente, se houver; senão ao caput) ---
        const mInc = texto.match(RE_INCISO_SUFIXO) || texto.match(RE_INCISO);
        if (mInc) {
            const base = parAtual || artAtual;
            const id = gerarId(`${base}.inc-${mInc[1]}${mInc[2] ? '-' + mInc[2] : ''}`);
            itens.push({ id, k: 'inc', art: artAtual, texto, notas, revogado, nivel: parAtual ? 2 : 1 });
            incAtual = id; aliAtual = null;
            return;
        }

        // --- Alínea ---
        const mAli = texto.match(RE_ALINEA);
        if (mAli) {
            const base = incAtual || parAtual || artAtual;
            const id = gerarId(`${base}.ali-${mAli[1]}`);
            itens.push({ id, k: 'ali', art: artAtual, texto, notas, revogado, nivel: (incAtual ? (parAtual ? 3 : 2) : 2) });
            aliAtual = id;
            return;
        }

        // --- Item numerado (sob alínea/inciso) ---
        const mIte = texto.match(RE_ITEM);
        if (mIte && (aliAtual || incAtual)) {
            const base = aliAtual || incAtual;
            const id = gerarId(`${base}.ite-${mIte[1]}`);
            itens.push({ id, k: 'ite', art: artAtual, texto, notas, revogado, nivel: (aliAtual ? 4 : 3) });
            return;
        }

        // Linha solta depois de um artigo. No Código Penal ela é o título (rubrica) do PRÓXIMO
        // artigo; nas demais leis é ignorada de propósito: preferimos perder um texto estranho
        // (ex.: nota de rodapé, tabela de anexo) a poluir a lei com lixo.
        if (fimPendente) { terminou = true; return; }
        if (cfg.rubricas && texto.length <= 140) rubricaPendente = texto;
    };

    // CLT: o nome de capítulos/seções vem em <h5>, em linha própria; na CF só valem os <p> (não mexer:
    // mudar o corte da CF alteraria a lei já publicada). Para h1-h6 o 'p' do início é trocado depois.
    const corte = cfg.cabecalhosH ? /<(?:p|h[1-6])\b/i : /<p\b/i;
    for (const frag of html.split(corte).slice(1)) processar(cfg.cabecalhosH ? frag.replace(/^[1-6]\b/, '') : frag);

    const finais = cfg.versoes ? podarVersoes(itens) : itens;
    for (const it of finais) it.hash = hashItem(it);
    return finais;
}

// Trava de segurança. `anterior` é a versão boa já gravada (ou null).
export function validarLei(itens, cfg, anterior) {
    const motivos = [];
    const artigos = itens.filter(i => i.k === 'art');
    if (artigos.length < cfg.minArtigos) motivos.push(`só ${artigos.length} artigos (mínimo ${cfg.minArtigos})`);
    if (cfg.temAdct && !artigos.some(a => a.id.startsWith('adct-'))) motivos.push('ADCT não encontrado');
    for (const id of (cfg.sentinelas || [])) {
        if (!artigos.some(a => a.id === id)) motivos.push(`${id} não encontrado`);
    }
    if (anterior) {
        const antArt = anterior.filter(i => i.k === 'art').length;
        if (antArt && artigos.length < antArt * 0.9) motivos.push(`artigos caíram de ${antArt} para ${artigos.length}`);
        const dif = compararLeis(anterior, itens);
        if (anterior.length && dif.itensAfetados / anterior.length > 0.3) motivos.push(`${Math.round(100 * dif.itensAfetados / anterior.length)}% dos dispositivos mudaram de uma vez`);
    }
    return { ok: motivos.length === 0, motivos };
}

// Diferença entre duas versões, agrupada por artigo.
export function compararLeis(antigo, novo) {
    const mapa = itens => new Map(itens.filter(i => i.k !== 'est').map(i => [i.id, i]));
    const a = mapa(antigo), b = mapa(novo);
    const porArtigo = new Map();
    let itensAfetados = 0;
    const marcar = (item, tipoItem, id) => {
        const art = item.art || item.id;
        const g = porArtigo.get(art) || { art, ids: [], tipos: new Set() };
        g.ids.push(id);
        g.tipos.add(tipoItem);
        porArtigo.set(art, g);
        itensAfetados++;
    };
    for (const [id, item] of b) {
        const velho = a.get(id);
        if (!velho) marcar(item, 'incluido', id);
        else if (velho.hash !== item.hash) marcar(item, (item.revogado && !velho.revogado) ? 'revogado' : 'alterado', id);
    }
    for (const [id, item] of a) if (!b.has(id)) marcar(item, 'removido', id);

    const mudancas = [...porArtigo.values()].map(g => {
        const artNovo = b.get(g.art), artVelho = a.get(g.art);
        let tipo;
        if (g.ids.includes(g.art) && g.tipos.has('incluido')) tipo = 'incluido';
        else if (artNovo && artNovo.revogado && artVelho && !artVelho.revogado) tipo = 'revogado';
        else if (!artNovo && artVelho) tipo = 'removido';
        else tipo = 'alterado';
        const ref = artNovo || artVelho;
        return { art: g.art, rotulo: rotuloArtigo(ref), tipo, ids: g.ids };
    });
    return { mudancas, itensAfetados };
}

export function rotuloArtigo(item) {
    if (!item || item.k !== 'art') return item ? item.id : '';
    const adct = item.id.startsWith('adct-') ? ' do ADCT' : '';
    const num = Number(item.n);
    const ord = num <= 9 ? `${item.n}º` : String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `Art. ${ord}${item.suf ? '-' + item.suf : ''}${adct}`;
}
