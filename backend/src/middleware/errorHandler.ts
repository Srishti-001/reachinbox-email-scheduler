import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status: number = err.status ?? err.statusCode ?? 500;
  const message: string = err.message ?? 'Internal server error';

  if (status >= 500) {
    console.error('[ERROR]', err);
  }

  res.status(status).json({
    success: false,
    error: message,
  });
}
