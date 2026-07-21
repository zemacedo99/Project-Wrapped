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

// Resolves the Azure DevOps PAT to use for one connection attempt.
//
// Precedence: a PAT typed by the user in the request body always wins; only
// falls back to the server-side AZURE_DEVOPS_PAT env var when the client
// explicitly asks for it (useConfiguredPat) or simply didn't type one while
// a configured PAT exists. The literal env PAT value is never echoed back in
// any response - only used server-side to call Azure DevOps.
function resolvePat(body: { personalAccessToken?: unknown; useConfiguredPat?: unknown }): string | undefined {
  const typed = typeof body.personalAccessToken === "string" ? body.personalAccessToken.trim() : "";
  if (typed) return typed;

  const configured = process.env.AZURE_DEVOPS_PAT?.trim();
  if (!configured) return undefined;

  // Explicit opt-in, or an empty/omitted field while a configured PAT exists.
  if (body.useConfiguredPat === true || typeof body.personalAccessToken !== "string" || !typed) {
    return configured;
  }
  return undefined;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Minimal liveness/readiness check - never exposes secrets or internals.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Non-secret Azure DevOps connection defaults for the "Connect to Azure
  // DevOps" dialog. Deliberately never includes the PAT itself - only a
  // boolean indicating whether one is configured server-side.
  app.get("/api/config/azure-devops", (_req, res) => {
    const sanitize = (value: string | undefined) => (typeof value === "string" ? value.trim() : "");
    res.json({
      baseUrl: sanitize(process.env.AZURE_DEVOPS_BASE_URL),
      organization: sanitize(process.env.AZURE_DEVOPS_ORGANIZATION),
      project: sanitize(process.env.AZURE_DEVOPS_PROJECT),
      hasConfiguredPat: Boolean(process.env.AZURE_DEVOPS_PAT?.trim()),
    });
  });

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
      const { organization, project, baseUrl, dateFrom, dateTo, repositories } = req.body;
      const personalAccessToken = resolvePat(req.body);

      const validationErrors = validateAzureDevOpsConfig({ organization, project, personalAccessToken });
      if (validationErrors.length > 0) {
        res.status(400).json({ error: validationErrors.join(", ") });
        return;
      }
      if (!personalAccessToken) {
        res.status(400).json({ error: "Personal Access Token is required" });
        return;
      }

      const data = await fetchAzureDevOpsData({
        organization,
        project,
        personalAccessToken,
        baseUrl,
        dateFrom,
        dateTo,
        // Only accept an array of repository names; ignore anything else.
        repositories: Array.isArray(repositories) ? repositories.filter((r: unknown) => typeof r === "string") : undefined,
      });

      const saved = await storage.saveWrapped(data);
      res.json({ 
        id: saved.id, 
        projectName: saved.data.projectName 
      });
    } catch (error) {
      console.error("Error connecting to Azure DevOps:", error);
      const message = error instanceof Error && error.message ? error.message : "Failed to connect to Azure DevOps";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/test/azure-devops", async (req, res) => {
    try {
      const { organization, project, baseUrl } = req.body;
      const personalAccessToken = resolvePat(req.body);

      const validationErrors = validateAzureDevOpsConfig({ organization, project, personalAccessToken });
      if (validationErrors.length > 0) {
        res.status(400).json({ error: validationErrors.join(", ") });
        return;
      }
      if (!personalAccessToken) {
        res.status(400).json({ error: "Personal Access Token is required" });
        return;
      }

      const result = await testAzureDevOpsConnection({
        organization,
        project,
        personalAccessToken,
        baseUrl,
      });

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error testing Azure DevOps connection:", error);
      const message = error instanceof Error && error.message ? error.message : "Connection test failed";
      res.status(500).json({ success: false, error: message });
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
      const message = error instanceof Error && error.message ? error.message : "Failed to connect to GitHub";
      res.status(500).json({ error: message });
    }
  });

  return httpServer;
}
