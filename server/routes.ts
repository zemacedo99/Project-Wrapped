import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/wrapped", async (_req, res) => {
    try {
      const data = await storage.getProjectWrappedData();
      res.json(data);
    } catch (error) {
      console.error("Error fetching wrapped data:", error);
      res.status(500).json({ error: "Failed to load project wrapped data" });
    }
  });

  return httpServer;
}
