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

async function startServer() {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const editalColl = db.collection(EDITAL_COLLECTION);

        // Listar todos os tópicos
        app.get('/api/edital', async (req, res) => {
            const itens = await editalColl.find({}).sort({ materia: 1 }).toArray();
            res.json(itens);
        });

        // Adicionar múltiplos tópicos (Bulk Insert)
        app.post('/api/edital/bulk', async (req, res) => {
            const { materia, textoBruto } = req.body;
            const linhas = textoBruto.split('\n').filter(l => l.trim() !== "");

            const docs = linhas.map(linha => ({
                materia,
                topico: linha.trim(),
                concluido: false,
                dataCriacao: new Date()
            }));

            if (docs.length > 0) {
                await editalColl.insertMany(docs);
            }
            res.json({ success: true, count: docs.length });
        });

        // Alternar Checkbox
        app.put('/api/edital/:id', async (req, res) => {
            const { id } = req.params;
            const { concluido } = req.body;
            await editalColl.updateOne(
                { _id: new ObjectId(id) },
                { $set: { concluido } }
            );
            res.json({ success: true });
        });

        // Limpar tudo (Reset)
        app.delete('/api/edital', async (req, res) => {
            await editalColl.deleteMany({});
            res.json({ success: true });
        });

        httpServer.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
    } catch (err) { console.error(err); }
}
startServer();