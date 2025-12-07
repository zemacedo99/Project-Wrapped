import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { projectWrappedDataSchema } from "@shared/schema";
import { fetchAzureDevOpsData, validateAzureDevOpsConfig, testAzureDevOpsConnection } from "./services/azure-devops";
import { fetchGitHubData, validateGitHubConfig } from "./services/github";
import multer from "multer";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

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

  app.get("/api/wrapped/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      if (id === "sample") {
        const data = await storage.getProjectWrappedData();
        res.json(data);
        return;
      }

      const saved = await storage.getSavedWrapped(id);
      if (!saved) {
        res.status(404).json({ error: "Wrapped not found" });
        return;
      }
      res.json(saved.data);
    } catch (error) {
      console.error("Error fetching wrapped data:", error);
      res.status(500).json({ error: "Failed to load project wrapped data" });
    }
  });

  app.post("/api/upload-json", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const content = req.file.buffer.toString("utf-8");
      let jsonData: unknown;
      
      try {
        jsonData = JSON.parse(content);
      } catch {
        res.status(400).json({ error: "Invalid JSON format" });
        return;
      }

      const validation = projectWrappedDataSchema.safeParse(jsonData);
      if (!validation.success) {
        res.status(400).json({ 
          error: "Invalid data structure", 
          details: validation.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")
        });
        return;
      }

      const saved = await storage.saveWrapped(validation.data);
      res.json({ 
        id: saved.id, 
        projectName: saved.data.projectName 
      });
    } catch (error) {
      console.error("Error processing upload:", error);
      res.status(500).json({ error: "Failed to process uploaded file" });
    }
  });

  app.post("/api/connect/azure-devops", async (req, res) => {
    try {
      const { organization, project, personalAccessToken, dateFrom, dateTo } = req.body;

      const validationErrors = validateAzureDevOpsConfig({ organization, project, personalAccessToken });
      if (validationErrors.length > 0) {
        res.status(400).json({ error: validationErrors.join(", ") });
        return;
      }

      const data = await fetchAzureDevOpsData({
        organization,
        project,
        personalAccessToken,
        dateFrom,
        dateTo,
      });

      const saved = await storage.saveWrapped(data);
      res.json({ 
        id: saved.id, 
        projectName: saved.data.projectName 
      });
    } catch (error) {
      console.error("Error connecting to Azure DevOps:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to connect to Azure DevOps" 
      });
    }
  });

  app.post("/api/test/azure-devops", async (req, res) => {
    try {
      const { organization, project, personalAccessToken } = req.body;

      const validationErrors = validateAzureDevOpsConfig({ organization, project, personalAccessToken });
      if (validationErrors.length > 0) {
        res.status(400).json({ error: validationErrors.join(", ") });
        return;
      }

      const result = await testAzureDevOpsConnection({
        organization,
        project,
        personalAccessToken,
      });

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error testing Azure DevOps connection:", error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Connection test failed" 
      });
    }
  });

  app.post("/api/connect/github", async (req, res) => {
    try {
      const { owner, repo, personalAccessToken, dateFrom, dateTo } = req.body;

      const validationErrors = validateGitHubConfig({ owner, repo, personalAccessToken });
      if (validationErrors.length > 0) {
        res.status(400).json({ error: validationErrors.join(", ") });
        return;
      }

      const data = await fetchGitHubData({
        owner,
        repo,
        personalAccessToken,
        dateFrom,
        dateTo,
      });

      const saved = await storage.saveWrapped(data);
      res.json({ 
        id: saved.id, 
        projectName: saved.data.projectName 
      });
    } catch (error) {
      console.error("Error connecting to GitHub:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to connect to GitHub" 
      });
    }
  });

  return httpServer;
}
