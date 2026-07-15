import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resContent: any = exception.getResponse();
      if (typeof resContent === 'object' && resContent !== null) {
        message = resContent.message || exception.message;
        error = resContent.error || exception.name;
      } else {
        message = exception.message;
      }
    } else if (
      exception &&
      typeof exception === 'object' &&
      exception.constructor &&
      (exception.constructor.name === 'PrismaClientKnownRequestError' || 
       exception.code !== undefined)
    ) {
      // Prisma Client Error handling without rigid type imports to prevent bundling errors
      const code = (exception as any).code;
      const meta = (exception as any).meta;
      
      if (code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'A record with this unique attribute already exists.';
        error = 'Conflict';
      } else if (code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = meta?.cause || 'Record not found.';
        error = 'Not Found';
      } else if (code === 'P2034') {
        status = HttpStatus.CONFLICT;
        message = 'This slot has just been booked. Please choose another time.';
        error = 'Conflict';
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = (exception as any).message || 'Database error occurred';
        error = 'Bad Request';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      error,
    });
  }
}
