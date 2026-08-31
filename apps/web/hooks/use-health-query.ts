"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useHealthQuery() {
  return useQuery({
    queryKey: ["system", "health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/health");
      if (error || !data) throw new Error("API health check failed");
      return data;
    },
  });
}
