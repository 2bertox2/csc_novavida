const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const admin = require('firebase-admin');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
    });
    console.log("🔥 Firebase operando para notificações de gestão.");
}

const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_jpUhIyC2Bi7O@ep-red-truth-acfzcveg-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS escalas (
                id SERIAL PRIMARY KEY,
                mes_ano TEXT UNIQUE,
                dados_json TEXT,
                data_geracao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS chamados (
                id SERIAL PRIMARY KEY,
                titulo TEXT,
                categoria TEXT,
                prioridade TEXT,
                status TEXT DEFAULT 'Pendente',
                requerente TEXT,
                atribuido TEXT DEFAULT '-',
                descricao TEXT,
                link_drive TEXT DEFAULT '',
                data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                progresso INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome_usuario TEXT UNIQUE,
                senha TEXT,
                perfil TEXT,
                equipe TEXT,
                status TEXT DEFAULT 'ATIVO'
            );
            CREATE TABLE IF NOT EXISTS chat_mensagens (
                id SERIAL PRIMARY KEY,
                usuario TEXT,
                mensagem TEXT,
                tipo TEXT, -- 'GERAL' ou 'LIDERES'
                data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS push_tokens (
                id SERIAL PRIMARY KEY,
                usuario TEXT,
                token TEXT UNIQUE
            );
        `);
        console.log("✅ Infraestrutura de dados atualizada.");
    } catch (err) { console.error(err); }
}
setupDatabase();

// --- SISTEMA DE NOTIFICAÇÕES ---
async function dispararPush(titulo, corpo, perfisAlvo = null) {
    if (!process.env.FIREBASE_PROJECT_ID) return;
    try {
        let query = 'SELECT token FROM push_tokens';
        if (perfisAlvo) {
            query = `SELECT pt.token FROM push_tokens pt JOIN usuarios u ON pt.usuario = u.nome_usuario WHERE u.perfil IN (${perfisAlvo.map(p => `'${p}'`).join(',')})`;
        }
        const resTokens = await pool.query(query);
        const tokens = resTokens.rows.map(t => t.token).filter(t => t && t.length > 20);
        if (tokens.length > 0) {
            const mensagem = { notification: { title: titulo, body: corpo }, tokens: tokens };
            await admin.messaging().sendEachForMulticast(mensagem);
        }
    } catch (error) { console.error("Erro push:", error); }
}

// --- GESTÃO DE USUÁRIOS E BLOQUEIO ---
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE nome_usuario = $1 AND senha = $2', [usuario, senha]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (user.status === 'BLOQUEADO') {
                return res.status(403).json({ sucesso: false, mensagem: "Acesso bloqueado. Instale o App e ative notificações para liberar." });
            }
            res.json({ sucesso: true, usuario: { id: user.id, user: user.nome_usuario, perfil: user.perfil, equipe: user.equipe } });
        } else res.status(401).json({ sucesso: false, mensagem: "Credenciais inválidas." });
    } catch (err) { res.status(500).json({ sucesso: false }); }
});

app.put('/api/usuarios/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query('UPDATE usuarios SET status = $1 WHERE id = $2', [status, req.params.id]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- DASHBOARD: LÓGICA DE CULTO DOMINGO ---
app.get('/api/stats', async (req, res) => {
    try {
        const resChamados = await pool.query("SELECT COUNT(*) FROM chamados WHERE status = 'Pendente'");
        const resUsuarios = await pool.query("SELECT COUNT(*) FROM usuarios WHERE status = 'ATIVO'");
        const hj = new Date();
        const diaAtual = hj.getDate();
        const mesAno = `${hj.getFullYear()}-${(hj.getMonth() + 1).toString().padStart(2, '0')}`;
        const resEscala = await pool.query("SELECT dados_json FROM escalas WHERE mes_ano = $1", [mesAno]);
        
        let proximo = "Nenhum agendado";
        if (resEscala.rows.length > 0) {
            const dados = JSON.parse(resEscala.rows[0].dados_json);
            const hora = hj.getHours();
            const evento = dados.linhas.find(l => {
                const diaEv = parseInt(l.dia);
                if (diaEv > diaAtual) return true;
                if (diaEv === diaAtual) {
                    if (l.evento.includes("MANHÃ") && hora < 13) return true;
                    if (l.evento.includes("NOITE") || l.evento.includes("TARDE")) return true;
                }
                return false;
            });
            if (evento) proximo = `Dia ${evento.dia}: ${evento.evento} (${evento.equipe})`;
        }
        res.json({ pendentes: resChamados.rows[0].count, membros: resUsuarios.rows[0].count, proximoEvento: proximo });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- SISTEMA DE CHAT ---
app.get('/api/chat/:tipo', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM chat_mensagens WHERE tipo = $1 ORDER BY data_envio DESC LIMIT 50', [req.params.tipo]);
        res.json(result.rows.reverse());
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/chat', async (req, res) => {
    const { usuario, mensagem, tipo } = req.body;
    try {
        await pool.query('INSERT INTO chat_mensagens (usuario, mensagem, tipo) VALUES ($1, $2, $3)', [usuario, mensagem, tipo]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- CHAMADOS COM NOTIFICAÇÃO PARA ADMIN ---
app.post('/api/chamados', async (req, res) => {
    const { titulo, categoria, prioridade, requerente, descricao, link_drive } = req.body;
    try {
        await pool.query('INSERT INTO chamados (titulo, categoria, prioridade, requerente, descricao, link_drive) VALUES ($1, $2, $3, $4, $5, $6)', [titulo, categoria, prioridade, requerente, descricao, link_drive]);
        await dispararPush("🚨 Novo Chamado Aberto", `${requerente} solicitou assistência em ${categoria}.`, ['ADMIN', 'LIDER']);
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false }); }
});

// --- ESCALAS COM NOTIFICAÇÃO DE EDIÇÃO ---
app.post('/api/escalas', async (req, res) => {
    const { mesAno, dados } = req.body;
    try {
        const existe = await pool.query('SELECT 1 FROM escalas WHERE mes_ano = $1', [mesAno]);
        await pool.query('INSERT INTO escalas (mes_ano, dados_json) VALUES ($1, $2) ON CONFLICT (mes_ano) DO UPDATE SET dados_json = EXCLUDED.dados_json', [mesAno, JSON.stringify(dados)]);
        
        const mesNome = new Date(mesAno + "-01").toLocaleString('pt-br', { month: 'long' }).toUpperCase();
        const msg = existe.rows.length > 0 ? `A escala de ${mesNome} foi alterada. Confira as novas posições.` : `A escala de ${mesNome} está disponível!`;
        await dispararPush(existe.rows.length > 0 ? "🔄 Escala Editada" : "📅 Nova Escala", msg);
        
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false }); }
});

// Rotas de listagem genéricas mantidas para compatibilidade
app.get('/api/usuarios', async (req, res) => {
    const result = await pool.query('SELECT id, nome_usuario as user, perfil, equipe, status FROM usuarios ORDER BY nome_usuario ASC');
    res.json(result.rows);
});
app.get('/api/chamados', async (req, res) => {
    const result = await pool.query('SELECT * FROM chamados ORDER BY data_abertura DESC');
    res.json(result.rows);
});
app.put('/api/chamados/:id', async (req, res) => {
    const { status, atribuido, progresso } = req.body;
    await pool.query('UPDATE chamados SET status = $1, atribuido = $2, progresso = $3 WHERE id = $4', [status, atribuido, progresso, req.params.id]);
    res.json({ sucesso: true });
});
app.post('/api/push-token', async (req, res) => {
    const { usuario, token } = req.body;
    await pool.query('INSERT INTO push_tokens (usuario, token) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET token = EXCLUDED.token', [usuario, token]);
    res.json({ sucesso: true });
});
app.post('/api/notificar', async (req, res) => {
    const { titulo, mensagem } = req.body;
    await dispararPush(titulo, mensagem);
    res.json({ sucesso: true });
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/escalas', (req, res) => res.sendFile(path.join(__dirname, 'views', 'escalas.html')));
app.get('/chamados', (req, res) => res.sendFile(path.join(__dirname, 'views', 'chamados.html')));
app.get('/abrir-chamado', (req, res) => res.sendFile(path.join(__dirname, 'views', 'abrir_chamado.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Sistema CSC operando na porta ${PORT}`));
