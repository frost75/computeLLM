import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGatewayMiddleware } from '@barry.jiang/dingtalk-aiapp-infra';
import { need_login } from './_core/auth.js';
import contactsRoutes from './official-apis/contactsRoutes.js';
import {createTokenInjectionMiddleware} from "./_core/tokenInjection.js";
import deptRoutes from './official-apis/deptRoutes.js';
import storageRoutes from './official-apis/storageRoutes.js';
import refundCalculationRoutes from './routes/refundCalculationRoutes.js';
import caseRoutes from './routes/caseRoutes.js';
// Import more routes here
// import bookRoutes from './routes/bookRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(cookieParser());

// Storage upload route must be registered BEFORE express.json() and createGatewayMiddleware(),
// because body-parsing middleware consumes the request stream, which breaks multer's
// multipart/form-data parsing (causes "Unexpected end of form" error).
app.use('/api/storage', need_login, storageRoutes);

app.use(express.json({ limit:'35mb', type: ['application/json', 'text/plain'] }));
app.use(createGatewayMiddleware());

// Token injection must run BEFORE express.static,
// otherwise static middleware serves index.html directly and skips injection.
app.use(createTokenInjectionMiddleware());

app.use(express.static(path.join(__dirname, '..')));

app.use('/api', need_login);

// 健康检查接口（免登）
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/contacts', contactsRoutes);
app.use('/api/depts', deptRoutes);
app.use('/api/refund-calculations', refundCalculationRoutes);
app.use('/api/cases',caseRoutes);

// app.use('/api/books', bookRoutes);

// default route (don't modify)
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, '..') });
});


app.listen(9000, () => {
  console.log('Server running on http://localhost:9000');
});
