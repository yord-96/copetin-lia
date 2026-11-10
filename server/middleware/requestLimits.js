import rateLimit from 'express-rate-limit';

const pathOf = req => String(req.originalUrl ?? req.url ?? '').split('?')[0];
export const isAttendanceRequest = req => /^\/__copetin_db\/attendance(?:\/|$)/.test(pathOf(req))
  || pathOf(req) === '/api/uploads/attendance';
export const isLoginUsersRequest = req => req.method === 'GET' && pathOf(req) === '/__copetin_db/collections'
  && String(req.query?.names ?? '').split(',').map(name => name.trim()).filter(Boolean).every(name => name === 'users')
  && String(req.query?.names ?? '').includes('users');

// Separate budgets for shared Wi-Fi: inventory/report polling cannot consume
// the requests needed to log in, mark attendance or upload its evidence.
export function createRequestLimiters({ isProduction = false, env = process.env } = {}) {
  const common = { standardHeaders: true, legacyHeaders: false };
  return {
    general: rateLimit({ ...common, windowMs: 15 * 60 * 1000,
      max: Number(env.GENERAL_RATE_LIMIT_MAX ?? (isProduction ? 6000 : 12000)),
      skip: req => pathOf(req).startsWith('/__copetin_db') || isAttendanceRequest(req),
    }),
    presence: rateLimit({ ...common, windowMs: 60000,
      max: Number(env.PRESENCE_RATE_LIMIT_MAX ?? (isProduction ? 3000 : 6000)),
      message: { error: 'Demasiadas actualizaciones de sesiones activas. Intenta nuevamente en un momento.' },
    }),
    state: rateLimit({ ...common, windowMs: 60000,
      max: Number(env.STATE_RATE_LIMIT_MAX ?? (isProduction ? 6000 : 12000)),
      skip: req => pathOf(req).startsWith('/__copetin_db/presence') || isAttendanceRequest(req) || isLoginUsersRequest(req),
      message: { error: 'Demasiadas solicitudes al estado del sistema. Intenta nuevamente en un momento.' },
    }),
    attendance: rateLimit({ ...common, windowMs: 60000,
      max: Number(env.ATTENDANCE_RATE_LIMIT_MAX ?? 1200), skip: req => !isAttendanceRequest(req),
      message: { error: 'Demasiadas solicitudes de asistencia. Espera un momento y reintenta la misma marca.' },
    }),
    access: rateLimit({ ...common, windowMs: 60000,
      max: Number(env.ACCESS_RATE_LIMIT_MAX ?? 600), skip: req => !isLoginUsersRequest(req),
      message: { error: 'Demasiadas consultas de acceso. Espera un momento e intenta ingresar nuevamente.' },
    }),
  };
}
