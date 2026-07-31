import type { ErrorHandler } from 'hono';
import { isAppError } from './AppError';

export const appErrorHandler: ErrorHandler = (error, c) => {
  if (isAppError(error)) {
    return c.json(error.toJSON(), toHonoStatusCode(error.status));
  }

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    },
    500,
  );
};

function toHonoStatusCode(status: number): 400 | 404 | 409 | 500 {
  switch (status) {
    case 400:
    case 404:
    case 409:
    case 500:
      return status;
    default:
      return 500;
  }
}
