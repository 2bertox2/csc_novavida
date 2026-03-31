const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function setupDatabase() {
    const db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    // Criando a tabela de Chamados (Foco no visual do GLPI)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS chamados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT,
            categoria TEXT,
            prioridade TEXT,
            status TEXT DEFAULT 'Pendente',
            requerente TEXT,
            atribuido TEXT DEFAULT '-',
            descricao TEXT,
            data_abertura DATETIME DEFAULT CURRENT_TIMESTAMP,
            progresso INTEGER DEFAULT 100
        )
    `);

    // Criando a tabela de Equipes (A a G)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS equipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sigla TEXT UNIQUE,
            lider TEXT,
            membros TEXT
        )
    `);

    console.log("✅ BANCO DE DADOS PRONTO PARA O GLPI LIVE!");
    return db;
}

module.exports = setupDatabase;