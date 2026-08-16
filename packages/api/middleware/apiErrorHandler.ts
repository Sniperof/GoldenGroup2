import type { ErrorRequestHandler } from 'express';

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (!req.originalUrl.startsWith('/api/')) {
    next(error);
    return;
  }

  console.error('Unhandled API error', {
    method: req.method,
    path: req.originalUrl,
    error,
  });

  const reportedStatus = (error as { status?: unknown })?.status;
  const status = typeof reportedStatus === 'number' && reportedStatus >= 400 && reportedStatus < 500
    ? reportedStatus
    : 500;
  const message = status === 500 ? 'حدث خطأ داخلي في الخادم' : 'تعذر معالجة الطلب';
  res.status(status).json({ error: message });
};
