import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { dbConnect } from './db/config.js';

import medicoRouter from './routes/medico.routes.js';
import "./libs/initialSetup.js";

const server = express();

// Variables de entorno
dotenv.config();

// Middleware
server.use(cors());
server.use(express.json());
server.use(express.urlencoded({ extended: false }));

// Inicializar base de datos
dbConnect();

// Rutas
server.use('/api/medico', medicoRouter);


// Puerto del servidor
const PORT = process.env.PORT || 3000;

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
