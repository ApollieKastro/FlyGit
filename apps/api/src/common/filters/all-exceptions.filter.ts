import type {
  ArgumentsHost,
  ExceptionFilter} from '@nestjs/common';
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@flygit/shared';
import { ZodError } from 'zod';

/** Converts any thrown value into a stable `ApiError` payload. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let payload: ApiError;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        payload = {
          statusCode: status,
          error: (obj.error as string) ?? HttpStatus[status] ?? 'Error',
          message: (obj.message as string | string[]) ?? exception.message,
          code: obj.code as string | undefined,
          details: obj.details as Record<string, string[]> | undefined,
        };
      } else {
        payload = { statusCode: status, error: HttpStatus[status] ?? 'Error', message: String(body) };
      }
    } else if (exception instanceof ZodError) {
      const details: Record<string, string[]> = {};
      for (const issue of exception.issues) {
        const key = issue.path.length ? issue.path.join('.') : '_';
        (details[key] ??= []).push(issue.message);
      }
      payload = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details,
      };
    } else {
      const message = exception instanceof Error ? exception.message : 'Internal server error';
      if (!(exception instanceof HttpException)) {
        this.logger.error(
          `Unhandled exception on ${request.method} ${request.url}: ${message}`,
          exception instanceof Error ? exception.stack : undefined,
        );
      }
      payload = {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      };
    }

    response.status(payload.statusCode).json(payload);
  }
}
