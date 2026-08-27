import { Router } from 'express';
import { getLincolnAgendaMonth, getLincolnAgendaYear } from '../services/lincoln/lincolnAgendaService.js';
import { getLincolnSettlementDetail, getLincolnSettlements } from '../services/lincoln/lincolnSettlementService.js';
import { getLincolnAnnualReport, getLincolnEventReport, getLincolnMonthlyReport } from '../services/lincoln/lincolnReportService.js';
import { getLincolnCommercialOverview } from '../services/lincoln/lincolnCommercialService.js';
import { getLincolnClientsOverview } from '../services/lincoln/lincolnClientsService.js';
import { getLincolnRoomsOverview } from '../services/lincoln/lincolnRoomsService.js';
import { getLincolnPackagesOverview } from '../services/lincoln/lincolnPackagesService.js';
import { buildLincolnContractDocumentHtml, buildLincolnContractPdfFileName } from '../services/lincoln/lincolnContractDocumentService.js';
import {
  LINCOLN_RESET_CODE,
  LINCOLN_RESET_MODULES,
  analyzeLincolnReset,
  applyLincolnReset,
  assertLincolnAdminAccess,
  buildLincolnDatabaseBackup,
} from '../services/lincoln/lincolnAdminService.js';
import { renderHtmlDocumentToPdf } from '../storage/documentPdfRenderer.js';
import {
  convertLincolnReservationToEvent,
  createLincolnExpense,
  createLincolnRecord,
  getLincolnStateSnapshot,
  registerLincolnEventPayment,
  replaceLincolnStateSnapshot,
  returnLincolnGuarantee,
  setLincolnSettlementStatus,
  updateLincolnExpense,
  updateLincolnRecord,
  voidLincolnPayment,
} from '../storage/lincolnStateStore.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const lincolnResetSecurityCode = String(process.env.LINCOLN_RESET_SECURITY_CODE ?? LINCOLN_RESET_CODE).trim() || LINCOLN_RESET_CODE;

router.use('/__lincoln_db', (req, res, next) => {
  if (!internalKey) {
    next();
    return;
  }
  const providedKey = String(req.get('X-App-Internal-Key') ?? '').trim();
  if (!providedKey) {
    res.status(401).json({ error: 'Clave interna requerida.' });
    return;
  }
  if (providedKey !== internalKey) {
    res.status(403).json({ error: 'Clave interna invalida.' });
    return;
  }
  next();
});

const actorFromRequest = (req) => ({
  id: String(req.body?.actor?.id ?? req.get('X-User-Id') ?? '').trim() || null,
  name: String(req.body?.actor?.name ?? req.get('X-User-Name') ?? '').trim() || null,
  role: String(req.body?.actor?.role ?? req.get('X-User-Role') ?? '').trim() || null,
});

const handleLincolnMutationError = (error, res, next) => {
  if (error?.statusCode === 409) {
    res.status(409).json({
      error: error.message,
      code: error.code,
      currentRevision: error.currentRevision ?? null,
    });
    return;
  }
  if ([400, 403, 404].includes(error?.statusCode)) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  next(error);
};

const requireLincolnAdmin = (req) => {
  const actor = actorFromRequest(req);
  assertLincolnAdminAccess({ code: req.body?.code, actor, expectedCode: lincolnResetSecurityCode });
  return actor;
};

router.post('/__lincoln_db/admin/reset/verify', async (req, res, next) => {
  try {
    requireLincolnAdmin(req);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, company: 'lincoln', modules: LINCOLN_RESET_MODULES.map(({ collections: _collections, ...module }) => module) });
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.post('/__lincoln_db/admin/reset/analyze', async (req, res, next) => {
  try {
    requireLincolnAdmin(req);
    const snapshot = await getLincolnStateSnapshot();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(analyzeLincolnReset(snapshot.state, req.body?.modules));
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.post('/__lincoln_db/admin/reset/execute', async (req, res, next) => {
  try {
    const actor = requireLincolnAdmin(req);
    const confirmation = String(req.body?.confirmation ?? '').trim().toUpperCase();
    const requiresFactoryWord = Array.isArray(req.body?.modules) && req.body.modules.includes('factory_reset');
    if ((requiresFactoryWord && confirmation !== 'RESET') || (!requiresFactoryWord && !['CONFIRMAR', 'RESET'].includes(confirmation))) {
      const error = new Error(requiresFactoryWord ? 'Escribe RESET para confirmar.' : 'Escribe CONFIRMAR o RESET para confirmar.');
      error.statusCode = 400;
      error.code = 'LINCOLN_RESET_CONFIRMATION_INVALID';
      throw error;
    }
    const snapshot = await getLincolnStateSnapshot();
    const result = applyLincolnReset({
      state: snapshot.state,
      moduleIds: req.body?.modules,
      actor,
      observations: req.body?.observations,
    });
    const saved = await replaceLincolnStateSnapshot(result.nextState, req.body?.revision ?? snapshot.revision);
    res.json({ ok: true, ...saved, analysis: result.analysis, deletedTotal: result.deletedTotal, log: result.log });
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.post('/__lincoln_db/admin/database/export', async (req, res, next) => {
  try {
    const actor = requireLincolnAdmin(req);
    const snapshot = await getLincolnStateSnapshot();
    const backup = buildLincolnDatabaseBackup({ snapshot, actor });
    const stamp = backup.exportedAt.replace(/[:.]/g, '-');
    const body = JSON.stringify(backup, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lincoln-base-datos-${stamp}.json"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Lincoln-Revision', String(snapshot.revision ?? ''));
    res.send(body);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.get('/__lincoln_db/commercial', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnCommercialOverview({
      query: req.query.query,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
    }));
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});


router.get('/__lincoln_db/packages/overview', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnPackagesOverview({
      query: req.query.query,
      status: req.query.status,
      roomId: req.query.roomId,
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/__lincoln_db/rooms/overview', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnRoomsOverview({ query: req.query.query, status: req.query.status }));
  } catch (error) {
    next(error);
  }
});

router.get('/__lincoln_db/clients/overview', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnClientsOverview({
      query: req.query.query,
      status: req.query.status,
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/__lincoln_db/agenda/month', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnAgendaMonth({ year: req.query.year, month: req.query.month }));
  } catch (error) {
    if (error?.statusCode === 400) {
      res.status(400).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  }
});

router.get('/__lincoln_db/agenda/year', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnAgendaYear({ year: req.query.year }));
  } catch (error) {
    if (error?.statusCode === 400) {
      res.status(400).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  }
});


router.get('/__lincoln_db/settlements', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnSettlements({ year: req.query.year, status: req.query.status, query: req.query.query }));
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.get('/__lincoln_db/settlements/:eventId', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnSettlementDetail({ eventId: req.params.eventId }));
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.get('/__lincoln_db/reports/monthly', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnMonthlyReport({ year: req.query.year, month: req.query.month }));
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.get('/__lincoln_db/reports/annual', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnAnnualReport({ year: req.query.year }));
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.get('/__lincoln_db/reports/events/:eventId', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnEventReport({ eventId: req.params.eventId }));
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});


router.get('/__lincoln_db/contracts/:id/pdf', async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato Lincoln.' });
      return;
    }
    const snapshot = await getLincolnStateSnapshot();
    const event = (snapshot?.state?.events ?? []).find((row) => (
      String(row?.id ?? '') === requestedId
      || String(row?.contractCode ?? '') === requestedId
      || String(row?.code ?? '') === requestedId
    ));
    if (!event) {
      res.status(404).json({ error: 'Contrato Lincoln no encontrado.' });
      return;
    }
    const html = buildLincolnContractDocumentHtml({ event });
    const result = await renderHtmlDocumentToPdf({
      html,
      baseUrl: `${req.protocol}://${req.get('host')}`,
      fileName: buildLincolnContractPdfFileName(event),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('X-Document-Cache', result.cacheHit ? 'HIT' : 'MISS');
    res.setHeader('X-Document-Key', result.cacheKey);
    res.setHeader('X-Document-Duration-Ms', String(Date.now() - startedAt));
    res.send(result.buffer);
  } catch (error) {
    next(error);
  }
});

router.get('/__lincoln_db', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnStateSnapshot());
  } catch (error) {
    next(error);
  }
});

router.put('/__lincoln_db', async (req, res, next) => {
  try {
    if (!req.body?.state || typeof req.body.state !== 'object' || Array.isArray(req.body.state)) {
      res.status(400).json({ error: 'Debes enviar un estado valido para Lincoln.' });
      return;
    }
    res.json(await replaceLincolnStateSnapshot(req.body.state, req.body.revision));
  } catch (error) {
    if (error?.statusCode === 409) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  }
});


router.post('/__lincoln_db/:collection', async (req, res, next) => {
  try {
    const result = await createLincolnRecord(
      req.params.collection,
      req.body?.record,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.status(201).json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.put('/__lincoln_db/:collection/:id', async (req, res, next) => {
  try {
    const result = await updateLincolnRecord(
      req.params.collection,
      req.params.id,
      req.body?.record,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.post('/__lincoln_db/reservations/:id/convert', async (req, res, next) => {
  try {
    const result = await convertLincolnReservationToEvent(
      req.params.id,
      req.body?.event,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});


router.post('/__lincoln_db/events/:id/payments', async (req, res, next) => {
  try {
    const result = await registerLincolnEventPayment(
      req.params.id,
      req.body?.payment,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.status(201).json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.post('/__lincoln_db/payments/:id/void', async (req, res, next) => {
  try {
    const result = await voidLincolnPayment(
      req.params.id,
      req.body,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.post('/__lincoln_db/events/:id/guarantee-return', async (req, res, next) => {
  try {
    const result = await returnLincolnGuarantee(
      req.params.id,
      req.body?.refund,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.status(201).json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});


router.put('/__lincoln_db/settlements/:eventId/status', async (req, res, next) => {
  try {
    const result = await setLincolnSettlementStatus(
      req.params.eventId,
      req.body?.settlement,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.post('/__lincoln_db/cash/expenses', async (req, res, next) => {
  try {
    const result = await createLincolnExpense(
      req.body?.expense,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.status(201).json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

router.put('/__lincoln_db/cash/expenses/:id', async (req, res, next) => {
  try {
    const result = await updateLincolnExpense(
      req.params.id,
      req.body?.expense,
      req.body?.revision,
      actorFromRequest(req),
    );
    res.json(result);
  } catch (error) {
    handleLincolnMutationError(error, res, next);
  }
});

export default router;
