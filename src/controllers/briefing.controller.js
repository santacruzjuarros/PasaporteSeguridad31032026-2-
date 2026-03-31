// src/controllers/briefing.controller.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken'); // Para encriptaciones del QR
const crypto = require('crypto');

/**
 * @route POST /api/briefing/start
 * @description Supervisor genera una nueva sesión Briefing (Herramienta E+C).
 * Devuelve un Payload QR único asimétrico que expirará en 2h.
 */
exports.startBriefing = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { fichaId } = req.body;

    // Verificar Rol
    if (req.user.rol !== 'SUPERVISOR') {
      return res.status(403).json({ error: "Permiso denegado. Se requiere Rol Supervisor." });
    }

    // Hash Inmutable para QR (Protección contra clonado fotográfico de QRs pasados)
    const rawQrToken = `${supervisorId}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const encToken = jwt.sign({ token: rawQrToken }, process.env.JWT_SECRET, { expiresIn: '2h' });

    // Instanciar en Base de Datos PostgreSQL
    const briefing = await prisma.preJobBriefing.create({
      data: {
        supervisor_id: supervisorId,
        ficha_id: fichaId,
        qr_token: encToken,
        activo: true
      }
    });

    res.status(201).json({ 
      message: "Briefing Code Creado", 
      qrPayload: encToken, // El Frontend React Native renderizará esto
      briefingData: briefing 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error Generate Briefing" });
  }
};

/**
 * @route POST /api/briefing/scan
 * @description Operador escanea el QR en su app React Native y consume este Endpoint.
 * Valida la firma (JWT), la expiración y registra la asistencia oficial. Suma puntos.
 */
exports.scanBriefing = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scannedToken } = req.body;

    if (!scannedToken) return res.status(400).json({ error: "No Token provided" });

    // 1. Validar expiración y procedencia Cryptográfica JWT
    let decoded;
    try {
      decoded = jwt.verify(scannedToken, process.env.JWT_SECRET);
    } catch (e) {
       return res.status(401).json({ error: "QR Inválido o Caducado. Solicita uno nuevo al supervisor." });
    }

    // 2. Transacción de Base de Datos para asegurar concurrencia e Integridad
    await prisma.$transaction(async (tx) => {
      // Buscar briefing activo
      const briefing = await tx.preJobBriefing.findUnique({
        where: { qr_token: scannedToken }
      });

      if (!briefing) throw new Error("BRIEFING_NOT_FOUND");
      if (!briefing.activo) throw new Error("BRIEFING_CLOSED");

      // 3. Registrar al operario (constraint @@unique prevendrá duplicados si intenta re-escanear)
      await tx.briefingAttendee.create({
        data: {
          briefing_id: briefing.id,
          worker_id: workerId
        }
      });

      // 4. Premiar participación de Cultura de Seguridad en campo (+10pts)
      await tx.user.update({
        where: { id: workerId },
        data: { puntos_totales: { increment: 10 } }
      });
    });

    res.status(200).json({ 
      success: true, 
      puntosGanados: 10,
      message: "Participación en Pre-job Briefing oficializada." 
    });

  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: "Ya habías registrado asistencia a esta jornada."})
    if (err.message === "BRIEFING_NOT_FOUND" || err.message === "BRIEFING_CLOSED") {
      return res.status(404).json({ error: "Ese pase de Briefing ya ha sido cerrado o descartado." });
    }
    console.error("Scan Err:", err);
    res.status(500).json({ error: "Error Server Procesando Escaneo" });
  }
};
