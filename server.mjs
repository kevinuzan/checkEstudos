import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import webpush from 'web-push';

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

// --- WEB PUSH CONFIG ---
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
if (publicVapidKey && privateVapidKey) {
    webpush.setVapidDetails('mailto:uzankevin93@gmail.com', publicVapidKey, privateVapidKey);
}
const EDITAL_COLLECTION = "edital_topicos";
const PLANOS_COLLECTION = "edital_planos";
const PLANO_PADRAO = "TRT";

async function startServer() {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const editalColl = db.collection(EDITAL_COLLECTION);
        const planosColl = db.collection(PLANOS_COLLECTION);

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

        httpServer.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
    } catch (err) { console.error(err); }
}
startServer();
