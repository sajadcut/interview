import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  getBootstrapStatus(): { service: string; status: string } {
    return {
      service: "interview-api",
      status: "bootstrap",
    };
  }
}
