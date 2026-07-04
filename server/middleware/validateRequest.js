export const validateRequest = (schema) => (req, _res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });
  if (!result.success) {
    const error = new Error('Datos de solicitud invalidos.');
    error.status = 422;
    error.details = result.error.flatten();
    next(error);
    return;
  }
  req.validated = result.data;
  next();
};
