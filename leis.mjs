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

// Catálogo das leis. Por ora só a CF; as outras entram aqui com o mesmo molde.
export const LEIS = {
    cf: {
        id: 'cf',
        nome: 'Constituição Federal',
        sigla: 'CF/88',
        url: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
        // Piso de artigos (CF + ADCT) abaixo do qual o parse é considerado quebrado.
        minArtigos: 300,
        // A CF tem o ADCT na mesma página; seus artigos recomeçam do 1º.
        temAdct: true
    }
};

const RE_NOTA = /\((?:Redação dada|Redação anterior|Incluíd[oa]|Revogad[oa]|Vide|Regulament|Vigência|Produção de efeito|Promulgaç|Declarad|Suspens|Expressão|Execução|Texto|Renumerad|Acrescid|Alterad|Veto|Vetad|Prazo|Eficácia)[^()]*(?:\([^()]*\)[^()]*)*\)/gi;

const RE_ESTRUTURA = /^(PARTE|LIVRO|TÍTULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO)\s+([IVXLCDM]+(?:-[A-Z])?|ÚNIC[OA]|GERAL|ESPECIAL)\b/i;
const RE_ARTIGO = /^Art\.?\s*(\d+)\s*(?:[º°o]|\.)?\s*(?:-\s*([A-Z]{1,2})\b)?/;
const RE_PARAGRAFO = /^(?:§\s*(\d+)\s*[º°o]?\s*(?:-\s*([A-Z]))?|Parágrafo\s+único)/i;
const RE_INCISO = /^([IVXLCDM]+)(?:\s*-\s*([A-Z]))?\s*[-–—]\s*/;
const RE_ALINEA = /^([a-z])\)\s*/;
const RE_ITEM = /^(\d{1,2})\s*[.)-]\s+/;

const NOMES_ESTRUTURA = { PARTE: 'parte', LIVRO: 'livro', 'TÍTULO': 'titulo', 'CAPÍTULO': 'capitulo', 'SEÇÃO': 'secao', 'SUBSEÇÃO': 'subsecao' };

function limpar(str) {
    return String(str || '').replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function hashItem(item) {
    return createHash('sha1')
        .update(`${item.texto || ''}|${(item.notas || []).join(';')}|${item.revogado ? 1 : 0}|${item.rot || ''}|${item.nome || ''}`)
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
function lerParagrafo($, el) {
    const total = limpar($(el).text());
    const clone = $(el).clone();
    clone.find('strike, s, del').remove();
    const vigente = limpar(clone.text());
    if (!total) return { texto: '', revogado: false };
    const riscado = total.length - vigente.length;
    const revogadoPorRisco = riscado > 0 && riscado >= total.length * 0.5;
    if (revogadoPorRisco) return { texto: total, revogado: true };
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

export function parseLeiHtml(html, cfg) {
    const $ = cheerio.load(html);
    const gerarId = criarGeradorIds();
    const itens = [];
    let secao = '';            // '' = texto principal, 'adct-' = ADCT
    let marcosFim = 0;         // quantas vezes já vimos "Brasília, ... de 1988."
    let ignorando = false;     // entre o fim do texto principal e o início do ADCT
    let terminou = false;

    let artAtual = null;       // id do artigo corrente
    let parAtual = null;       // id do § corrente
    let incAtual = null;       // id do inciso corrente
    let aliAtual = null;
    let ultimaEstrutura = null;

    $('p').each((_, el) => {
        if (terminou) return;
        const bruto = limpar($(el).text());
        if (!bruto) return;

        if (cfg.temAdct) {
            if (/^Bras[ií]lia,.*1988\.?$/i.test(bruto)) {
                marcosFim++;
                if (marcosFim === 1) { ignorando = true; return; }
                terminou = true; return;
            }
            if (/^ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS$/i.test(bruto)) {
                secao = 'adct-';
                ignorando = false;
                artAtual = parAtual = incAtual = aliAtual = null;
                itens.push({ id: gerarId('est-adct'), k: 'est', tipo: 'adct', rot: 'ADCT', nome: 'Ato das Disposições Constitucionais Transitórias', texto: '', secao: 'adct' });
                ultimaEstrutura = null;
                return;
            }
        }
        if (ignorando) return;

        const { texto: lido, revogado } = lerParagrafo($, el);
        const { texto, notas } = extrairNotas(lido);
        if (!texto && !notas.length) return;

        // --- Estrutura (Título, Capítulo, Seção...) ---
        const mEst = texto.match(RE_ESTRUTURA);
        if (mEst && !RE_ARTIGO.test(texto)) {
            const tipo = NOMES_ESTRUTURA[mEst[1].toUpperCase()];
            const rot = limpar(texto).toUpperCase();
            const item = { id: gerarId(`${secao}est-${tipo}-${mEst[2].toUpperCase()}`), k: 'est', tipo, rot: limpar(texto.match(RE_ESTRUTURA)[0]).toUpperCase(), nome: '', texto: '', secao: secao ? 'adct' : 'cf' };
            // O nome ("DOS PRINCÍPIOS FUNDAMENTAIS") vem no mesmo <p> depois do rótulo, ou no próximo.
            const resto = limpar(texto.slice(mEst[0].length).replace(/^[\s\-–—.:]+/, ''));
            if (resto) item.nome = resto;
            itens.push(item);
            ultimaEstrutura = item.nome ? null : item;
            return;
        }

        // --- Artigo ---
        const mArt = texto.match(RE_ARTIGO);
        // Nome da estrutura que veio na linha seguinte ao rótulo ("TÍTULO II" / "DOS DIREITOS...").
        if (ultimaEstrutura && !mArt) { ultimaEstrutura.nome = texto; ultimaEstrutura = null; return; }
        if (mArt) {
            const n = mArt[1];
            const suf = mArt[2] || '';
            const id = gerarId(`${secao}art-${n}${suf ? '-' + suf : ''}`);
            itens.push({ id, k: 'art', n, suf, art: id, texto, notas, revogado, nivel: 0 });
            artAtual = id; parAtual = incAtual = aliAtual = null; ultimaEstrutura = null;
            return;
        }

        if (!artAtual) return;  // texto antes do 1º artigo (ex.: preâmbulo) não entra

        // --- Parágrafo ---
        const mPar = texto.match(RE_PARAGRAFO);
        if (mPar) {
            const num = mPar[1] ? `${mPar[1]}${mPar[2] ? '-' + mPar[2] : ''}` : 'u';
            const id = gerarId(`${artAtual}.par-${num}`);
            itens.push({ id, k: 'par', art: artAtual, texto, notas, revogado, nivel: 1 });
            parAtual = id; incAtual = aliAtual = null;
            return;
        }

        // --- Inciso (pertence ao § corrente, se houver; senão ao caput) ---
        const mInc = texto.match(RE_INCISO);
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
        // Qualquer outra linha solta é ignorada de propósito: preferimos perder um
        // texto estranho (ex.: nota de rodapé) a poluir a lei com lixo.
    });

    for (const it of itens) it.hash = hashItem(it);
    return itens;
}

// Trava de segurança. `anterior` é a versão boa já gravada (ou null).
export function validarLei(itens, cfg, anterior) {
    const motivos = [];
    const artigos = itens.filter(i => i.k === 'art');
    if (artigos.length < cfg.minArtigos) motivos.push(`só ${artigos.length} artigos (mínimo ${cfg.minArtigos})`);
    if (cfg.temAdct && !artigos.some(a => a.id.startsWith('adct-'))) motivos.push('ADCT não encontrado');
    if (!artigos.some(a => a.id === 'art-5')) motivos.push('art. 5º não encontrado');
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
    const ord = num <= 9 ? `${item.n}º` : item.n;
    return `Art. ${ord}${item.suf ? '-' + item.suf : ''}${adct}`;
}
