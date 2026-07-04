export const errorHandler = (error, req, res, _next) => {
  const status = Number(error?.status ?? error?.statusCode ?? 500);
  const safeStatus = Number.isFinite(status) && status >= 400 && status < 600 ? status : 500;
  console.error('[copetin-api]', {
    requestId: req?.context?.requestId,
    endpoint: `${req?.method ?? ''} ${req?.path ?? ''}`.trim(),
    status: safeStatus,
    errorCode: error?.code ?? error?.name ?? 'Error',
    durationMs: req?.context?.startedAt ? Date.now() - req.context.startedAt : null,
  });
  res.status(safeStatus).json({
    error: safeStatus >= 500 ? 'Error interno del servidor.' : error?.message ?? 'Solicitud invalida.',
    requestId: req?.context?.requestId,
  });
};
