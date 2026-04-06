const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const admin = require('firebase-admin');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Inicialização de Segurança do Firebase lendo as chaves do Render
if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
    });
    console.log("🔥 Firebase de Notificações inicializado com sucesso.");
}

// Configuração do PostgreSQL em Nuvem
const connectionString = process.env.DATABASE_URL || 'COLE_AQUI_A_URL_DO_SEU_BANCO_POSTGRESQL';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS escalas (
                id SERIAL PRIMARY KEY,
                mes_ano TEXT UNIQUE,
                dados_json TEXT,
                data_geracao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS chamados (
                id SERIAL PRIMARY KEY,
                titulo TEXT,
                categoria TEXT,
                prioridade TEXT,
                status TEXT DEFAULT 'Pendente',
                requerente TEXT,
                atribuido TEXT DEFAULT '-',
                descricao TEXT,
                data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                progresso INTEGER DEFAULT 0
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome_usuario TEXT UNIQUE,
                senha TEXT,
                perfil TEXT,
                equipe TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS aniversarios (
                id SERIAL PRIMARY KEY,
                nome TEXT UNIQUE,
                dia INTEGER,
                mes INTEGER
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_tokens (
                id SERIAL PRIMARY KEY,
                usuario TEXT,
                token TEXT UNIQUE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_mensagens (
                id SERIAL PRIMARY KEY,
                usuario TEXT,
                mensagem TEXT,
                tipo TEXT,
                data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 🔥 AUTO-REPARO DE BANCO DE DADOS (MIGRATION) 🔥
        // Força a injeção das colunas novas nas tabelas velhas sem apagar dados
        try { await pool.query("ALTER TABLE usuarios ADD COLUMN status TEXT DEFAULT 'ATIVO'"); console.log("✔️ Coluna 'status' injetada."); } catch(e){}
        try { await pool.query("ALTER TABLE chamados ADD COLUMN link_drive TEXT DEFAULT ''"); console.log("✔️ Coluna 'link_drive' injetada."); } catch(e){}

        console.log("✅ Tabelas e Conexão com o Banco de Dados estabelecidas.");
    } catch (err) {
        console.error("❌ Erro ao configurar o banco:", err);
    }
}

setupDatabase();

// --- SISTEMA DE NOTIFICAÇÕES PUSH ---
app.post('/api/push-token', async (req, res) => {
    const { usuario, token } = req.body;
    try {
        if (!token || token.length < 20) return res.status(400).json({ sucesso: false, erro: "Token inválido" });
        await pool.query('INSERT INTO push_tokens (usuario, token) VALUES ($1, $2) ON CONFLICT (token) DO NOTHING', [usuario, token]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false }); }
});

async function dispararNotificacaoPush(titulo, corpo, perfisAlvo = null) {
    if (!process.env.FIREBASE_PROJECT_ID) return;
    try {
        let query = 'SELECT token FROM push_tokens';
        
        if (perfisAlvo && perfisAlvo.length > 0) {
            const perfisFormatados = perfisAlvo.map(p => `'${p}'`).join(',');
            query = `SELECT pt.token FROM push_tokens pt JOIN usuarios u ON pt.usuario = u.nome_usuario WHERE u.perfil IN (${perfisFormatados})`;
        }

        const resTokens = await pool.query(query);
        const tokens = resTokens.rows.map(t => t.token).filter(t => t && t.length > 20);
        
        if (tokens.length > 0) {
            const mensagem = {
                notification: { title: titulo, body: corpo },
                tokens: tokens
            };
            await admin.messaging().sendEachForMulticast(mensagem);
            console.log(`Push enviado: ${titulo}`);
        }
    } catch (error) { console.error("Erro no push em lote:", error); }
}

// --- ROTAS DE INDICADORES (DASHBOARD) ---
app.get('/api/stats', async (req, res) => {
    try {
        const resChamados = await pool.query("SELECT COUNT(*) FROM chamados WHERE status = 'Pendente'");
        const resUsuarios = await pool.query("SELECT COUNT(*) FROM usuarios WHERE status = 'ATIVO'");
        
        const hj = new Date();
        const mesAno = `${hj.getFullYear()}-${(hj.getMonth() + 1).toString().padStart(2, '0')}`;
        const diaAtual = hj.getDate();
        const horaAtual = hj.getHours();
        
        const resEscala = await pool.query("SELECT dados_json FROM escalas WHERE mes_ano = $1", [mesAno]);
        
        let proximo = "Nenhum evento agendado";
        if (resEscala.rows.length > 0) {
            const dados = JSON.parse(resEscala.rows[0].dados_json);
            
            const evento = dados.linhas.find(l => {
                const diaEv = parseInt(l.dia);
                if (diaEv > diaAtual) return true;
                
                if (diaEv === diaAtual) {
                    if (l.evento.includes("MANHÃ") && horaAtual < 13) return true;
                    if ((l.evento.includes("NOITE") || l.evento.includes("TARDE")) && horaAtual >= 13) return true;
                    if (!l.evento.includes("MANHÃ") && !l.evento.includes("NOITE") && !l.evento.includes("TARDE")) return true; 
                }
                return false;
            });

            if (evento) proximo = `Dia ${evento.dia}: ${evento.evento} (${evento.equipe})`;
        }

        res.json({
            pendentes: resChamados.rows[0].count,
            membros: resUsuarios.rows[0].count,
            proximoEvento: proximo
        });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- ROTAS DE LOGIN E USUÁRIOS ---
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;
    try {
        const result = await pool.query('SELECT id, nome_usuario as user, perfil, equipe, status FROM usuarios WHERE nome_usuario = $1 AND senha = $2', [usuario, senha]);
        if (result.rows.length > 0) {
            const userDb = result.rows[0];
            
            if (userDb.status === 'BLOQUEADO') {
                return res.status(403).json({ sucesso: false, mensagem: "Acesso bloqueado. Entre em contato com a Liderança." });
            }
            
            res.json({ sucesso: true, usuario: userDb });
        } else {
            res.status(401).json({ sucesso: false, mensagem: "Credenciais inválidas." });
        }
    } catch (err) { 
        // 🚨 Correção Crítica do undefined: O frontend espera "mensagem", e não "erro"
        res.status(500).json({ sucesso: false, mensagem: "Erro no servidor de dados: " + err.message }); 
    }
});

app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nome_usuario as user, perfil, equipe, status FROM usuarios ORDER BY nome_usuario ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/usuarios', async (req, res) => {
    const { user, senha, perfil, equipe } = req.body;
    try {
        await pool.query('INSERT INTO usuarios (nome_usuario, senha, perfil, equipe) VALUES ($1, $2, $3, $4)', [user, senha, perfil, equipe]);
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(400).json({ sucesso: false }); }
});

app.put('/api/usuarios/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query('UPDATE usuarios SET status = $1 WHERE id = $2', [status, req.params.id]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- ROTAS DO CHAT ---
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
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

// --- ROTAS DE ANIVERSÁRIOS ---
app.get('/api/aniversarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM aniversarios ORDER BY mes ASC, dia ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/aniversarios', async (req, res) => {
    const { nome, dia, mes } = req.body;
    try {
        await pool.query('INSERT INTO aniversarios (nome, dia, mes) VALUES ($1, $2, $3)', [nome, dia, mes]);
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.delete('/api/aniversarios/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM aniversarios WHERE id = $1', [req.params.id]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- ROTAS DE ESCALAS ---
app.post('/api/escalas', async (req, res) => {
    const { mesAno, dados } = req.body;
    try {
        const existe = await pool.query('SELECT 1 FROM escalas WHERE mes_ano = $1', [mesAno]);
        
        await pool.query('INSERT INTO escalas (mes_ano, dados_json) VALUES ($1, $2) ON CONFLICT (mes_ano) DO UPDATE SET dados_json = EXCLUDED.dados_json', [mesAno, JSON.stringify(dados)]);
        
        const mesNome = new Date(mesAno + "-01").toLocaleString('pt-br', { month: 'long' }).toUpperCase();
        
        const tituloPush = existe.rows.length > 0 ? "🔄 Escala Editada" : "📅 Nova Escala";
        const msgPush = existe.rows.length > 0 
            ? `A escala oficial de ${mesNome} sofreu alterações. Confira o portal atualizado.` 
            : `A escala oficial de ${mesNome} foi publicada no sistema!`;
            
        await dispararNotificacaoPush(tituloPush, msgPush);
        
        res.status(200).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.get('/api/escalas/:mesAno', async (req, res) => {
    try {
        const result = await pool.query('SELECT dados_json FROM escalas WHERE mes_ano = $1', [req.params.mesAno]);
        if (result.rows.length > 0) res.status(200).json({ sucesso: true, dados: JSON.parse(result.rows[0].dados_json) });
        else res.status(404).json({ sucesso: false });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.delete('/api/escalas/:mesAno', async (req, res) => {
    try {
        await pool.query('DELETE FROM escalas WHERE mes_ano = $1', [req.params.mesAno]);
        res.status(200).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

// --- ROTAS DE CHAMADOS ---
app.get('/api/chamados', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM chamados ORDER BY data_abertura DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/chamados', async (req, res) => {
    const { titulo, categoria, prioridade, requerente, descricao, progresso, link_drive } = req.body;
    const linkFinal = link_drive || '';
    const progressoFinal = progresso || 0;
    
    try {
        await pool.query('INSERT INTO chamados (titulo, categoria, prioridade, requerente, descricao, progresso, link_drive) VALUES ($1, $2, $3, $4, $5, $6, $7)', [titulo, categoria, prioridade, requerente, descricao, progressoFinal, linkFinal]);
        
        await dispararNotificacaoPush("🚨 Novo Chamado Aberto", `${requerente} solicitou assistência na categoria: ${categoria}.`, ['ADMIN', 'LIDER']);
        
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.put('/api/chamados/:id', async (req, res) => {
    const { id } = req.params;
    const { status, atribuido, progresso } = req.body;
    try {
        await pool.query('UPDATE chamados SET status = $1, atribuido = $2, progresso = $3 WHERE id = $4', [status, atribuido, progresso, id]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.post('/api/notificar', async (req, res) => {
    const { titulo, mensagem } = req.body;
    await dispararNotificacaoPush(titulo, mensagem);
    res.json({ sucesso: true });
});

// --- ROBÔ AUTOMÁTICO (CRON) às 07:00 AM ---
cron.schedule('0 7 * * *', async () => {
    try {
        const hj = new Date();
        const dia = hj.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric" });
        const mes = hj.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", month: "numeric" });
        const ano = hj.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });
        const mesAno = `${ano}-${mes.toString().padStart(2, '0')}`;
        const diaInt = parseInt(dia);

        const resNiver = await pool.query('SELECT nome FROM aniversarios WHERE dia = $1 AND mes = $2', [diaInt, parseInt(mes)]);
        if (resNiver.rows.length > 0) {
            for (let n of resNiver.rows) {
                await dispararNotificacaoPush("🎉 Aniversário Hoje!", `Hoje é aniversário de ${n.nome}. Parabéns!`);
            }
        }

        const resEscala = await pool.query('SELECT dados_json FROM escalas WHERE mes_ano = $1', [mesAno]);
        if (resEscala.rows.length > 0) {
            const dados = JSON.parse(resEscala.rows[0].dados_json);
            const eventoHoje = dados.linhas.find(l => parseInt(l.dia) === diaInt && l.membros !== "-");
            if (eventoHoje) {
                await dispararNotificacaoPush("📅 É HOJE!", `Evento: ${eventoHoje.evento}. Equipe: ${eventoHoje.equipe}.`);
            }
        }
    } catch (error) { console.error(error); }
}, { timezone: "America/Sao_Paulo" });

// --- ROTAS DO FRONTEND ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/escalas', (req, res) => res.sendFile(path.join(__dirname, 'views', 'escalas.html')));
app.get('/chamados', (req, res) => res.sendFile(path.join(__dirname, 'views', 'chamados.html')));
app.get('/abrir-chamado', (req, res) => res.sendFile(path.join(__dirname, 'views', 'abrir_chamado.html')));
app.get('/solicitar-arte', (req, res) => res.sendFile(path.join(__dirname, 'views', 'solicitar_arte.html')));

app.listen(PORT, () => console.log(`🚀 Sistema operando na porta ${PORT}`));
