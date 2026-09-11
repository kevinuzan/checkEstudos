import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import webpush from 'web-push';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import fs from 'fs';
import { promisify } from 'util';

// --- CONFIGURAÇÕES BÁSICAS ---
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    maxHttpBufferSize: 1e7 // 10MB para fotos
});

const PORT = process.env.PORT || 3000;
const DB_NAME = "edital"; // Você pode usar o mesmo DB e mudar a collection

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONGO_URI = process.env.MONGO_PUBLIC_URL || "SUA_URI_LOCAL_DE_TESTE";

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- JOGO "ESTUDA TRT" (mnemônicos, competências e lacunas da CF) ---
// Aplicativo separado, montado em /jogo dentro do mesmo servidor.
app.use('/jogo', express.static(path.join(__dirname, 'public/jogo')));

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const statAsync = promisify(fs.stat);
const constituicaoJsonPath = path.join(__dirname, 'public/jogo/json/constituicao.json');

async function baixarConstituicao() {
    const url = 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm';
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    });
    if (!response.ok) throw new Error('Falha ao obter Constituição');

    const buffer = await response.arrayBuffer();
    const html = iconv.decode(Buffer.from(buffer), 'ISO-8859-1');
    const $ = cheerio.load(html);

    const artigos = [];
    let encontrouFinal = false;

    $('p').each((_, el) => {
        if (encontrouFinal) return;
        const text = $(el).text().trim();

        if (text.includes('Brasília, 5 de outubro de 1988.')) {
            encontrouFinal = true;
            return;
        }
        if ($(el).find('strike').length > 0) return;

        const artigoMatch = text.match(/^Art\. ?\d+/);
        if (artigoMatch) {
            const artigo = { titulo: text, paragrafos: [], incisos: [] };
            const siblings = [];
            let current = $(el).next();

            while (current.length && !/^Art\. ?\d+/.test(current.text().trim())) {
                const t = current.text().trim();
                if (t.includes('Brasília, 5 de outubro de 1988.')) {
                    encontrouFinal = true;
                    break;
                }
                siblings.push(current);
                current = current.next();
            }

            siblings.forEach(sib => {
                const ps = sib.is('p') && (sib.attr('style') || '').includes('text-indent: 38px')
                    ? [sib]
                    : sib.find('p[style*="text-indent: 38px"]').toArray().map(el => $(el));

                ps.forEach(pElem => {
                    if (pElem.find('strike').length > 0) return;
                    const t = pElem.text().trim();
                    if (/^§/.test(t)) artigo.paragrafos.push(t);
                    else if (/^[IVXLC]+[-—]\s/.test(t)) artigo.incisos.push(t);
                    else if (t) artigo.paragrafos.push(t);
                });
            });

            artigos.push(artigo);
        }
    });

    return artigos;
}

app.get('/jogo/constituicao', async (req, res) => {
    try {
        const exists = fs.existsSync(constituicaoJsonPath);
        let precisaAtualizar = true;

        if (exists) {
            const stats = await statAsync(constituicaoJsonPath);
            const agora = new Date();
            const modificadoHoje = new Date(stats.mtime).toDateString() === agora.toDateString();
            if (modificadoHoje) precisaAtualizar = false;
        }

        if (precisaAtualizar) {
            try {
                const artigos = await baixarConstituicao();
                await writeFile(constituicaoJsonPath, JSON.stringify({ artigos }, null, 2), 'utf8');
                return res.json({ artigos });
            } catch (erroDownload) {
                // Se a atualização falhar (ex: sem acesso à internet) e já existir
                // um arquivo em cache, serve o cache em vez de quebrar o jogo.
                if (!exists) throw erroDownload;
                console.error('Falha ao atualizar a Constituição, servindo cache existente:', erroDownload);
            }
        }

        const json = await readFile(constituicaoJsonPath, 'utf8');
        const dados = JSON.parse(json);
        return res.json(dados);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro interno ao carregar a Constituição' });
    }
});

// --- WEB PUSH CONFIG ---
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
if (publicVapidKey && privateVapidKey) {
    webpush.setVapidDetails('mailto:uzankevin93@gmail.com', publicVapidKey, privateVapidKey);
}
const EDITAL_COLLECTION = "edital_topicos";
const PLANOS_COLLECTION = "edital_planos";
const TIPOS_ESTUDO_COLLECTION = "tipos_estudo";
const SESSOES_COLLECTION = "sessoes_estudo";
const MATERIAS_COR_COLLECTION = "materias_cor";
const JOGO_PONTUACOES_COLLECTION = "jogo_pontuacoes";
const JOGO_RODADAS_COLLECTION = "jogo_rodadas";
const PLANO_PADRAO = "TRT";

// Tipos de estudo padrão, criados automaticamente na primeira execução.
// campoExtra define qual campo adicional aparece ao finalizar uma sessão:
// "questoes" (acertos/erros), "paginas" (páginas lidas) ou "nenhum".
const TIPOS_ESTUDO_PADRAO = [
    { nome: "Simulado", campoExtra: "questoes" },
    { nome: "Exercício", campoExtra: "questoes" },
    { nome: "Revisão", campoExtra: "questoes" },
    { nome: "Flash Cards", campoExtra: "questoes" },
    { nome: "Leitura", campoExtra: "paginas" },
    { nome: "Resumo", campoExtra: "nenhum" },
    { nome: "Mapa Mental", campoExtra: "nenhum" },
    { nome: "Lei Seca", campoExtra: "nenhum" },
    { nome: "Jurisprudência", campoExtra: "nenhum" },
    { nome: "Doutrina", campoExtra: "nenhum" },
    { nome: "Áudio", campoExtra: "nenhum" },
    { nome: "Jogo", campoExtra: "questoes" }
];

async function startServer() {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const editalColl = db.collection(EDITAL_COLLECTION);
        const planosColl = db.collection(PLANOS_COLLECTION);
        const tiposEstudoColl = db.collection(TIPOS_ESTUDO_COLLECTION);
        const sessoesColl = db.collection(SESSOES_COLLECTION);
        const materiasCorColl = db.collection(MATERIAS_COR_COLLECTION);
        const jogoPontuacoesColl = db.collection(JOGO_PONTUACOES_COLLECTION);
        const jogoRodadasColl = db.collection(JOGO_RODADAS_COLLECTION);

        // --- MIGRAÇÃO: garante que todo item tenha um array "planos" ---
        // Itens antigos (de antes de existir o conceito de "plano") são
        // atribuídos ao plano padrão, para não perder nada que já existia.
        const semPlano = await editalColl.countDocuments({
            $or: [{ planos: { $exists: false } }, { planos: { $size: 0 } }]
        });
        if (semPlano > 0) {
            await editalColl.updateMany(
                { $or: [{ planos: { $exists: false } }, { planos: { $size: 0 } }] },
                { $set: { planos: [PLANO_PADRAO] } }
            );
        }
        const totalPlanos = await planosColl.countDocuments({});
        if (totalPlanos === 0) {
            await planosColl.insertOne({ nome: PLANO_PADRAO, ordem: 0 });
        }
        const totalTiposEstudo = await tiposEstudoColl.countDocuments({});
        if (totalTiposEstudo === 0) {
            await tiposEstudoColl.insertMany(
                TIPOS_ESTUDO_PADRAO.map((tipo, i) => ({ ...tipo, ordem: i }))
            );
        } else {
            // Garante que o tipo "Jogo" exista mesmo em bancos que já tinham
            // tipos de estudo cadastrados antes dele ser adicionado.
            const jogoExiste = await tiposEstudoColl.findOne({ nome: "Jogo" });
            if (!jogoExiste) {
                const ultimoTipo = await tiposEstudoColl.find({}).sort({ ordem: -1 }).limit(1).toArray();
                const proximaOrdem = ultimoTipo.length ? (ultimoTipo[0].ordem || 0) + 1 : 0;
                await tiposEstudoColl.insertOne({ nome: "Jogo", campoExtra: "questoes", ordem: proximaOrdem });
            }
        }

        // --- PLANOS (metas de estudo, ex: TRT, ENAM) ---

        // Listar planos
        app.get('/api/planos', async (req, res) => {
            const planos = await planosColl.find({}).sort({ ordem: 1, nome: 1 }).toArray();
            res.json(planos);
        });

        // Criar um novo plano
        app.post('/api/planos', async (req, res) => {
            const nome = (req.body.nome || '').trim();
            if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });

            const existente = await planosColl.findOne({ nome });
            if (existente) return res.json({ success: true, plano: existente, jaExistia: true });

            const ultimaOrdem = await planosColl.countDocuments({});
            const plano = { nome, ordem: ultimaOrdem };
            await planosColl.insertOne(plano);
            res.json({ success: true, plano });
        });

        // Renomear um plano (atualiza também os itens que o referenciam)
        app.put('/api/planos/:nome', async (req, res) => {
            const nomeAtual = req.params.nome;
            const novoNome = (req.body.nome || '').trim();
            if (!novoNome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });

            await planosColl.updateOne({ nome: nomeAtual }, { $set: { nome: novoNome } });
            await editalColl.updateMany(
                { planos: nomeAtual },
                { $set: { "planos.$[elem]": novoNome } },
                { arrayFilters: [{ elem: nomeAtual }] }
            );
            res.json({ success: true });
        });

        // Remover um plano. Os tópicos que pertenciam SOMENTE a esse plano
        // são apagados; tópicos compartilhados com outros planos continuam
        // existindo normalmente nos demais.
        app.delete('/api/planos/:nome', async (req, res) => {
            const nome = req.params.nome;
            await editalColl.deleteMany({ planos: [nome] });
            await editalColl.updateMany(
                { planos: nome },
                { $pull: { planos: nome } }
            );
            await planosColl.deleteOne({ nome });
            res.json({ success: true });
        });

        // --- TÓPICOS DO EDITAL ---

        // Listar tópicos de um plano específico (ou todos, se nenhum for informado)
        app.get('/api/edital', async (req, res) => {
            const { plano } = req.query;
            const filtro = plano ? { planos: plano } : {};
            const itens = await editalColl.find(filtro).sort({ materia: 1 }).toArray();
            res.json(itens);
        });

        // Adicionar múltiplos tópicos (Bulk Insert) em um ou mais planos de uma vez.
        // Se o mesmo texto de matéria+tópico já existir, o item existente é
        // apenas vinculado ao(s) novo(s) plano(s) em vez de duplicado — assim
        // o "concluido" fica automaticamente compartilhado entre os planos.
        app.post('/api/edital/bulk', async (req, res) => {
            const { materia, textoBruto } = req.body;
            let { planos } = req.body;
            if (!planos || !Array.isArray(planos) || planos.length === 0) {
                planos = [PLANO_PADRAO];
            }
            const linhas = textoBruto.split('\n').map(l => l.trim()).filter(l => l !== "");

            let criados = 0;
            let vinculados = 0;
            for (const topico of linhas) {
                const existente = await editalColl.findOne({ materia, topico });
                if (existente) {
                    await editalColl.updateOne(
                        { _id: existente._id },
                        { $addToSet: { planos: { $each: planos } } }
                    );
                    vinculados++;
                } else {
                    await editalColl.insertOne({
                        materia,
                        topico,
                        concluido: false,
                        planos,
                        dataCriacao: new Date()
                    });
                    criados++;
                }
            }
            res.json({ success: true, criados, vinculados });
        });

        // Editar o texto de um tópico, a matéria e/ou os planos aos quais pertence
        app.put('/api/edital/item/:id', async (req, res) => {
            const { id } = req.params;
            const { topico, materia, planos } = req.body;
            const set = {};
            if (topico !== undefined) set.topico = topico;
            if (materia !== undefined) set.materia = materia;
            if (planos !== undefined) set.planos = planos;
            await editalColl.updateOne(
                { _id: new ObjectId(id) },
                { $set: set }
            );
            res.json({ success: true });
        });

        // Vincula vários tópicos de uma vez a um plano adicional (migração em
        // massa, ex: "selecionei 20 tópicos do TRT e quero que valham pro ENAM
        // também"). Não remove o(s) plano(s) que o tópico já tinha.
        app.put('/api/edital/bulk-plano', async (req, res) => {
            const { ids, plano } = req.body;
            if (!Array.isArray(ids) || ids.length === 0 || !plano) {
                return res.status(400).json({ success: false, error: 'ids e plano são obrigatórios' });
            }
            const objectIds = ids.map(id => new ObjectId(id));
            await editalColl.updateMany(
                { _id: { $in: objectIds } },
                { $addToSet: { planos: plano } }
            );
            res.json({ success: true, atualizados: objectIds.length });
        });

        // Deletar um tópico específico
        app.delete('/api/edital/item/:id', async (req, res) => {
            const { id } = req.params;
            await editalColl.deleteOne({ _id: new ObjectId(id) });
            res.json({ success: true });
        });

        // Alternar Checkbox — como o tópico é um único documento referenciado
        // por todos os planos aos quais pertence, marcar "concluído" aqui
        // reflete automaticamente em todos os planos que compartilham o tópico.
        app.put('/api/edital/:id', async (req, res) => {
            const { id } = req.params;
            const { concluido } = req.body;
            await editalColl.updateOne(
                { _id: new ObjectId(id) },
                { $set: { concluido } }
            );
            res.json({ success: true });
        });

        // Limpar tudo (Reset) — opcionalmente restrito a um plano específico
        app.delete('/api/edital', async (req, res) => {
            const { plano } = req.query;
            if (plano) {
                await editalColl.deleteMany({ planos: [plano] });
                await editalColl.updateMany({ planos: plano }, { $pull: { planos: plano } });
            } else {
                await editalColl.deleteMany({});
            }
            res.json({ success: true });
        });

        // --- TIPOS DE ESTUDO (simulado, resumo, leitura, etc. — editáveis) ---

        // Listar tipos de estudo
        app.get('/api/tipos-estudo', async (req, res) => {
            const tipos = await tiposEstudoColl.find({}).sort({ ordem: 1, nome: 1 }).toArray();
            res.json(tipos);
        });

        // Criar um novo tipo de estudo
        app.post('/api/tipos-estudo', async (req, res) => {
            const nome = (req.body.nome || '').trim();
            const campoExtra = ['questoes', 'paginas', 'nenhum'].includes(req.body.campoExtra) ? req.body.campoExtra : 'nenhum';
            if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });

            const ultimaOrdem = await tiposEstudoColl.countDocuments({});
            const tipo = { nome, campoExtra, ordem: ultimaOrdem };
            const resultado = await tiposEstudoColl.insertOne(tipo);
            res.json({ success: true, tipo: { ...tipo, _id: resultado.insertedId } });
        });

        // Editar nome e/ou campo extra de um tipo de estudo
        app.put('/api/tipos-estudo/:id', async (req, res) => {
            const { id } = req.params;
            const set = {};
            if (req.body.nome !== undefined) set.nome = req.body.nome.trim();
            if (req.body.campoExtra !== undefined && ['questoes', 'paginas', 'nenhum'].includes(req.body.campoExtra)) {
                set.campoExtra = req.body.campoExtra;
            }
            await tiposEstudoColl.updateOne({ _id: new ObjectId(id) }, { $set: set });
            res.json({ success: true });
        });

        // Remover um tipo de estudo (sessões já registradas com ele são mantidas)
        app.delete('/api/tipos-estudo/:id', async (req, res) => {
            const { id } = req.params;
            await tiposEstudoColl.deleteOne({ _id: new ObjectId(id) });
            res.json({ success: true });
        });

        // --- SESSÕES DE ESTUDO (cronômetro) ---

        // Monta o filtro de "pertence a este plano" para sessões: uma sessão conta
        // para um plano se QUALQUER tópico que ela estudou pertence hoje a esse
        // plano — inclusive tópicos marcados como compartilhados DEPOIS da sessão
        // ter sido registrada — ou, quando a sessão não tem tópicos vinculados,
        // se foi registrada com aquele plano ativo (fallback).
        async function filtroSessoesPorPlano(plano) {
            if (!plano) return {};
            const topicosDoPlano = await editalColl.find({ planos: plano }, { projection: { _id: 1 } }).toArray();
            const idsDoPlano = topicosDoPlano.map(t => t._id.toString());
            return {
                $or: [
                    { "topicos.topicoId": { $in: idsDoPlano } },
                    { $or: [{ topicos: { $exists: false } }, { topicos: { $size: 0 } }], plano }
                ]
            };
        }

        // Listar sessões (mais recentes primeiro), opcionalmente filtradas por plano.
        // Uma sessão que estudou uma matéria/tópico compartilhado entre planos
        // aparece no resumo de TODOS os planos aos quais o tópico pertence.
        app.get('/api/sessoes', async (req, res) => {
            const { plano, limite } = req.query;
            const filtro = await filtroSessoesPorPlano(plano);
            const sessoes = await sessoesColl.find(filtro)
                .sort({ fim: -1 })
                .limit(parseInt(limite) || 200)
                .toArray();
            res.json(sessoes);
        });

        // Registrar uma sessão de estudo finalizada
        app.post('/api/sessoes', async (req, res) => {
            const {
                inicio, fim, duracaoSegundos, plano, tipoEstudoId, tipoEstudoNome,
                topicos, acertos, erros, paginasLidas, observacoes, revisao
            } = req.body;

            const doc = {
                inicio: inicio ? new Date(inicio) : new Date(),
                fim: fim ? new Date(fim) : new Date(),
                duracaoSegundos: Number(duracaoSegundos) || 0,
                plano: plano || null,
                tipoEstudoId: tipoEstudoId || null,
                tipoEstudoNome: tipoEstudoNome || null,
                topicos: Array.isArray(topicos) ? topicos : [],
                acertos: acertos !== undefined && acertos !== null && acertos !== '' ? Number(acertos) : null,
                erros: erros !== undefined && erros !== null && erros !== '' ? Number(erros) : null,
                paginasLidas: paginasLidas !== undefined && paginasLidas !== null && paginasLidas !== '' ? Number(paginasLidas) : null,
                observacoes: observacoes || '',
                revisao: { agendada: false, dias: null, dataRevisao: null, concluida: false, concluidaEm: null },
                criadoEm: new Date()
            };

            if (revisao && revisao.agendada) {
                const dias = Number(revisao.dias) || 7;
                const dataRevisao = new Date(doc.fim.getTime() + dias * 24 * 60 * 60 * 1000);
                doc.revisao = { agendada: true, dias, dataRevisao, concluida: false, concluidaEm: null };
            }

            const resultado = await sessoesColl.insertOne(doc);
            res.json({ success: true, sessao: { ...doc, _id: resultado.insertedId } });
        });

        // Editar uma sessão de estudo já registrada (tipo, tópicos, duração, desempenho, revisão...)
        app.put('/api/sessoes/:id', async (req, res) => {
            const { id } = req.params;
            const {
                inicio, fim, duracaoSegundos, tipoEstudoId, tipoEstudoNome,
                topicos, acertos, erros, paginasLidas, observacoes, revisao
            } = req.body;

            const set = {
                fim: fim ? new Date(fim) : new Date(),
                duracaoSegundos: Number(duracaoSegundos) || 0,
                tipoEstudoId: tipoEstudoId || null,
                tipoEstudoNome: tipoEstudoNome || null,
                topicos: Array.isArray(topicos) ? topicos : [],
                acertos: acertos !== undefined && acertos !== null && acertos !== '' ? Number(acertos) : null,
                erros: erros !== undefined && erros !== null && erros !== '' ? Number(erros) : null,
                paginasLidas: paginasLidas !== undefined && paginasLidas !== null && paginasLidas !== '' ? Number(paginasLidas) : null,
                observacoes: observacoes || ''
            };
            set.inicio = inicio ? new Date(inicio) : new Date(set.fim.getTime() - set.duracaoSegundos * 1000);

            if (revisao && revisao.agendada) {
                const dias = Number(revisao.dias) || 7;
                const dataRevisao = new Date(set.fim.getTime() + dias * 24 * 60 * 60 * 1000);
                set.revisao = { agendada: true, dias, dataRevisao, concluida: false, concluidaEm: null };
            } else {
                set.revisao = { agendada: false, dias: null, dataRevisao: null, concluida: false, concluidaEm: null };
            }

            await sessoesColl.updateOne({ _id: new ObjectId(id) }, { $set: set });
            res.json({ success: true });
        });

        // Excluir uma sessão registrada
        app.delete('/api/sessoes/:id', async (req, res) => {
            const { id } = req.params;
            await sessoesColl.deleteOne({ _id: new ObjectId(id) });
            res.json({ success: true });
        });

        // Listar revisões agendadas (pendentes por padrão), opcionalmente por plano
        // (mesma regra de compartilhamento usada em /api/sessoes)
        app.get('/api/revisoes', async (req, res) => {
            const { plano, status } = req.query;
            const filtroPlano = await filtroSessoesPorPlano(plano);
            const filtro = { ...filtroPlano, "revisao.agendada": true };
            if (status !== 'todas') filtro["revisao.concluida"] = false;

            const revisoes = await sessoesColl.find(filtro).sort({ "revisao.dataRevisao": 1 }).toArray();
            res.json(revisoes);
        });

        // Marcar uma revisão agendada como concluída
        app.put('/api/revisoes/:id/concluir', async (req, res) => {
            const { id } = req.params;
            await sessoesColl.updateOne(
                { _id: new ObjectId(id) },
                { $set: { "revisao.concluida": true, "revisao.concluidaEm": new Date() } }
            );
            res.json({ success: true });
        });

        // --- CORES DAS MATÉRIAS (usadas nos indicadores do Resumo) ---

        // Listar as cores já configuradas
        app.get('/api/materias-cor', async (req, res) => {
            const cores = await materiasCorColl.find({}).toArray();
            res.json(cores);
        });

        // Definir/atualizar a cor de uma matéria
        app.put('/api/materias-cor', async (req, res) => {
            const materia = (req.body.materia || '').trim();
            const cor = (req.body.cor || '').trim();
            if (!materia || !cor) return res.status(400).json({ success: false, error: 'Matéria e cor são obrigatórias' });

            await materiasCorColl.updateOne(
                { materia },
                { $set: { materia, cor } },
                { upsert: true }
            );
            res.json({ success: true });
        });

        // --- PONTUAÇÃO DO JOGO (mnemônicos, competências, lacunas) ---
        // Cada sub-jogo tem sua própria pontuação, nunca somada com as demais.
        // Guardamos o total acumulado (para nunca perder o histórico — não existe
        // "zerar") e também um log por rodada com a data, para saber como foi o
        // desempenho dia a dia.
        const TIPOS_JOGO_VALIDOS = ["mnemonicos", "competencias", "lacunas"];

        function dataDeHojeISO() {
            const hoje = new Date();
            return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
        }

        // Retorna, para cada sub-jogo, o total acumulado e o desempenho de hoje
        app.get('/jogo/api/pontuacao', async (req, res) => {
            const totais = await jogoPontuacoesColl.find({}).toArray();
            const hojeISO = dataDeHojeISO();
            const rodadasHoje = await jogoRodadasColl.find({ diaISO: hojeISO }).toArray();

            const resultado = {};
            for (const tipo of TIPOS_JOGO_VALIDOS) {
                const totalDoc = totais.find(d => d.tipo === tipo);
                const rodadasDoTipoHoje = rodadasHoje.filter(r => r.tipo === tipo);
                resultado[tipo] = {
                    total: { acertos: totalDoc?.acertos || 0, erros: totalDoc?.erros || 0 },
                    hoje: {
                        acertos: rodadasDoTipoHoje.reduce((s, r) => s + (r.acertos || 0), 0),
                        erros: rodadasDoTipoHoje.reduce((s, r) => s + (r.erros || 0), 0)
                    }
                };
            }
            res.json(resultado);
        });

        // Retorna o desempenho dia a dia de um sub-jogo (ou de todos), últimos N dias
        app.get('/jogo/api/pontuacao/historico', async (req, res) => {
            const dias = Math.min(parseInt(req.query.dias) || 30, 90);
            const desde = new Date();
            desde.setDate(desde.getDate() - dias);

            const filtro = { data: { $gte: desde } };
            if (req.query.tipo && TIPOS_JOGO_VALIDOS.includes(req.query.tipo)) filtro.tipo = req.query.tipo;

            const rodadas = await jogoRodadasColl.find(filtro).sort({ data: 1 }).toArray();
            const porDia = {};
            for (const r of rodadas) {
                if (!porDia[r.diaISO]) porDia[r.diaISO] = { acertos: 0, erros: 0 };
                porDia[r.diaISO].acertos += r.acertos || 0;
                porDia[r.diaISO].erros += r.erros || 0;
            }
            res.json(porDia);
        });

        // Registra o resultado de uma rodada de um sub-jogo (acumula no total e
        // fica salvo no log diário — a pontuação nunca é zerada).
        app.post('/jogo/api/pontuacao', async (req, res) => {
            const { tipo, acertos, erros } = req.body;
            if (!TIPOS_JOGO_VALIDOS.includes(tipo)) {
                return res.status(400).json({ success: false, error: 'Tipo de jogo inválido' });
            }
            const incAcertos = Number.isFinite(acertos) ? acertos : 0;
            const incErros = Number.isFinite(erros) ? erros : 0;

            await jogoPontuacoesColl.updateOne(
                { tipo },
                { $inc: { acertos: incAcertos, erros: incErros }, $set: { atualizadoEm: new Date() } },
                { upsert: true }
            );
            await jogoRodadasColl.insertOne({
                tipo, acertos: incAcertos, erros: incErros, data: new Date(), diaISO: dataDeHojeISO()
            });

            const doc = await jogoPontuacoesColl.findOne({ tipo });
            res.json({ success: true, pontuacao: { acertos: doc.acertos || 0, erros: doc.erros || 0 } });
        });

        httpServer.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
    } catch (err) { console.error(err); }
}
startServer();
