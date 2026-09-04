import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionModule } from '../sessions/session.module';
import { RedisModule } from '../../common/redis/redis.module';
import { CsrfGuard } from '../../common/guards/csrf.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secretOrKey', 'default_long_secret_key_32_characters!'),
        signOptions: {
          expiresIn: '15m',
          algorithm: 'HS256',
        },
      }),
    }),
    SessionModule,
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, CsrfGuard],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
