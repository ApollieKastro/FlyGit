import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  // JwtModule is used only as a signing/verification utility — secrets are
  // passed explicitly per call from validated environment.
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, TokenService, TotpService],
  exports: [AuthService, TokenService, TotpService],
})
export class AuthModule {}
