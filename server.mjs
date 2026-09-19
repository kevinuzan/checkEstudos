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
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import multer from 'multer';
import AdmZip from 'adm-zip';
import initSqlJs from 'sql.js';
import { decompress as decompressZstd } from 'fzstd';
import pdfParse from 'pdf-parse';

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

// --- LOGIN (Google) ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "checkestudos-troque-este-segredo-em-producao";
const EMAIL_MIGRACAO_INICIAL = "anasilvamarinheiro@gmail.com";
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- MIDDLEWARES ---
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(cookieParser());
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
const USUARIOS_COLLECTION = "usuarios";
const EDITAL_COLLECTION = "edital_topicos";
const PLANOS_COLLECTION = "edital_planos";
const TIPOS_ESTUDO_COLLECTION = "tipos_estudo";
const SESSOES_COLLECTION = "sessoes_estudo";
const MATERIAS_COR_COLLECTION = "materias_cor";
const JOGO_PONTUACOES_COLLECTION = "jogo_pontuacoes";
const JOGO_RODADAS_COLLECTION = "jogo_rodadas";
const FLASHCARDS_BARALHOS_COLLECTION = "flashcards_baralhos";
const FLASHCARDS_CARTOES_COLLECTION = "flashcards_cartoes";
const PLANO_PADRAO = "TRT";
const FORMATO_EDITAL_EXPORTADO = "checkestudos-edital-v1";

// Tipos de estudo padrão, criados automaticamente para cada usuário novo.
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
        const usuariosColl = db.collection(USUARIOS_COLLECTION);
        const editalColl = db.collection(EDITAL_COLLECTION);
        const planosColl = db.collection(PLANOS_COLLECTION);
        const tiposEstudoColl = db.collection(TIPOS_ESTUDO_COLLECTION);
        const sessoesColl = db.collection(SESSOES_COLLECTION);
        const materiasCorColl = db.collection(MATERIAS_COR_COLLECTION);
        const jogoPontuacoesColl = db.collection(JOGO_PONTUACOES_COLLECTION);
        const jogoRodadasColl = db.collection(JOGO_RODADAS_COLLECTION);
        const flashcardsBaralhosColl = db.collection(FLASHCARDS_BARALHOS_COLLECTION);
        const flashcardsCartoesColl = db.collection(FLASHCARDS_CARTOES_COLLECTION);

        // --- MIGRAÇÃO: garante que todo item tenha um array "planos" ---
        // Itens antigos (de antes de existir o conceito de "plano") são
        // atribuídos ao plano padrão, para não perder nada que já existia.
        // Esse ajuste é de formato do documento, não de dono, então roda pra
        // qualquer item, tenha ou não userId ainda.
        const semPlano = await editalColl.countDocuments({
            $or: [{ planos: { $exists: false } }, { planos: { $size: 0 } }]
        });
        if (semPlano > 0) {
            await editalColl.updateMany(
                { $or: [{ planos: { $exists: false } }, { planos: { $size: 0 } }] },
                { $set: { planos: [PLANO_PADRAO] } }
            );
        }

        // --- LOGIN / MULTIUSUÁRIO ---

        function emitirTokenSessao(usuario) {
            return jwt.sign({ userId: usuario._id.toString() }, SESSION_SECRET, { expiresIn: '180d' });
        }

        function definirCookieSessao(res, token) {
            res.cookie('sessao', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                maxAge: 180 * 24 * 60 * 60 * 1000
            });
        }

        // Cria, para um usuário novo, os dados padrão (plano e tipos de estudo)
        // que antes eram criados uma única vez, globalmente, na primeira execução.
        async function garantirDadosIniciaisDoUsuario(userId) {
            const totalPlanos = await planosColl.countDocuments({ userId });
            if (totalPlanos === 0) {
                await planosColl.insertOne({ nome: PLANO_PADRAO, ordem: 0, userId });
            }
            const totalTiposEstudo = await tiposEstudoColl.countDocuments({ userId });
            if (totalTiposEstudo === 0) {
                await tiposEstudoColl.insertMany(
                    TIPOS_ESTUDO_PADRAO.map((tipo, i) => ({ ...tipo, ordem: i, userId }))
                );
            } else {
                const jogoExiste = await tiposEstudoColl.findOne({ nome: "Jogo", userId });
                if (!jogoExiste) {
                    const ultimoTipo = await tiposEstudoColl.find({ userId }).sort({ ordem: -1 }).limit(1).toArray();
                    const proximaOrdem = ultimoTipo.length ? (ultimoTipo[0].ordem || 0) + 1 : 0;
                    await tiposEstudoColl.insertOne({ nome: "Jogo", campoExtra: "questoes", ordem: proximaOrdem, userId });
                }
            }
        }

        // Na primeira vez que a conta de anasilvamarinheiro@gmail.com faz login,
        // todo dado que já existia no banco (criado antes de existir login) e
        // ainda não tem dono passa a pertencer a ela. Roda só uma vez, controlado
        // pela flag migracaoInicialFeita no documento do usuário.
        async function migrarDadosSemDonoParaUsuario(userId) {
            const colecoesParaMigrar = [
                editalColl, planosColl, tiposEstudoColl, sessoesColl,
                materiasCorColl, jogoPontuacoesColl, jogoRodadasColl
            ];
            for (const colecao of colecoesParaMigrar) {
                await colecao.updateMany(
                    { userId: { $exists: false } },
                    { $set: { userId } }
                );
            }
        }

        // Verifica o token do Google, encontra ou cria o usuário, roda a migração
        // inicial (se for o caso) e garante que ele tenha os dados padrão.
        app.post('/api/auth/google', async (req, res) => {
            try {
                if (!GOOGLE_CLIENT_ID) {
                    return res.status(500).json({ success: false, error: 'Login com Google não está configurado no servidor (falta GOOGLE_CLIENT_ID).' });
                }
                const { credential } = req.body;
                if (!credential) return res.status(400).json({ success: false, error: 'Credencial ausente' });

                const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
                const payload = ticket.getPayload();
                const email = (payload.email || '').toLowerCase().trim();
                const nome = payload.name || email;
                const foto = payload.picture || '';
                if (!email) return res.status(400).json({ success: false, error: 'Não foi possível obter o e-mail da conta Google' });

                let usuario = await usuariosColl.findOne({ email });
                if (!usuario) {
                    const resultado = await usuariosColl.insertOne({
                        email, nome, foto,
                        migracaoInicialFeita: false,
                        criadoEm: new Date()
                    });
                    usuario = { _id: resultado.insertedId, email, nome, foto, migracaoInicialFeita: false };
                } else {
                    await usuariosColl.updateOne({ _id: usuario._id }, { $set: { nome, foto } });
                }

                const userId = usuario._id.toString();

                if (email === EMAIL_MIGRACAO_INICIAL && !usuario.migracaoInicialFeita) {
                    await migrarDadosSemDonoParaUsuario(userId);
                    await usuariosColl.updateOne({ _id: usuario._id }, { $set: { migracaoInicialFeita: true } });
                }

                await garantirDadosIniciaisDoUsuario(userId);

                const token = emitirTokenSessao(usuario);
                definirCookieSessao(res, token);
                // Se a pessoa já escolheu um apelido (nome de exibição diferente do
                // nome da conta Google), ele prevalece sobre o nome vindo do Google.
                res.json({ success: true, usuario: { nome: usuario.apelido || nome, apelido: usuario.apelido || '', nomeGoogle: nome, email, foto } });
            } catch (err) {
                console.error('Erro no login com Google:', err);
                res.status(401).json({ success: false, error: 'Falha ao verificar login do Google' });
            }
        });

        // Middleware: exige sessão válida e disponibiliza req.userId
        async function requireAuth(req, res, next) {
            try {
                const token = req.cookies && req.cookies.sessao;
                if (!token) return res.status(401).json({ success: false, error: 'Não autenticado' });
                const dados = jwt.verify(token, SESSION_SECRET);
                req.userId = dados.userId;
                next();
            } catch (err) {
                res.status(401).json({ success: false, error: 'Sessão inválida ou expirada' });
            }
        }

        app.get('/api/auth/me', requireAuth, async (req, res) => {
            const usuario = await usuariosColl.findOne({ _id: new ObjectId(req.userId) });
            if (!usuario) return res.status(401).json({ success: false, error: 'Usuário não encontrado' });
            res.json({
                success: true,
                usuario: {
                    nome: usuario.apelido || usuario.nome,
                    apelido: usuario.apelido || '',
                    nomeGoogle: usuario.nome,
                    email: usuario.email,
                    foto: usuario.foto
                }
            });
        });

        // Define (ou remove, se vazio) um apelido — o nome mostrado no app no
        // lugar do nome da conta Google. Não mexe no nome real da conta.
        app.put('/api/perfil/apelido', requireAuth, async (req, res) => {
            const apelido = (req.body.apelido || '').toString().trim().slice(0, 60);
            await usuariosColl.updateOne({ _id: new ObjectId(req.userId) }, { $set: { apelido: apelido || null } });
            const usuario = await usuariosColl.findOne({ _id: new ObjectId(req.userId) });
            if (!usuario) return res.status(401).json({ success: false, error: 'Usuário não encontrado' });
            res.json({ success: true, nome: usuario.apelido || usuario.nome, apelido: usuario.apelido || '' });
        });

        app.post('/api/auth/logout', (req, res) => {
            res.clearCookie('sessao');
            res.json({ success: true });
        });

        // Expõe o client id do Google publicamente, pra tela de login montar o botão.
        app.get('/api/auth/config', (req, res) => {
            res.json({ googleClientId: GOOGLE_CLIENT_ID });
        });

        // --- PLANOS (metas de estudo, ex: TRT, ENAM) ---

        // Listar planos
        app.get('/api/planos', requireAuth, async (req, res) => {
            const planos = await planosColl.find({ userId: req.userId }).sort({ ordem: 1, nome: 1 }).toArray();
            res.json(planos);
        });

        // Criar um novo plano
        app.post('/api/planos', requireAuth, async (req, res) => {
            const nome = (req.body.nome || '').trim();
            if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });

            const existente = await planosColl.findOne({ nome, userId: req.userId });
            if (existente) return res.json({ success: true, plano: existente, jaExistia: true });

            const ultimaOrdem = await planosColl.countDocuments({ userId: req.userId });
            const plano = { nome, ordem: ultimaOrdem, userId: req.userId };
            await planosColl.insertOne(plano);
            res.json({ success: true, plano });
        });

        // Renomear um plano (atualiza também os itens que o referenciam)
        app.put('/api/planos/:nome', requireAuth, async (req, res) => {
            const nomeAtual = req.params.nome;
            const novoNome = (req.body.nome || '').trim();
            if (!novoNome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });

            await planosColl.updateOne({ nome: nomeAtual, userId: req.userId }, { $set: { nome: novoNome } });
            await editalColl.updateMany(
                { planos: nomeAtual, userId: req.userId },
                { $set: { "planos.$[elem]": novoNome } },
                { arrayFilters: [{ elem: nomeAtual }] }
            );
            res.json({ success: true });
        });

        // Remover um plano. Os tópicos que pertenciam SOMENTE a esse plano
        // são apagados; tópicos compartilhados com outros planos continuam
        // existindo normalmente nos demais.
        app.delete('/api/planos/:nome', requireAuth, async (req, res) => {
            const nome = req.params.nome;
            await editalColl.deleteMany({ planos: [nome], userId: req.userId });
            await editalColl.updateMany(
                { planos: nome, userId: req.userId },
                { $pull: { planos: nome } }
            );
            await planosColl.deleteOne({ nome, userId: req.userId });
            res.json({ success: true });
        });

        // --- TÓPICOS DO EDITAL ---

        // Listar tópicos de um plano específico (ou todos, se nenhum for informado)
        app.get('/api/edital', requireAuth, async (req, res) => {
            const { plano } = req.query;
            const filtro = plano ? { planos: plano, userId: req.userId } : { userId: req.userId };
            const itens = await editalColl.find(filtro).sort({ materia: 1 }).toArray();
            res.json(itens);
        });

        // Adicionar múltiplos tópicos (Bulk Insert) em um ou mais planos de uma vez.
        // Se o mesmo texto de matéria+tópico já existir, o item existente é
        // apenas vinculado ao(s) novo(s) plano(s) em vez de duplicado — assim
        // o "concluido" fica automaticamente compartilhado entre os planos.
        app.post('/api/edital/bulk', requireAuth, async (req, res) => {
            // Normaliza a matéria (trim) mesmo já validando/selecionando no
            // front-end: defesa extra contra duplicidade de matéria causada
            // por espaços em branco (ex: "Direito Administrativo " x
            // "Direito Administrativo" viravam matérias diferentes).
            const materia = (req.body.materia || '').trim();
            const { textoBruto } = req.body;
            let { planos } = req.body;
            if (!materia || !textoBruto) {
                return res.status(400).json({ success: false, error: 'Preencha a matéria e os tópicos.' });
            }
            if (!planos || !Array.isArray(planos) || planos.length === 0) {
                planos = [PLANO_PADRAO];
            }
            const linhas = textoBruto.split('\n').map(l => l.trim()).filter(l => l !== "");

            let criados = 0;
            let vinculados = 0;
            for (const topico of linhas) {
                const existente = await editalColl.findOne({ materia, topico, userId: req.userId });
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
                        userId: req.userId,
                        dataCriacao: new Date()
                    });
                    criados++;
                }
            }
            res.json({ success: true, criados, vinculados });
        });

        // Renomeia uma matéria em TODOS os tópicos do usuário que a usam —
        // como matéria não é uma entidade própria (é só o texto do campo
        // "materia" em cada tópico), renomear precisa atualizar todos os
        // documentos de uma vez. Vale pra todos os planos que compartilham
        // essa matéria, não só o plano selecionado no momento. Também migra
        // a cor customizada da matéria (se houver) pro novo nome.
        app.put('/api/edital/materia', requireAuth, async (req, res) => {
            const materiaAtual = (req.body.materiaAtual || '').trim();
            const novoNome = (req.body.novoNome || '').trim();
            if (!materiaAtual || !novoNome) {
                return res.status(400).json({ success: false, error: 'Informe o nome atual e o novo nome da matéria.' });
            }
            if (materiaAtual === novoNome) {
                return res.json({ success: true, atualizados: 0 });
            }

            const resultado = await editalColl.updateMany(
                { materia: materiaAtual, userId: req.userId },
                { $set: { materia: novoNome } }
            );
            await materiasCorColl.updateOne(
                { materia: materiaAtual, userId: req.userId },
                { $set: { materia: novoNome } }
            );

            res.json({ success: true, atualizados: resultado.modifiedCount });
        });

        // Editar o texto de um tópico, a matéria e/ou os planos aos quais pertence
        app.put('/api/edital/item/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            const { topico, materia, planos } = req.body;
            const set = {};
            if (topico !== undefined) set.topico = topico;
            if (materia !== undefined) set.materia = materia;
            if (planos !== undefined) set.planos = planos;
            await editalColl.updateOne(
                { _id: new ObjectId(id), userId: req.userId },
                { $set: set }
            );
            res.json({ success: true });
        });

        // Vincula vários tópicos de uma vez a um plano adicional (migração em
        // massa, ex: "selecionei 20 tópicos do TRT e quero que valham pro ENAM
        // também"). Não remove o(s) plano(s) que o tópico já tinha.
        app.put('/api/edital/bulk-plano', requireAuth, async (req, res) => {
            const { ids, plano } = req.body;
            if (!Array.isArray(ids) || ids.length === 0 || !plano) {
                return res.status(400).json({ success: false, error: 'ids e plano são obrigatórios' });
            }
            const objectIds = ids.map(id => new ObjectId(id));
            await editalColl.updateMany(
                { _id: { $in: objectIds }, userId: req.userId },
                { $addToSet: { planos: plano } }
            );
            res.json({ success: true, atualizados: objectIds.length });
        });

        // Deletar um tópico específico
        app.delete('/api/edital/item/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            await editalColl.deleteOne({ _id: new ObjectId(id), userId: req.userId });
            res.json({ success: true });
        });

        // --- SUBTÓPICOS ---
        // Um tópico pode ser "quebrado" em vários subtópicos (útil quando um
        // item do edital junta várias coisas num texto só, tipo "Coesão e
        // coerência; mecanismos de referenciação; conectores..."). Cada
        // subtópico tem seu próprio check e conta separado pro progresso da
        // matéria — quando um tópico tem subtópicos, ele deixa de ter check
        // próprio (vira só um "container").

        // Adiciona um ou mais subtópicos a um tópico (bulk: um item de texto
        // por linha, igual o resto do app).
        app.post('/api/edital/item/:id/subtopicos', requireAuth, async (req, res) => {
            const { id } = req.params;
            const textos = Array.isArray(req.body.textos) ? req.body.textos : [];
            const novos = textos
                .map(t => (t || '').trim())
                .filter(t => t !== '')
                .map(texto => ({ id: crypto.randomUUID(), texto, concluido: false }));

            if (novos.length === 0) {
                return res.status(400).json({ success: false, error: 'Informe ao menos um subtópico.' });
            }

            await editalColl.updateOne(
                { _id: new ObjectId(id), userId: req.userId },
                { $push: { subtopicos: { $each: novos } } }
            );
            res.json({ success: true, adicionados: novos.length });
        });

        // Atualiza um subtópico específico (texto e/ou concluído)
        app.put('/api/edital/item/:id/subtopicos/:subId', requireAuth, async (req, res) => {
            const { id, subId } = req.params;
            const { texto, concluido } = req.body;

            const item = await editalColl.findOne({ _id: new ObjectId(id), userId: req.userId });
            if (!item || !Array.isArray(item.subtopicos)) {
                return res.status(404).json({ success: false, error: 'Tópico não encontrado.' });
            }

            const set = {};
            if (texto !== undefined) set['subtopicos.$[elem].texto'] = texto;
            if (concluido !== undefined) set['subtopicos.$[elem].concluido'] = concluido;

            await editalColl.updateOne(
                { _id: new ObjectId(id), userId: req.userId },
                { $set: set },
                { arrayFilters: [{ 'elem.id': subId }] }
            );
            res.json({ success: true });
        });

        // Remove um subtópico específico
        app.delete('/api/edital/item/:id/subtopicos/:subId', requireAuth, async (req, res) => {
            const { id, subId } = req.params;
            await editalColl.updateOne(
                { _id: new ObjectId(id), userId: req.userId },
                { $pull: { subtopicos: { id: subId } } }
            );
            res.json({ success: true });
        });

        // Alternar Checkbox — como o tópico é um único documento referenciado
        // por todos os planos aos quais pertence, marcar "concluído" aqui
        // reflete automaticamente em todos os planos que compartilham o tópico.
        app.put('/api/edital/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            const { concluido } = req.body;
            await editalColl.updateOne(
                { _id: new ObjectId(id), userId: req.userId },
                { $set: { concluido } }
            );
            res.json({ success: true });
        });

        // Limpar tudo (Reset) — opcionalmente restrito a um plano específico
        app.delete('/api/edital', requireAuth, async (req, res) => {
            const { plano } = req.query;
            if (plano) {
                await editalColl.deleteMany({ planos: [plano], userId: req.userId });
                await editalColl.updateMany({ planos: plano, userId: req.userId }, { $pull: { planos: plano } });
            } else {
                await editalColl.deleteMany({ userId: req.userId });
            }
            res.json({ success: true });
        });

        // --- EXPORTAR / IMPORTAR EDITAL ---
        // Formato "checkestudos-edital-v1": um JSON simples, agrupado por
        // matéria, pensado pra ser lido e editado por humanos e reaproveitado
        // por outras pessoas que queiram montar o próprio edital.

        // Modelo de exemplo, público (não exige login), pra quem for montar um
        // edital do zero saber exatamente o formato esperado.
        app.get('/api/edital/modelo', (req, res) => {
            const modelo = {
                formato: FORMATO_EDITAL_EXPORTADO,
                nomeEdital: "Meu Edital (exemplo)",
                materias: [
                    {
                        materia: "Língua Portuguesa",
                        topicos: [
                            "Interpretação de texto",
                            "Ortografia e acentuação",
                            "Concordância verbal e nominal"
                        ]
                    },
                    {
                        materia: "Direito Constitucional",
                        topicos: [
                            "Princípios fundamentais",
                            "Direitos e garantias fundamentais",
                            "Organização do Estado"
                        ]
                    }
                ]
            };
            res.setHeader('Content-Disposition', 'attachment; filename="modelo-edital-checkestudos.json"');
            res.json(modelo);
        });

        // Exporta o edital do usuário logado (opcionalmente filtrado por plano)
        // no mesmo formato do modelo, pronto pra ser importado depois ou
        // compartilhado com outra pessoa.
        app.get('/api/edital/exportar', requireAuth, async (req, res) => {
            const { plano } = req.query;
            const filtro = plano ? { planos: plano, userId: req.userId } : { userId: req.userId };
            const itens = await editalColl.find(filtro).sort({ materia: 1, topico: 1 }).toArray();

            const porMateria = new Map();
            for (const item of itens) {
                if (!porMateria.has(item.materia)) porMateria.set(item.materia, []);
                porMateria.get(item.materia).push(item.topico);
            }
            const dados = {
                formato: FORMATO_EDITAL_EXPORTADO,
                nomeEdital: plano || "Meu Edital",
                materias: Array.from(porMateria.entries()).map(([materia, topicos]) => ({ materia, topicos }))
            };

            const nomeArquivo = `edital-${(plano || 'checkestudos').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
            res.json(dados);
        });

        // Importa um edital no formato checkestudos-edital-v1 pra dentro de um
        // plano do usuário logado. Segue a mesma regra do bulk normal: tópico
        // que já existe (mesma matéria + texto) é vinculado, não duplicado.
        app.post('/api/edital/importar', requireAuth, async (req, res) => {
            const { dados, plano } = req.body;
            if (!dados || dados.formato !== FORMATO_EDITAL_EXPORTADO || !Array.isArray(dados.materias)) {
                return res.status(400).json({ success: false, error: 'Arquivo em formato inválido. Use um arquivo exportado pelo checkEstudos ou baseado no modelo.' });
            }
            const nomePlano = (plano || dados.nomeEdital || PLANO_PADRAO).trim() || PLANO_PADRAO;

            const planoExistente = await planosColl.findOne({ nome: nomePlano, userId: req.userId });
            if (!planoExistente) {
                const ultimaOrdem = await planosColl.countDocuments({ userId: req.userId });
                await planosColl.insertOne({ nome: nomePlano, ordem: ultimaOrdem, userId: req.userId });
            }

            let criados = 0;
            let vinculados = 0;
            for (const bloco of dados.materias) {
                const materia = (bloco.materia || '').trim();
                if (!materia || !Array.isArray(bloco.topicos)) continue;
                for (const topicoBruto of bloco.topicos) {
                    const topico = (topicoBruto || '').trim();
                    if (!topico) continue;
                    const existente = await editalColl.findOne({ materia, topico, userId: req.userId });
                    if (existente) {
                        await editalColl.updateOne(
                            { _id: existente._id },
                            { $addToSet: { planos: nomePlano } }
                        );
                        vinculados++;
                    } else {
                        await editalColl.insertOne({
                            materia, topico, concluido: false,
                            planos: [nomePlano], userId: req.userId, dataCriacao: new Date()
                        });
                        criados++;
                    }
                }
            }
            res.json({ success: true, plano: nomePlano, criados, vinculados });
        });

        // Gera uma SUGESTÃO de edital (matérias + tópicos) a partir de um PDF
        // enviado pela pessoa, usando IA pra extrair o conteúdo programático.
        // Não salva nada no banco — devolve os dados no mesmo formato usado
        // pelo modelo/exportação (checkestudos-edital-v1) pra pessoa revisar
        // e editar no front antes de confirmar via /api/edital/importar.
        const uploadPdfEdital = multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: 20 * 1024 * 1024 } // 20MB
        });

        app.post('/api/edital/sugestao-pdf', requireAuth, uploadPdfEdital.single('arquivo'), async (req, res) => {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Envie um arquivo PDF.' });
            }
            if (!process.env.API_CLAUDE) {
                return res.status(500).json({ success: false, error: 'A chave da API de IA não está configurada no servidor.' });
            }

            try {
                const dadosPdf = await pdfParse(req.file.buffer);

                // Limita o tamanho do PDF aceito (em páginas) antes de gastar
                // qualquer chamada de IA — controla custo e evita mandar
                // editais gigantes pro modelo de uma vez só.
                const LIMITE_PAGINAS = 50;
                if (dadosPdf.numpages && dadosPdf.numpages > LIMITE_PAGINAS) {
                    return res.status(400).json({
                        success: false,
                        error: `Esse PDF tem ${dadosPdf.numpages} páginas — o limite atual é de ${LIMITE_PAGINAS} páginas por importação. Tente enviar só a seção de conteúdo programático do edital, ou dividir o arquivo.`
                    });
                }

                let texto = (dadosPdf.text || '').trim();

                if (!texto) {
                    return res.status(400).json({
                        success: false,
                        error: 'Não foi possível ler texto desse PDF — ele pode ser um arquivo escaneado/imagem, sem texto selecionável.'
                    });
                }

                // Limita também o tamanho do texto mandado pra IA (segunda
                // rede de segurança, caso um PDF dentro do limite de páginas
                // ainda tenha um volume de texto incomum): controla custo e
                // garante folga de sobra no contexto do modelo.
                const LIMITE_CARACTERES = 220000;
                if (texto.length > LIMITE_CARACTERES) texto = texto.slice(0, LIMITE_CARACTERES);

                const ferramenta = {
                    name: 'retornar_edital',
                    description: 'Retorna a lista de matérias e tópicos do conteúdo programático extraído do edital.',
                    input_schema: {
                        type: 'object',
                        properties: {
                            nomeEdital: {
                                type: 'string',
                                description: 'Nome curto do concurso/cargo (ex: sigla do órgão + cargo), se identificável no texto.'
                            },
                            materias: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        materia: { type: 'string' },
                                        topicos: { type: 'array', items: { type: 'string' } }
                                    },
                                    required: ['materia', 'topicos']
                                }
                            }
                        },
                        required: ['materias']
                    }
                };

                const respostaIA = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.API_CLAUDE,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({
                        model: 'claude-haiku-4-5',
                        max_tokens: 8000,
                        system: 'Você extrai o conteúdo programático (matérias e tópicos) de editais de concurso público brasileiro. Ignore capa, regras de inscrição, cronograma, vagas, remuneração, rodapés e numeração de página — foque só na seção de "conteúdo programático" / "objeto de avaliação" / "programa". Cada matéria/disciplina deve virar uma entrada, com os tópicos dela como itens de texto separados, mantendo a redação original o mais fiel possível (sem resumir/reescrever o conteúdo). Não invente nada que não esteja no texto. Se não conseguir identificar o nome do concurso/cargo, deixe nomeEdital em branco.',
                        messages: [
                            { role: 'user', content: `Aqui está o texto extraído de um edital em PDF. Extraia a lista de matérias e tópicos do conteúdo programático:\n\n${texto}` }
                        ],
                        tools: [ferramenta],
                        tool_choice: { type: 'tool', name: 'retornar_edital' }
                    })
                });

                if (!respostaIA.ok) {
                    const erroTexto = await respostaIA.text();
                    console.error('Erro da API de IA ao gerar sugestão de edital:', respostaIA.status, erroTexto);
                    return res.status(502).json({ success: false, error: 'Não foi possível gerar a sugestão agora (erro na API de IA). Tente novamente em instantes.' });
                }

                const corpoIA = await respostaIA.json();
                const blocoFerramenta = (corpoIA.content || []).find(b => b.type === 'tool_use' && b.name === 'retornar_edital');
                if (!blocoFerramenta || !blocoFerramenta.input || !Array.isArray(blocoFerramenta.input.materias)) {
                    return res.status(502).json({ success: false, error: 'A IA não conseguiu identificar matérias e tópicos nesse PDF.' });
                }

                const materiasSugeridas = blocoFerramenta.input.materias
                    .map(b => ({
                        materia: (b.materia || '').trim(),
                        topicos: Array.isArray(b.topicos) ? b.topicos.map(t => (t || '').trim()).filter(t => t !== '') : []
                    }))
                    .filter(b => b.materia !== '' && b.topicos.length > 0);

                if (materiasSugeridas.length === 0) {
                    return res.status(422).json({
                        success: false,
                        error: 'Não foi possível identificar um conteúdo programático nesse PDF. Confira se é o arquivo certo ou importe manualmente.'
                    });
                }

                res.json({
                    success: true,
                    dados: {
                        formato: FORMATO_EDITAL_EXPORTADO,
                        nomeEdital: (blocoFerramenta.input.nomeEdital || '').trim() || 'Edital importado (PDF)',
                        materias: materiasSugeridas
                    }
                });
            } catch (err) {
                console.error('Erro ao gerar sugestão de edital a partir de PDF:', err);
                res.status(500).json({ success: false, error: 'Não foi possível processar esse PDF agora.' });
            }
        });

        // --- TIPOS DE ESTUDO (simulado, resumo, leitura, etc. — editáveis) ---

        // Listar tipos de estudo
        app.get('/api/tipos-estudo', requireAuth, async (req, res) => {
            const tipos = await tiposEstudoColl.find({ userId: req.userId }).sort({ ordem: 1, nome: 1 }).toArray();
            res.json(tipos);
        });

        // Criar um novo tipo de estudo
        app.post('/api/tipos-estudo', requireAuth, async (req, res) => {
            const nome = (req.body.nome || '').trim();
            const campoExtra = ['questoes', 'paginas', 'nenhum'].includes(req.body.campoExtra) ? req.body.campoExtra : 'nenhum';
            if (!nome) return res.status(400).json({ success: false, error: 'Nome obrigatório' });

            const ultimaOrdem = await tiposEstudoColl.countDocuments({ userId: req.userId });
            const tipo = { nome, campoExtra, ordem: ultimaOrdem, userId: req.userId };
            const resultado = await tiposEstudoColl.insertOne(tipo);
            res.json({ success: true, tipo: { ...tipo, _id: resultado.insertedId } });
        });

        // Editar nome e/ou campo extra de um tipo de estudo
        app.put('/api/tipos-estudo/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            const set = {};
            if (req.body.nome !== undefined) set.nome = req.body.nome.trim();
            if (req.body.campoExtra !== undefined && ['questoes', 'paginas', 'nenhum'].includes(req.body.campoExtra)) {
                set.campoExtra = req.body.campoExtra;
            }
            await tiposEstudoColl.updateOne({ _id: new ObjectId(id), userId: req.userId }, { $set: set });
            res.json({ success: true });
        });

        // Remover um tipo de estudo (sessões já registradas com ele são mantidas)
        app.delete('/api/tipos-estudo/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            await tiposEstudoColl.deleteOne({ _id: new ObjectId(id), userId: req.userId });
            res.json({ success: true });
        });

        // --- SESSÕES DE ESTUDO (cronômetro) ---

        // Monta o filtro de "pertence a este plano" para sessões: uma sessão conta
        // para um plano se QUALQUER tópico que ela estudou pertence hoje a esse
        // plano — inclusive tópicos marcados como compartilhados DEPOIS da sessão
        // ter sido registrada — ou, quando a sessão não tem tópicos vinculados,
        // se foi registrada com aquele plano ativo (fallback).
        async function filtroSessoesPorPlano(plano, userId) {
            if (!plano) return { userId };
            const topicosDoPlano = await editalColl.find({ planos: plano, userId }, { projection: { _id: 1 } }).toArray();
            const idsDoPlano = topicosDoPlano.map(t => t._id.toString());
            return {
                userId,
                $or: [
                    { "topicos.topicoId": { $in: idsDoPlano } },
                    { $or: [{ topicos: { $exists: false } }, { topicos: { $size: 0 } }], plano }
                ]
            };
        }

        // Listar sessões (mais recentes primeiro), opcionalmente filtradas por plano.
        // Uma sessão que estudou uma matéria/tópico compartilhado entre planos
        // aparece no resumo de TODOS os planos aos quais o tópico pertence.
        // Como toda sessão fica salva no perfil do usuário (não mais no
        // aparelho), ao logar em outro dispositivo o progresso aparece igual.
        app.get('/api/sessoes', requireAuth, async (req, res) => {
            const { plano, limite } = req.query;
            const filtro = await filtroSessoesPorPlano(plano, req.userId);
            const sessoes = await sessoesColl.find(filtro)
                .sort({ fim: -1 })
                .limit(parseInt(limite) || 200)
                .toArray();
            res.json(sessoes);
        });

        // Registrar uma sessão de estudo finalizada
        app.post('/api/sessoes', requireAuth, async (req, res) => {
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
                userId: req.userId,
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
        app.put('/api/sessoes/:id', requireAuth, async (req, res) => {
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

            await sessoesColl.updateOne({ _id: new ObjectId(id), userId: req.userId }, { $set: set });
            res.json({ success: true });
        });

        // Excluir uma sessão registrada
        app.delete('/api/sessoes/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            await sessoesColl.deleteOne({ _id: new ObjectId(id), userId: req.userId });
            res.json({ success: true });
        });

        // Listar revisões agendadas (pendentes por padrão), opcionalmente por plano
        // (mesma regra de compartilhamento usada em /api/sessoes)
        app.get('/api/revisoes', requireAuth, async (req, res) => {
            const { plano, status } = req.query;
            const filtroPlano = await filtroSessoesPorPlano(plano, req.userId);
            const filtro = { ...filtroPlano, "revisao.agendada": true };
            if (status !== 'todas') filtro["revisao.concluida"] = false;

            const revisoes = await sessoesColl.find(filtro).sort({ "revisao.dataRevisao": 1 }).toArray();
            res.json(revisoes);
        });

        // Marcar uma revisão agendada como concluída
        app.put('/api/revisoes/:id/concluir', requireAuth, async (req, res) => {
            const { id } = req.params;
            await sessoesColl.updateOne(
                { _id: new ObjectId(id), userId: req.userId },
                { $set: { "revisao.concluida": true, "revisao.concluidaEm": new Date() } }
            );
            res.json({ success: true });
        });

        // --- CORES DAS MATÉRIAS (usadas nos indicadores do Resumo) ---

        // Listar as cores já configuradas
        app.get('/api/materias-cor', requireAuth, async (req, res) => {
            const cores = await materiasCorColl.find({ userId: req.userId }).toArray();
            res.json(cores);
        });

        // Definir/atualizar a cor de uma matéria
        app.put('/api/materias-cor', requireAuth, async (req, res) => {
            const materia = (req.body.materia || '').trim();
            const cor = (req.body.cor || '').trim();
            if (!materia || !cor) return res.status(400).json({ success: false, error: 'Matéria e cor são obrigatórias' });

            await materiasCorColl.updateOne(
                { materia, userId: req.userId },
                { $set: { materia, cor, userId: req.userId } },
                { upsert: true }
            );
            res.json({ success: true });
        });

        // --- PONTUAÇÃO DO JOGO (mnemônicos, competências, lacunas) ---
        // Cada sub-jogo tem sua própria pontuação, nunca somada com as demais.
        // Guardamos o total acumulado (para nunca perder o histórico — não existe
        // "zerar") e também um log por rodada com a data, para saber como foi o
        // desempenho dia a dia. Tudo isso também fica salvo por usuário.
        const TIPOS_JOGO_VALIDOS = ["mnemonicos", "competencias", "lacunas"];

        function dataDeHojeISO() {
            const hoje = new Date();
            return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
        }

        // Retorna, para cada sub-jogo, o total acumulado e o desempenho de hoje
        app.get('/jogo/api/pontuacao', requireAuth, async (req, res) => {
            const totais = await jogoPontuacoesColl.find({ userId: req.userId }).toArray();
            const hojeISO = dataDeHojeISO();
            const rodadasHoje = await jogoRodadasColl.find({ diaISO: hojeISO, userId: req.userId }).toArray();

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
        app.get('/jogo/api/pontuacao/historico', requireAuth, async (req, res) => {
            const dias = Math.min(parseInt(req.query.dias) || 30, 90);
            const desde = new Date();
            desde.setDate(desde.getDate() - dias);

            const filtro = { data: { $gte: desde }, userId: req.userId };
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
        app.post('/jogo/api/pontuacao', requireAuth, async (req, res) => {
            const { tipo, acertos, erros } = req.body;
            if (!TIPOS_JOGO_VALIDOS.includes(tipo)) {
                return res.status(400).json({ success: false, error: 'Tipo de jogo inválido' });
            }
            const incAcertos = Number.isFinite(acertos) ? acertos : 0;
            const incErros = Number.isFinite(erros) ? erros : 0;

            await jogoPontuacoesColl.updateOne(
                { tipo, userId: req.userId },
                { $inc: { acertos: incAcertos, erros: incErros }, $set: { atualizadoEm: new Date(), userId: req.userId } },
                { upsert: true }
            );
            await jogoRodadasColl.insertOne({
                tipo, acertos: incAcertos, erros: incErros, data: new Date(), diaISO: dataDeHojeISO(), userId: req.userId
            });

            const doc = await jogoPontuacoesColl.findOne({ tipo, userId: req.userId });
            res.json({ success: true, pontuacao: { acertos: doc.acertos || 0, erros: doc.erros || 0 } });
        });

        // --- FLASHCARDS (baralhos próprios + importação de baralhos do Anki) ---
        // Baralhos são independentes dos planos de estudo (Edital) — servem
        // pra qualquer matéria, vinculados só ao usuário. A revisão usa um
        // algoritmo de repetição espaçada no estilo SM-2/Anki (facilidade,
        // intervalo em dias e nº de repetições guardados em cada cartão).

        const uploadApkg = multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: 40 * 1024 * 1024 } // 40MB — baralhos com mídia podem ser grandes
        });

        // --- CARTÕES CLOZE (omissão estilo Anki) ---
        //
        // Formato aceito, igual ao Anki: {{c1::resposta}}, {{c1::resposta::dica}},
        // podendo ter vários números (c1, c2, ...) no mesmo texto — cada número
        // distinto vira um CARTÃO FÍSICO separado (com sua própria repetição
        // espaçada), mostrando os demais números já revelados (como texto normal),
        // igual ao comportamento real do Anki. Cartões antigos criados antes desse
        // formato (só {{texto}}, sem número) continuam funcionando: são tratados
        // como uma única omissão "c1".
        const REGEX_CLOZE_ANKI = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
        const REGEX_CLOZE_LEGADO = /\{\{([^{}:][^{}]*)\}\}/g;

        function indicesClozeDoTexto(texto) {
            const alvo = texto || '';
            const indices = new Set();
            let m;
            const r1 = new RegExp(REGEX_CLOZE_ANKI);
            while ((m = r1.exec(alvo))) indices.add(Number(m[1]));
            if (indices.size === 0 && new RegExp(REGEX_CLOZE_LEGADO).test(alvo)) indices.add(1);
            return [...indices].sort((a, b) => a - b);
        }

        // Gera a frente/verso de UM cartão cloze específico — indiceAlvo é o
        // número (cN) que deve ficar escondido nesse cartão; os outros números
        // aparecem revelados normalmente (como no Anki, quando uma nota tem mais
        // de uma omissão).
        function renderizarClozeParaIndice(texto, indiceAlvo) {
            const alvo = texto || '';
            if (/\{\{c\d+::/.test(alvo)) {
                const frente = alvo.replace(new RegExp(REGEX_CLOZE_ANKI), (m, idx, conteudo) => {
                    const partes = conteudo.split('::');
                    if (Number(idx) !== indiceAlvo) return partes[0];
                    const dica = partes.length > 1 ? partes[partes.length - 1] : null;
                    return `<span class="cloze-lacuna">[${dica || '...'}]</span>`;
                });
                const verso = alvo.replace(new RegExp(REGEX_CLOZE_ANKI), (m, idx, conteudo) => {
                    const resposta = conteudo.split('::')[0];
                    return Number(idx) === indiceAlvo ? `<span class="cloze-resposta">${resposta}</span>` : resposta;
                });
                return { frente, verso };
            }
            // Formato antigo (sem número) — trata como uma única omissão.
            const frente = alvo.replace(new RegExp(REGEX_CLOZE_LEGADO), '<span class="cloze-lacuna">[...]</span>');
            const verso = alvo.replace(new RegExp(REGEX_CLOZE_LEGADO), '<span class="cloze-resposta">$1</span>');
            return { frente, verso };
        }

        // --- REPETIÇÃO ESPAÇADA (estilo Anki: passos de aprendizado em minutos
        // + fase de revisão em dias) ---
        //
        // Fase 1 ("novo"/"aprendendo"): passos curtos, em minutos — errar volta
        // pro primeiro passo; "Difícil" repete o passo atual; "Bom" avança pro
        // próximo passo (e gradua pra fase de revisão ao terminar o último);
        // "Fácil" gradua na hora, com um intervalo maior.
        // Fase 2 ("revisao"): intervalos em dias, crescendo pela facilidade do
        // cartão — "Difícil" sempre volta mais cedo que "Bom", "Fácil" sempre
        // mais tarde, e errar manda o cartão de volta pra um passo curto de
        // "reaprendizado" (minutos), não direto pra dias de novo.
        const PASSOS_APRENDIZADO_MIN = [1, 10];
        const PASSOS_RELEARNING_MIN = [10];
        const INTERVALO_GRADUACAO_DIAS = 1;
        const INTERVALO_FACIL_DIAS = 4;

        function calcularProximaRevisaoCartao(cartao, qualidade) {
            const agora = new Date();
            let facilidade = typeof cartao.facilidade === 'number' ? cartao.facilidade : 2.5;
            let intervalo = typeof cartao.intervalo === 'number' ? cartao.intervalo : 0;
            let repeticoes = typeof cartao.repeticoes === 'number' ? cartao.repeticoes : 0;
            let etapa = typeof cartao.etapaAprendizado === 'number' ? cartao.etapaAprendizado : 0;
            const estadoAtual = cartao.estado || 'novo';
            const emAprendizado = estadoAtual === 'novo' || estadoAtual === 'aprendendo';

            if (emAprendizado) {
                if (qualidade === 0) {
                    const minutos = PASSOS_APRENDIZADO_MIN[0];
                    return {
                        estado: 'aprendendo', etapaAprendizado: 0, facilidade, intervalo: 0, repeticoes: 0,
                        dataProximaRevisao: new Date(agora.getTime() + minutos * 60000)
                    };
                }
                if (qualidade === 3) {
                    return {
                        estado: 'revisao', etapaAprendizado: 0, facilidade: facilidade + 0.15,
                        intervalo: INTERVALO_FACIL_DIAS, repeticoes: repeticoes + 1,
                        dataProximaRevisao: new Date(agora.getTime() + INTERVALO_FACIL_DIAS * 86400000)
                    };
                }
                const proximaEtapa = qualidade === 1 ? etapa : etapa + 1;
                if (proximaEtapa < PASSOS_APRENDIZADO_MIN.length) {
                    const minutos = PASSOS_APRENDIZADO_MIN[proximaEtapa];
                    return {
                        estado: 'aprendendo', etapaAprendizado: proximaEtapa, facilidade, intervalo: 0, repeticoes,
                        dataProximaRevisao: new Date(agora.getTime() + minutos * 60000)
                    };
                }
                return {
                    estado: 'revisao', etapaAprendizado: 0, facilidade, intervalo: INTERVALO_GRADUACAO_DIAS,
                    repeticoes: repeticoes + 1, dataProximaRevisao: new Date(agora.getTime() + INTERVALO_GRADUACAO_DIAS * 86400000)
                };
            }

            // Fase de revisão (dias)
            if (qualidade === 0) {
                const minutos = PASSOS_RELEARNING_MIN[0];
                return {
                    estado: 'aprendendo', etapaAprendizado: 0, facilidade: Math.max(1.3, facilidade - 0.2),
                    intervalo: 1, repeticoes: 0, dataProximaRevisao: new Date(agora.getTime() + minutos * 60000)
                };
            }

            let novaFacilidade = facilidade;
            let novoIntervalo;
            if (qualidade === 1) { // Difícil
                novaFacilidade = Math.max(1.3, facilidade - 0.15);
                novoIntervalo = Math.max(intervalo + 1, Math.round(intervalo * 1.2));
            } else if (qualidade === 3) { // Fácil
                novaFacilidade = facilidade + 0.15;
                novoIntervalo = Math.max(intervalo + 1, Math.round(intervalo * novaFacilidade * 1.3));
            } else { // Bom
                novoIntervalo = Math.max(intervalo + 1, Math.round(intervalo * novaFacilidade));
            }

            return {
                estado: 'revisao', etapaAprendizado: 0, facilidade: novaFacilidade, intervalo: novoIntervalo,
                repeticoes: repeticoes + 1, dataProximaRevisao: new Date(agora.getTime() + novoIntervalo * 86400000)
            };
        }

        // Lê um arquivo .apkg (zip do Anki) e devolve uma lista de "baralhos"
        // (um por deck-folha do Anki que tenha cartões), cada um já com seu
        // caminho de pastas (ex: ["ENAM","Direito Administrativo"] pro deck
        // "ENAM::Direito Administrativo::Jurisprudência - Súmulas STF") e seus
        // cartões — detectando automaticamente notas do tipo Cloze (pelo próprio
        // texto do campo, que é robusto a qualquer versão de esquema do Anki) e
        // gerando um cartão físico por número de omissão, exatamente como o
        // Anki faz.
        async function extrairBaralhosDeApkg(buffer) {
            const zip = new AdmZip(buffer);
            const entradas = zip.getEntries();
            const acharEntrada = (nome) => entradas.find(e => e.entryName === nome);

            let dadosBanco = null;
            const entradaZstd = acharEntrada('collection.anki21b');
            const entrada21 = acharEntrada('collection.anki21');
            const entrada2 = acharEntrada('collection.anki2');

            if (entradaZstd) dadosBanco = decompressZstd(entradaZstd.getData());
            else if (entrada21) dadosBanco = entrada21.getData();
            else if (entrada2) dadosBanco = entrada2.getData();
            else throw new Error('Não encontramos o banco de dados do baralho dentro do arquivo .apkg');

            const SQL = await initSqlJs();
            const db = new SQL.Database(new Uint8Array(dadosBanco));

            let linhasCartoes;
            let deckNomePorId = {};

            try {
                // Nomes dos decks: tenta primeiro o JSON legado (col.decks), que a
                // maioria das exportações do Anki ainda inclui por compatibilidade;
                // se não existir/estiver vazio, tenta a tabela "decks" (esquemas
                // mais novos do Anki).
                try {
                    const colRes = db.exec('SELECT decks FROM col LIMIT 1');
                    if (colRes.length > 0 && colRes[0].values[0][0]) {
                        const obj = JSON.parse(colRes[0].values[0][0]);
                        Object.values(obj).forEach(d => { deckNomePorId[String(d.id)] = d.name; });
                    }
                } catch (e) { /* segue pro fallback abaixo */ }

                if (Object.keys(deckNomePorId).length === 0) {
                    try {
                        const decksRes = db.exec('SELECT id, name FROM decks');
                        if (decksRes.length > 0) {
                            decksRes[0].values.forEach(([id, name]) => { deckNomePorId[String(id)] = name; });
                        }
                    } catch (e) { /* nem essa tabela existe nesse arquivo — segue sem nomes de deck */ }
                }

                const resultado = db.exec('SELECT c.did AS did, c.ord AS ord, c.nid AS nid, n.flds AS flds FROM cards c JOIN notes n ON n.id = c.nid');
                linhasCartoes = resultado.length > 0 ? resultado[0].values : [];
            } finally {
                db.close();
            }

            const SEPARADOR_CAMPOS = '\x1f';
            const baralhosPorCaminho = new Map();

            linhasCartoes.forEach(linha => {
                const [did, ord, nid, flds] = linha;
                if (typeof flds !== 'string' || !flds) return;

                const nomeCompletoDeck = deckNomePorId[String(did)] || 'Baralho importado';
                const segmentos = nomeCompletoDeck.split('::').map(s => s.trim()).filter(s => s !== '');
                const nome = segmentos.length > 0 ? segmentos[segmentos.length - 1] : 'Baralho importado';
                const caminho = segmentos.slice(0, -1);
                const chave = segmentos.join('::') || 'Baralho importado';

                if (!baralhosPorCaminho.has(chave)) {
                    baralhosPorCaminho.set(chave, { caminho, nome, cartoes: [] });
                }

                const campos = flds.split(SEPARADOR_CAMPOS);
                const campo0 = (campos[0] || '').trim();
                const ehCloze = /\{\{c\d+::/.test(campo0);

                if (ehCloze) {
                    const indiceAlvo = Number(ord) + 1;
                    const { frente, verso } = renderizarClozeParaIndice(campo0, indiceAlvo);
                    const extra = campos.slice(1).join('<br>').trim();
                    baralhosPorCaminho.get(chave).cartoes.push({
                        tipo: 'cloze', frente,
                        verso: extra ? `${verso}<div class="cloze-extra-render">${extra}</div>` : verso,
                        clozeTexto: campo0, clozeExtra: extra, clozeIndice: indiceAlvo, origemClozeId: `anki-nota-${nid}`
                    });
                } else {
                    const frente = campo0 || '(sem frente)';
                    const verso = campos.slice(1).join('<br>').trim();
                    if (frente || verso) baralhosPorCaminho.get(chave).cartoes.push({ tipo: 'basico', frente, verso });
                }
            });

            return [...baralhosPorCaminho.values()].filter(b => b.cartoes.length > 0);
        }

        // --- BARALHOS ---

        // Lista os baralhos do usuário, com o total de cartões e quantos já
        // estão pendentes hoje — separados em Novo / Aprender / Revisar, igual
        // o navegador de baralhos do Anki.
        app.get('/api/flashcards/baralhos', requireAuth, async (req, res) => {
            const baralhos = await flashcardsBaralhosColl.find({ userId: req.userId }).sort({ criadoEm: -1 }).toArray();
            const agora = new Date();

            const contagens = await flashcardsCartoesColl.aggregate([
                { $match: { userId: req.userId } },
                { $group: {
                    _id: '$baralhoId',
                    total: { $sum: 1 },
                    novos: { $sum: { $cond: [{ $and: [{ $eq: ['$estado', 'novo'] }, { $lte: ['$dataProximaRevisao', agora] }] }, 1, 0] } },
                    aprender: { $sum: { $cond: [{ $and: [{ $eq: ['$estado', 'aprendendo'] }, { $lte: ['$dataProximaRevisao', agora] }] }, 1, 0] } },
                    revisar: { $sum: { $cond: [{ $and: [{ $eq: ['$estado', 'revisao'] }, { $lte: ['$dataProximaRevisao', agora] }] }, 1, 0] } }
                } }
            ]).toArray();
            const contagemPorBaralho = {};
            contagens.forEach(c => { contagemPorBaralho[c._id] = c; });

            res.json(baralhos.map(b => {
                const c = contagemPorBaralho[String(b._id)] || {};
                return {
                    _id: b._id,
                    nome: b.nome,
                    materia: b.materia || '',
                    caminho: Array.isArray(b.caminho) ? b.caminho : [],
                    origem: b.origem || 'manual',
                    criadoEm: b.criadoEm,
                    totalCartoes: c.total || 0,
                    novos: c.novos || 0,
                    aprender: c.aprender || 0,
                    revisar: c.revisar || 0,
                    aRevisar: (c.novos || 0) + (c.aprender || 0) + (c.revisar || 0)
                };
            }));
        });

        app.post('/api/flashcards/baralhos', requireAuth, async (req, res) => {
            const nome = (req.body.nome || '').trim();
            const materia = (req.body.materia || '').trim();
            if (!nome) return res.status(400).json({ success: false, error: 'Nome do baralho é obrigatório' });

            const doc = { nome, materia, origem: 'manual', userId: req.userId, criadoEm: new Date() };
            const resultado = await flashcardsBaralhosColl.insertOne(doc);
            res.json({ success: true, baralho: { ...doc, _id: resultado.insertedId } });
        });

        app.put('/api/flashcards/baralhos/:id', requireAuth, async (req, res) => {
            const nome = (req.body.nome || '').trim();
            const materia = (req.body.materia || '').trim();
            if (!nome) return res.status(400).json({ success: false, error: 'Nome do baralho é obrigatório' });

            const resultado = await flashcardsBaralhosColl.updateOne(
                { _id: new ObjectId(req.params.id), userId: req.userId },
                { $set: { nome, materia } }
            );
            if (resultado.matchedCount === 0) return res.status(404).json({ success: false, error: 'Baralho não encontrado' });
            res.json({ success: true });
        });

        app.delete('/api/flashcards/baralhos/:id', requireAuth, async (req, res) => {
            const baralho = await flashcardsBaralhosColl.findOne({ _id: new ObjectId(req.params.id), userId: req.userId });
            if (!baralho) return res.status(404).json({ success: false, error: 'Baralho não encontrado' });

            await flashcardsCartoesColl.deleteMany({ baralhoId: String(baralho._id), userId: req.userId });
            await flashcardsBaralhosColl.deleteOne({ _id: baralho._id });
            res.json({ success: true });
        });

        // Importa um arquivo .apkg do Anki como um novo baralho.
        // Importa um .apkg preservando a estrutura de pastas do Anki: cada deck
        // do Anki que tem cartões vira um baralho aqui, com seu caminho de
        // pastas (matéria/subpasta) preenchido automaticamente. Notas Cloze são
        // detectadas pelo próprio texto e viram cartões de omissão de verdade
        // (um cartão físico por número de lacuna, como no Anki).
        app.post('/api/flashcards/baralhos/importar-anki', requireAuth, uploadApkg.single('arquivo'), async (req, res) => {
            if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });

            let baralhosExtraidos;
            try {
                baralhosExtraidos = await extrairBaralhosDeApkg(req.file.buffer);
            } catch (err) {
                console.error('Erro ao importar .apkg:', err);
                return res.status(400).json({ success: false, error: 'Não conseguimos ler esse arquivo .apkg. Verifique se é um baralho exportado do Anki.' });
            }

            if (baralhosExtraidos.length === 0) {
                return res.status(400).json({ success: false, error: 'Nenhum cartão foi encontrado nesse arquivo.' });
            }

            // Nome customizado só faz sentido quando o .apkg tem um único deck
            // (sem hierarquia) — com vários decks, os nomes vêm da própria
            // estrutura de pastas do Anki, que é o que a pessoa pediu pra manter.
            const nomeCustom = (req.body.nome || '').trim().slice(0, 120);

            const agora = new Date();
            let totalBaralhos = 0;
            let totalCartoes = 0;

            for (const b of baralhosExtraidos) {
                const nome = (baralhosExtraidos.length === 1 && nomeCustom) ? nomeCustom : b.nome;
                const materia = b.caminho.length > 0 ? b.caminho[b.caminho.length - 1] : '';
                const baralhoDoc = { nome, materia, caminho: b.caminho, origem: 'anki', userId: req.userId, criadoEm: agora };
                const baralhoInserido = await flashcardsBaralhosColl.insertOne(baralhoDoc);
                const baralhoId = String(baralhoInserido.insertedId);

                const docsCartoes = b.cartoes.map(c => ({
                    baralhoId, userId: req.userId, tipo: c.tipo, frente: c.frente, verso: c.verso,
                    ...(c.tipo === 'cloze' ? { clozeTexto: c.clozeTexto, clozeExtra: c.clozeExtra, clozeIndice: c.clozeIndice, origemClozeId: c.origemClozeId } : {}),
                    facilidade: 2.5, intervalo: 0, repeticoes: 0, etapaAprendizado: 0,
                    dataProximaRevisao: agora, estado: 'novo', criadoEm: agora
                }));
                if (docsCartoes.length > 0) await flashcardsCartoesColl.insertMany(docsCartoes);

                totalBaralhos += 1;
                totalCartoes += docsCartoes.length;
            }

            res.json({ success: true, totalBaralhos, totalImportado: totalCartoes });
        });

        // --- CARTÕES ---

        app.get('/api/flashcards/baralhos/:id/cards', requireAuth, async (req, res) => {
            const baralho = await flashcardsBaralhosColl.findOne({ _id: new ObjectId(req.params.id), userId: req.userId });
            if (!baralho) return res.status(404).json({ success: false, error: 'Baralho não encontrado' });

            const cartoes = await flashcardsCartoesColl.find({ baralhoId: req.params.id, userId: req.userId }).sort({ criadoEm: 1 }).toArray();
            res.json(cartoes);
        });

        // Cria cartão(ões). Pra "cloze", o texto pode ter mais de uma omissão
        // numerada ({{c1::..}}, {{c2::..}}) — cada número vira um cartão físico
        // próprio (com repetição espaçada independente), todos ligados pelo
        // mesmo "origemClozeId" pra poderem ser sincronizados numa edição futura.
        app.post('/api/flashcards/baralhos/:id/cards', requireAuth, async (req, res) => {
            const baralho = await flashcardsBaralhosColl.findOne({ _id: new ObjectId(req.params.id), userId: req.userId });
            if (!baralho) return res.status(404).json({ success: false, error: 'Baralho não encontrado' });

            const tipo = req.body.tipo === 'cloze' ? 'cloze' : 'basico';
            const agora = new Date();

            if (tipo === 'cloze') {
                const clozeTexto = (req.body.clozeTexto || '').trim();
                const clozeExtra = (req.body.clozeExtra || '').trim();
                const indices = indicesClozeDoTexto(clozeTexto);
                if (indices.length === 0) {
                    return res.status(400).json({ success: false, error: 'Selecione ao menos um trecho e clique em "Omitir" pra criar a lacuna.' });
                }

                const origemClozeId = crypto.randomUUID();
                const docs = indices.map(indiceAlvo => {
                    const { frente, verso } = renderizarClozeParaIndice(clozeTexto, indiceAlvo);
                    return {
                        baralhoId: req.params.id, userId: req.userId, tipo, frente,
                        verso: clozeExtra ? `${verso}<div class="cloze-extra-render">${clozeExtra}</div>` : verso,
                        clozeTexto, clozeExtra, clozeIndice: indiceAlvo, origemClozeId,
                        facilidade: 2.5, intervalo: 0, repeticoes: 0, etapaAprendizado: 0,
                        dataProximaRevisao: agora, estado: 'novo', criadoEm: agora
                    };
                });
                const resultado = await flashcardsCartoesColl.insertMany(docs);
                res.json({ success: true, total: docs.length, cartoes: docs.map((d, i) => ({ ...d, _id: resultado.insertedIds[i] })) });
            } else {
                const frente = (req.body.frente || '').trim();
                const verso = (req.body.verso || '').trim();
                if (!frente) return res.status(400).json({ success: false, error: 'A frente do cartão é obrigatória' });

                const doc = {
                    baralhoId: req.params.id, userId: req.userId, tipo, frente, verso,
                    facilidade: 2.5, intervalo: 0, repeticoes: 0, etapaAprendizado: 0,
                    dataProximaRevisao: agora, estado: 'novo', criadoEm: agora
                };
                const resultado = await flashcardsCartoesColl.insertOne(doc);
                res.json({ success: true, total: 1, cartao: { ...doc, _id: resultado.insertedId } });
            }
        });

        // Edita um cartão. Pra "cloze", sincroniza com os cartões-irmãos (mesma
        // origemClozeId): atualiza os que continuam existindo no texto, cria os
        // que forem números novos e remove os que sumiram do texto.
        app.put('/api/flashcards/cards/:id', requireAuth, async (req, res) => {
            const cartaoAtual = await flashcardsCartoesColl.findOne({ _id: new ObjectId(req.params.id), userId: req.userId });
            if (!cartaoAtual) return res.status(404).json({ success: false, error: 'Cartão não encontrado' });

            const tipo = req.body.tipo === 'cloze' ? 'cloze' : 'basico';

            if (tipo === 'cloze') {
                const clozeTexto = (req.body.clozeTexto || '').trim();
                const clozeExtra = (req.body.clozeExtra || '').trim();
                const indices = indicesClozeDoTexto(clozeTexto);
                if (indices.length === 0) {
                    return res.status(400).json({ success: false, error: 'Selecione ao menos um trecho e clique em "Omitir" pra criar a lacuna.' });
                }

                const irmaos = cartaoAtual.origemClozeId
                    ? await flashcardsCartoesColl.find({ origemClozeId: cartaoAtual.origemClozeId, userId: req.userId }).toArray()
                    : [cartaoAtual];
                const origemClozeId = cartaoAtual.origemClozeId || crypto.randomUUID();

                const porIndice = {};
                irmaos.forEach(c => { porIndice[c.clozeIndice || 1] = c; });

                const agora = new Date();
                const operacoes = [];

                indices.forEach(indiceAlvo => {
                    const { frente, verso } = renderizarClozeParaIndice(clozeTexto, indiceAlvo);
                    const versoFinal = clozeExtra ? `${verso}<div class="cloze-extra-render">${clozeExtra}</div>` : verso;
                    const existente = porIndice[indiceAlvo];
                    if (existente) {
                        operacoes.push(flashcardsCartoesColl.updateOne(
                            { _id: existente._id },
                            { $set: { frente, verso: versoFinal, clozeTexto, clozeExtra, clozeIndice: indiceAlvo, origemClozeId } }
                        ));
                    } else {
                        operacoes.push(flashcardsCartoesColl.insertOne({
                            baralhoId: cartaoAtual.baralhoId, userId: req.userId, tipo, frente, verso: versoFinal,
                            clozeTexto, clozeExtra, clozeIndice: indiceAlvo, origemClozeId,
                            facilidade: 2.5, intervalo: 0, repeticoes: 0, etapaAprendizado: 0,
                            dataProximaRevisao: agora, estado: 'novo', criadoEm: agora
                        }));
                    }
                });

                const removerIds = irmaos.filter(c => !indices.includes(c.clozeIndice || 1)).map(c => c._id);
                if (removerIds.length > 0) operacoes.push(flashcardsCartoesColl.deleteMany({ _id: { $in: removerIds } }));

                await Promise.all(operacoes);
                res.json({ success: true });
            } else {
                const frente = (req.body.frente || '').trim();
                const verso = (req.body.verso || '').trim();
                if (!frente) return res.status(400).json({ success: false, error: 'A frente do cartão é obrigatória' });

                await flashcardsCartoesColl.updateOne(
                    { _id: cartaoAtual._id },
                    {
                        $set: { tipo, frente, verso },
                        $unset: { clozeTexto: '', clozeExtra: '', clozeIndice: '', origemClozeId: '' }
                    }
                );
                res.json({ success: true });
            }
        });

        app.delete('/api/flashcards/cards/:id', requireAuth, async (req, res) => {
            const resultado = await flashcardsCartoesColl.deleteOne({ _id: new ObjectId(req.params.id), userId: req.userId });
            if (resultado.deletedCount === 0) return res.status(404).json({ success: false, error: 'Cartão não encontrado' });
            res.json({ success: true });
        });

        // --- REVISÃO (repetição espaçada) ---

        // Cartões pendentes de revisão nesse baralho agora (novos + atrasados).
        app.get('/api/flashcards/baralhos/:id/revisar', requireAuth, async (req, res) => {
            const baralho = await flashcardsBaralhosColl.findOne({ _id: new ObjectId(req.params.id), userId: req.userId });
            if (!baralho) return res.status(404).json({ success: false, error: 'Baralho não encontrado' });

            const cartoes = await flashcardsCartoesColl.find({
                baralhoId: req.params.id, userId: req.userId, dataProximaRevisao: { $lte: new Date() }
            }).sort({ dataProximaRevisao: 1 }).limit(200).toArray();
            res.json(cartoes);
        });

        app.post('/api/flashcards/cards/:id/revisar', requireAuth, async (req, res) => {
            const qualidade = Number(req.body.qualidade);
            if (![0, 1, 2, 3].includes(qualidade)) return res.status(400).json({ success: false, error: 'Qualidade inválida' });

            const cartao = await flashcardsCartoesColl.findOne({ _id: new ObjectId(req.params.id), userId: req.userId });
            if (!cartao) return res.status(404).json({ success: false, error: 'Cartão não encontrado' });

            const novoEstado = calcularProximaRevisaoCartao(cartao, qualidade);
            await flashcardsCartoesColl.updateOne({ _id: cartao._id }, { $set: novoEstado });
            res.json({ success: true, cartao: { ...cartao, ...novoEstado } });
        });

        httpServer.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
    } catch (err) { console.error(err); }
}
startServer();
