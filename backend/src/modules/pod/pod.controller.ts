import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  ParseUUIDPipe,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FileStorageService } from './services/file-storage.service';
import { PodService } from './services/pod.service';
import { SubmitPodDto } from './dto/submit-pod.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PodController {
  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly podService: PodService,
  ) {}

  @Post('files/upload')
  @Roles('DRIVER', 'ADMIN', 'SUPER_ADMIN', 'OWNER')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  async uploadFile(
    @CurrentUser() user: any,
    @UploadedFile() file: any,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'File payload is required',
      });
    }

    const fileRecord = await this.fileStorageService.saveFileRecord(
      file.buffer,
      file.originalname || 'upload.jpg',
      file.mimetype || 'image/jpeg',
      user.id,
      'photo',
    );

    return {
      fileId: fileRecord.id,
      objectKey: fileRecord.objectKey,
      mediaType: fileRecord.mediaType,
      sizeBytes: fileRecord.sizeBytes,
    };
  }

  @Get('files/:id/download')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async downloadFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) fileId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const fileResult = await this.fileStorageService.getAuthorizedFileBuffer(
      fileId,
      user.id,
      user.role,
    );

    res.setHeader('Content-Type', fileResult.mediaType);
    res.setHeader('Content-Disposition', `inline; filename="${fileResult.filename}"`);
    res.send(fileResult.buffer);
  }

  @Post('me/stops/:id/pod')
  @Roles('DRIVER')
  async submitPod(
    @Param('id', new ParseUUIDPipe({ version: '4' })) stopId: string,
    @Body() dto: SubmitPodDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!user.driverId) {
      throw new ForbiddenException({ code: 'DRIVER_PROFILE_REQUIRED', message: 'Driver profile required' });
    }

    const result = await this.podService.submitPod(
      stopId,
      dto,
      { userId: user.id, role: user.role, driverId: user.driverId },
      '/v1/me/stops/:id/pod',
    );

    if (result.idempotent || result.alreadySubmitted) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.CREATED);
    }

    return result;
  }

  @Get('deliveries/:id/pod')
  @Roles('ADMIN', 'SUPER_ADMIN', 'OWNER', 'DRIVER')
  async getPodForDelivery(
    @Param('id', new ParseUUIDPipe({ version: '4' })) deliveryId: string,
    @CurrentUser() user: any,
  ) {
    return this.podService.getPodForDelivery(deliveryId, {
      userId: user.id,
      role: user.role,
      driverId: user.driverId || null,
    });
  }
}
