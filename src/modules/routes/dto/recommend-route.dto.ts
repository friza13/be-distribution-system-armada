import { IsOptional, IsString, IsIn } from 'class-validator';

export class RecommendRouteDto {
  @IsOptional()
  @IsString()
  @IsIn(['osrm', 'haversine'], { message: 'Provider must be osrm or haversine' })
  provider?: 'osrm' | 'haversine';
}
