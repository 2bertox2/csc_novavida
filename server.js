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
const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_jpUhIyC2Bi7O@ep-red-truth-acfzcveg-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

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
                progresso INTEGER DEFAULT 100
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

        const usuariosBase = [
            { nome_usuario: 'humberto.xavier', perfil: 'ADMIN', equipe: 'G', senha: 'equipeG' },
            { nome_usuario: 'carlos.alberto', perfil: 'ADMIN', equipe: 'A', senha: 'equipeA' },
            { nome_usuario: 'augusto.carlos', perfil: 'ADMIN', equipe: 'NENHUMA', senha: 'equipeADM' },
            { nome_usuario: 'wallerson.oliveira', perfil: 'LIDER', equipe: 'C', senha: 'equipeC' },
            { nome_usuario: 'sergio.miguel', perfil: 'LIDER', equipe: 'B', senha: 'equipeB' },
            { nome_usuario: 'luiz.shalon', perfil: 'LIDER', equipe: 'D', senha: 'equipeD' },
            { nome_usuario: 'marcos.silva', perfil: 'LIDER', equipe: 'E', senha: 'equipeE' },
            { nome_usuario: 'samuel.piske', perfil: 'LIDER', equipe: 'F', senha: 'equipeF' },
            { nome_usuario: 'rodrigo.botelho', perfil: 'MEMBRO', equipe: 'E', senha: 'equipeE' },
            { nome_usuario: 'wallysson.evaristo', perfil: 'MEMBRO', equipe: 'C', senha: 'equipeC' },
            { nome_usuario: 'victor.ribeiro', perfil: 'MEMBRO', equipe: 'E', senha: 'equipeE' },
            { nome_usuario: 'benvindo.miguel', perfil: 'MEMBRO', equipe: 'B', senha: 'equipeB' },
            { nome_usuario: 'mateus.pinheiro', perfil: 'MEMBRO', equipe: 'C', senha: 'equipeC' },
            { nome_usuario: 'davi.augusto', perfil: 'MEMBRO', equipe: 'B', senha: 'equipeB' },
            { nome_usuario: 'jose.balieiro', perfil: 'MEMBRO', equipe: 'C', senha: 'equipeC' },
            { nome_usuario: 'genivaldo.fernandes', perfil: 'MEMBRO', equipe: 'E', senha: 'equipeE' },
            { nome_usuario: 'carlos.rodrigues', perfil: 'MEMBRO', equipe: 'A', senha: 'equipeA' },
            { nome_usuario: 'eduardo.marques', perfil: 'MEMBRO', equipe: 'C', senha: 'equipeC' }
        ];

        for (let u of usuariosBase) {
            await pool.query(
                'INSERT INTO usuarios (nome_usuario, senha, perfil, equipe) VALUES ($1, $2, $3, $4) ON CONFLICT (nome_usuario) DO NOTHING',
                [u.nome_usuario, u.senha, u.perfil, u.equipe]
            );
        }

        const aniversariosBase = [
            { nome: 'Rodrigo Botelho', dia: 21, mes: 11 },
            { nome: 'Wallysson Evaristo', dia: 17, mes: 4 },
            { nome: 'Victor Ribeiro', dia: 6, mes: 9 },
            { nome: 'Benvindo Ferreira Miguel', dia: 11, mes: 11 },
            { nome: 'Mateus Pinheiro', dia: 26, mes: 3 },
            { nome: 'Davi Augusto Santos Miguel', dia: 6, mes: 2 },
            { nome: 'José Balieiro', dia: 23, mes: 3 },
            { nome: 'Genivaldo Fernandes (Binho)', dia: 26, mes: 7 },
            { nome: 'Carlos Alberto Rodrigues', dia: 1, mes: 12 },
            { nome: 'Humberto Xavier', dia: 6, mes: 3 },
            { nome: 'Wallerson Oliveira', dia: 8, mes: 10 },
            { nome: 'Carlos Alberto Assunção', dia: 11, mes: 5 },
            { nome: 'Marcos Vinicius', dia: 13, mes: 11 },
            { nome: 'Augusto Carlos', dia: 3, mes: 9 },
            { nome: 'José Luiz Barbosa', dia: 5, mes: 1 },
            { nome: 'Sérgio Antônio Miguel', dia: 1, mes: 8 },
            { nome: 'Samuel Piske', dia: 11, mes: 3 }
        ];

        for (let a of aniversariosBase) {
            await pool.query(
                'INSERT INTO aniversarios (nome, dia, mes) VALUES ($1, $2, $3) ON CONFLICT (nome) DO NOTHING', 
                [a.nome, a.dia, a.mes]
            );
        }

        console.log("✅ Conexão com o Banco de Dados estabelecida.");
    } catch (err) {
        console.error("❌ Erro ao configurar o banco:", err);
    }
}

setupDatabase();

// --- ROTAS DE USUÁRIOS E LOGIN ---
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;
    try {
        const result = await pool.query('SELECT id, nome_usuario as user, perfil, equipe FROM usuarios WHERE nome_usuario = $1 AND senha = $2', [usuario, senha]);
        if (result.rows.length > 0) res.json({ sucesso: true, usuario: result.rows[0] });
        else res.status(401).json({ sucesso: false, mensagem: "Credenciais inválidas." });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.post('/api/usuarios', async (req, res) => {
    const { user, senha, perfil, equipe } = req.body;
    try {
        await pool.query('INSERT INTO usuarios (nome_usuario, senha, perfil, equipe) VALUES ($1, $2, $3, $4)', [user, senha, perfil, equipe]);
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(400).json({ sucesso: false }); }
});

app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nome_usuario as user, perfil, equipe FROM usuarios ORDER BY nome_usuario ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- ROTAS DE ANIVERSÁRIOS ---
app.post('/api/aniversarios', async (req, res) => {
    const { nome, dia, mes } = req.body;
    try {
        await pool.query('INSERT INTO aniversarios (nome, dia, mes) VALUES ($1, $2, $3)', [nome, dia, mes]);
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.get('/api/aniversarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM aniversarios ORDER BY mes ASC, dia ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ erro: err.message }); }
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
        await pool.query('INSERT INTO escalas (mes_ano, dados_json) VALUES ($1, $2) ON CONFLICT (mes_ano) DO UPDATE SET dados_json = EXCLUDED.dados_json', [mesAno, JSON.stringify(dados)]);
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
    const { titulo, categoria, prioridade, requerente, descricao, progresso } = req.body;
    try {
        await pool.query('INSERT INTO chamados (titulo, categoria, prioridade, requerente, descricao, progresso) VALUES ($1, $2, $3, $4, $5, $6)', [titulo, categoria, prioridade, requerente, descricao, progresso]);
        res.status(201).json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

app.put('/api/chamados/:id', async (req, res) => {
    const { id } = req.params;
    const { status, atribuido, progresso } = req.body;
    try {
        await pool.query(
            'UPDATE chamados SET status = $1, atribuido = $2, progresso = $3 WHERE id = $4',
            [status, atribuido, progresso, id]
        );
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false, erro: err.message }); }
});

// --- MOTOR DE NOTIFICAÇÕES PUSH ---
app.post('/api/push-token', async (req, res) => {
    const { usuario, token } = req.body;
    try {
        await pool.query('INSERT INTO push_tokens (usuario, token) VALUES ($1, $2) ON CONFLICT (token) DO NOTHING', [usuario, token]);
        res.json({ sucesso: true });
    } catch (err) { res.status(500).json({ sucesso: false }); }
});

async function dispararNotificacaoPush(titulo, corpo) {
    if (!process.env.FIREBASE_PROJECT_ID) return;
    try {
        const resTokens = await pool.query('SELECT token FROM push_tokens');
        const tokens = resTokens.rows.map(t => t.token);
        
        if (tokens.length > 0) {
            const mensagem = {
                notification: { title: titulo, body: corpo },
                tokens: tokens
            };
            await admin.messaging().sendEachForMulticast(mensagem);
            console.log(`Push enviado: ${titulo}`);
        }
    } catch (error) { console.error("Erro no push:", error); }
}

app.post('/api/notificar', async (req, res) => {
    const { titulo, mensagem } = req.body;
    await dispararNotificacaoPush(titulo, mensagem);
    res.json({ sucesso: true });
});

// --- ROBÔ AUTOMÁTICO (CRON) - Todo dia às 07:00 da Manhã (Horário do Brasil) ---
cron.schedule('0 7 * * *', async () => {
    console.log("🤖 Iniciando Robô Matinal do CSC Live...");
    try {
        const hj = new Date();
        // Garantindo que estamos lendo o dia no fuso brasileiro também
        const dia = hj.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric" });
        const mes = hj.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", month: "numeric" });
        const ano = hj.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });
        const mesAno = `${ano}-${mes.toString().padStart(2, '0')}`;
        const diaInt = parseInt(dia);

        // 1. Checar Aniversários
        const resNiver = await pool.query('SELECT nome FROM aniversarios WHERE dia = $1 AND mes = $2', [diaInt, parseInt(mes)]);
        if (resNiver.rows.length > 0) {
            for (let n of resNiver.rows) {
                await dispararNotificacaoPush("🎉 Aniversário Hoje!", `Hoje é aniversário de ${n.nome}. Deseje os parabéns!`);
            }
        }

        // 2. Checar Próxima Escala (A inteligência do "Chato")
        const resEscala = await pool.query('SELECT dados_json FROM escalas WHERE mes_ano = $1', [mesAno]);
        if (resEscala.rows.length > 0) {
            const dados = JSON.parse(resEscala.rows[0].dados_json);
            let proximoEvento = null;
            
            // Ordena a escala pelo dia para não pular nenhum
            const linhasOrdenadas = dados.linhas.sort((a, b) => parseInt(a.dia) - parseInt(b.dia));
            
            // Procura o primeiro evento que seja hoje ou nos dias seguintes
            for (let linha of linhasOrdenadas) {
                if (parseInt(linha.dia) >= diaInt && linha.membros !== "-") {
                    proximoEvento = linha;
                    break;
                }
            }
            
            if (proximoEvento) {
                const equipeNome = proximoEvento.equipe === 'MISTA' ? 'Mista' : proximoEvento.equipe;
                if (parseInt(proximoEvento.dia) === diaInt) {
                    await dispararNotificacaoPush(
                        "📅 É HOJE! Escala do CSC", 
                        `Hoje temos o evento: ${proximoEvento.evento}. A Equipe responsável é a ${equipeNome}. Preparem-se!`
                    );
                } else {
                    await dispararNotificacaoPush(
                        "📅 Lembrete de Escala", 
                        `Atenção: O próximo evento será dia ${proximoEvento.dia} (${proximoEvento.evento}). A Equipe escalada é a ${equipeNome}.`
                    );
                }
            }
        }
    } catch (error) { console.error("Erro no robô matinal:", error); }
}, {
    timezone: "America/Sao_Paulo" // Força o fuso horário oficial do Brasil!
});

// --- ROTAS DO FRONTEND ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/escalas', (req, res) => res.sendFile(path.join(__dirname, 'views', 'escalas.html')));
app.get('/chamados', (req, res) => res.sendFile(path.join(__dirname, 'views', 'chamados.html')));
app.get('/abrir-chamado', (req, res) => res.sendFile(path.join(__dirname, 'views', 'abrir_chamado.html')));
app.get('/solicitar-arte', (req, res) => res.sendFile(path.join(__dirname, 'views', 'solicitar_arte.html')));

app.listen(PORT, () => console.log(`🚀 Sistema operando na porta ${PORT}`));
