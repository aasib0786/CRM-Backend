require('dotenv').config();

module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'IMSDATABASE_TEST',
      user: process.env.DB_USER || 'postgres',
      password: String(process.env.DB_PASSWORD || '1234'),  // force string
    },
    migrations: {
      directory: './migrations',
      extension: 'cjs'
    }
  }
};