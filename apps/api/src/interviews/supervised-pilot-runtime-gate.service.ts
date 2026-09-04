import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";

@Injectable()
export class SupervisedPilotRuntimeGateService {
  isEnabled(): boolean {
    return getEnv().SUPERVISED_PILOT_ENABLED;
  }
}
