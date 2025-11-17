"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
const promise_1 = __importDefault(require("mysql2/promise"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'smshagor_code_editor',
    password: process.env.DB_PASSWORD || 'SmShagor1@1',
    database: process.env.DB_NAME || 'smshagor_code_editor',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};
const pool = promise_1.default.createPool(dbConfig);
async function query(sql, params = []) {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    }
    catch (error) {
        console.error('Database error:', error);
        throw error;
    }
}
exports.default = pool;
