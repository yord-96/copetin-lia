import crypto from 'node:crypto';

export const requestContext = (req, res, next) => {
  req.context = {
    requestId: req.get('X-Request-Id') || crypto.randomUUID(),
    startedAt: Date.now(),
    user: null,
    company: null,
  };
  res.setHeader('X-Request-Id', req.context.requestId);
  next();
};
