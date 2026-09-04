import {
  IsNotEmpty,
  IsUUID,
  IsString,
  IsObject,
  IsIn,
  IsOptional,
} from 'class-validator';

export class WebrtcRespondWsDto {
  @IsNotEmpty({ message: 'Session ID is required' })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId: string;

  @IsNotEmpty({ message: 'Action is required' })
  @IsIn(['ACCEPT', 'DECLINE'], { message: 'Action must be ACCEPT or DECLINE' })
  action: 'ACCEPT' | 'DECLINE';
}

export class WebrtcOfferWsDto {
  @IsNotEmpty({ message: 'Session ID is required' })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId: string;

  @IsNotEmpty({ message: 'SDP string is required' })
  @IsString()
  sdp: string;
}

export class WebrtcAnswerWsDto {
  @IsNotEmpty({ message: 'Session ID is required' })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId: string;

  @IsNotEmpty({ message: 'SDP string is required' })
  @IsString()
  sdp: string;
}

export class WebrtcIceCandidateWsDto {
  @IsNotEmpty({ message: 'Session ID is required' })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId: string;

  @IsNotEmpty({ message: 'Candidate object is required' })
  @IsObject()
  candidate: Record<string, any>;
}

export class WebrtcHangupWsDto {
  @IsNotEmpty({ message: 'Session ID is required' })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
