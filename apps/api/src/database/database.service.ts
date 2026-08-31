import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import postgres, { type Sql } from "postgres";
import { getEnv } from "../config/env";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly sql: Sql;

  constructor() {
    this.sql = postgres(getEnv().DATABASE_URL, {
      max: process.env.NODE_ENV === "test" ? 1 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
