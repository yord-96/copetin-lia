export const requireAuth = (req, _res, next) => {
  if (!req.context?.user) {
    const error = new Error('Sesion requerida.');
    error.status = 401;
    next(error);
    return;
  }
  next();
};

export const requireCompanyAccess = (req, _res, next) => {
  if (!req.context?.company) {
    const error = new Error('Empresa activa requerida.');
    error.status = 403;
    next(error);
    return;
  }
  next();
};

export const requirePermission = (permission) => (req, _res, next) => {
  const permissions = new Set(req.context?.permissions ?? []);
  if (!permissions.has(permission)) {
    const error = new Error('Permiso insuficiente.');
    error.status = 403;
    next(error);
    return;
  }
  next();
};
