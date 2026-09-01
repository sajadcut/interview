import { Body, Controller, Post } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  @Post('login')
  login(@Body() payload: LoginDto) {
    return {
      accepted: true,
      email: payload.email,
      next: 'credential verification service',
    };
  }

  @Post('logout')
  logout() {
    return { revoked: true };
  }
}
