import {
  IsNotEmpty,
  IsUUID,
  IsString,
  IsObject,
  IsIn,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';

export class WebrtcSignalingBaseDto {
  @IsNotEmpty({ message: 'Session ID is required' })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId: string;

  @IsNotEmpty({ message: 'Nonce is required' })
  @IsUUID('4', { message: 'Nonce must be a valid UUID' })
  nonce: string;

  @IsNotEmpty({ message: 'Sequence is required' })
  @IsInt({ message: 'Sequence must be an integer' })
  @Min(1, { message: 'Sequence must be >= 1' })
  seq: number;

  @IsNotEmpty({ message: 'Timestamp is required' })
  @IsInt({ message: 'Timestamp must be an integer epoch ms' })
  timestamp: number;
}

export class WebrtcRespondWsDto {
  @IsNotEmpty({ message: 'Session ID is required' })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId: string;

  @IsNotEmpty({ message: 'Action is required' })
  @IsIn(['ACCEPT', 'DECLINE'], { message: 'Action must be ACCEPT or DECLINE' })
  action: 'ACCEPT' | 'DECLINE';
}

export class WebrtcOfferWsDto extends WebrtcSignalingBaseDto {
  @IsNotEmpty({ message: 'SDP string is required' })
  @IsString()
  sdp: string;
}

export class WebrtcAnswerWsDto extends WebrtcSignalingBaseDto {
  @IsNotEmpty({ message: 'SDP string is required' })
  @IsString()
  sdp: string;
}

export class WebrtcIceCandidateWsDto extends WebrtcSignalingBaseDto {
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

