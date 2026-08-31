import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type InterviewDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: process.env.NODE_ENV === "test" ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema, casing: "snake_case" });
}
