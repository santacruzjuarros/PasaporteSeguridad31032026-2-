// src/controllers/kudos.controller.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const notificationService = require('../services/push.service');

/**
 * @route GET /api/users/search?q={query}
 * @description Búsqueda predictiva (Debouncing en frontend) de empleados por Nombre, Apellido o Empresa. 
 */
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.status(400).json({ error: "Search query required (min 2 chars)" });

    // Uso de ILIKE implícito en constains - caseInsensitive para Postgres en Prisma
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { apellidos: { contains: q, mode: 'insensitive' } },
          { empresa: { contains: q, mode: 'insensitive' } }
        ],
        // Prevenir auto-kudos
        NOT: { id: req.user.id }
      },
      select: { id: true, nombre: true, apellidos: true, foto_perfil: true, empresa: true },
      take: 10
    });

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error during search" });
  }
};

/**
 * @route POST /api/kudos
 * @description Registra un nuevo Kudo, añade +20 puntos a emisor y receptor (Transaction) y notifica vía Push
 */
exports.sendKudo = async (req, res) => {
  try {
    const { targetId, expectativa, mensaje } = req.body;
    const senderId = req.user.id;

    if (targetId === senderId) return res.status(400).json({ error: "No puedes enviarte un Kudo a ti mismo." });

    // Prisma Transaction // Asegura que se guarde el log y se sumen puntos atómicamente a ambos usuarios
    const result = await prisma.$transaction(async (tx) => {
      
      // 1. Guardar Log Histórico
      const kudo = await tx.kudosLog.create({
        data: {
          emisor_id: senderId,
          receptor_id: targetId,
          expectativa_cumplida: expectativa,
          mensaje: mensaje
        }
      });

      // 2. Sumar puntos al Emisor (Gamificación Activa)
      await tx.user.update({
        where: { id: senderId },
        data: { puntos_totales: { increment: 20 } }
      });

      // 3. Sumar puntos al Receptor (Refuerzo Positivo)
      const receiver = await tx.user.update({
        where: { id: targetId },
        data: { puntos_totales: { increment: 20 } }
      });

      return { kudo, receiver };
    });

    // 4. Integrar Notificación Push asíncrona (DevSecOps - Evita bloquear response)
    notificationService.sendPushToDevice(result.receiver.id, {
      title: "¡Nuevo Kudos recibido!",
      body: `Has recibido un reconocimiento por: ${expectativa}`,
      icon: "stars"
    });

    res.status(201).json({ message: "Kudo emitido correctamente. +20 Puntos.", kudo: result.kudo });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transaction Failed. Rolled back." });
  }
};
