import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileJson, Database, GitBranch, Sparkles, ArrowRight, CheckCircle, X, Loader2, Cloud } from "lucide-react";
import { SiGithub } from "react-icons/si";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DataSource = "json" | "sample" | "azure" | "github" | null;

export default function Home() {
  const [, setLocation] = useLocation();
  const [selectedSource, setSelectedSource] = useState<DataSource>(null);
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [showAzureDialog, setShowAzureDialog] = useState(false);
  const [showGitHubDialog, setShowGitHubDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [azureForm, setAzureForm] = useState({
    organization: "",
    project: "",
    personalAccessToken: "",
    baseUrl: "",
    dateFrom: "",
    dateTo: "",
  });

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string; details?: any } | null>(null);

  const [githubForm, setGithubForm] = useState({
    owner: "",
    repo: "",
    personalAccessToken: "",
    dateFrom: "",
    dateTo: "",
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload-json", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Data uploaded successfully",
        description: `Loaded project: ${data.projectName}`,
      });
      setLocation(`/wrapped/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const azureMutation = useMutation({
    mutationFn: async (formData: typeof azureForm) => {
      const response = await fetch("/api/connect/azure-devops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Connection failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Connected to Azure DevOps",
        description: `Loaded project: ${data.projectName}`,
      });
      setShowAzureDialog(false);
      setLocation(`/wrapped/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Connection failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const githubMutation = useMutation({
    mutationFn: async (formData: typeof githubForm) => {
      const response = await fetch("/api/connect/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Connection failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Connected to GitHub",
        description: `Loaded project: ${data.projectName}`,
      });
      setShowGitHubDialog(false);
      setLocation(`/wrapped/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Connection failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".json")) {
        toast({
          title: "Invalid file type",
          description: "Please upload a JSON file",
          variant: "destructive",
        });
        return;
      }
      setJsonFile(file);
      setSelectedSource("json");
    }
  };

  const handleUpload = () => {
    if (jsonFile) {
      uploadMutation.mutate(jsonFile);
    }
  };

  const handleUseSampleData = () => {
    setLocation("/wrapped/sample");
  };

  const handleAzureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    azureMutation.mutate(azureForm);
  };

  const handleTestAzureConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    
    try {
      const response = await fetch("/api/test/azure-devops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: azureForm.organization,
          project: azureForm.project,
          personalAccessToken: azureForm.personalAccessToken,
          baseUrl: azureForm.baseUrl || undefined,
        }),
      });
      
      const result = await response.json();
      setConnectionTestResult(result);
      
      if (result.success) {
        toast({
          title: "Connection successful!",
          description: result.message,
        });
      } else {
        toast({
          title: "Connection failed",
          description: result.message || result.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Connection test failed";
      setConnectionTestResult({ success: false, message: errorMessage });
      toast({
        title: "Connection test failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleGitHubSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    githubMutation.mutate(githubForm);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
      
      <div className="relative z-10 container mx-auto px-4 py-16 max-w-4xl">
        <div className="text-center mb-12 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-primary via-accent to-chart-2 bg-clip-text text-transparent" data-testid="text-title">
            Project Wrapped
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto" data-testid="text-subtitle">
            Celebrate your team's achievements with a beautiful, Spotify Wrapped-style presentation of your project's journey.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card 
            className={`cursor-pointer transition-all duration-200 ${
              selectedSource === "json" ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => fileInputRef.current?.click()}
            data-testid="card-json-upload"
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <FileJson className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Upload JSON File</CardTitle>
                  <CardDescription>Import your project data from a JSON file</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-json-file"
              />
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-md p-6 text-center hover-elevate">
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                {jsonFile ? (
                  <div className="flex items-center justify-center gap-2 text-primary">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">{jsonFile.name}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Click to select or drag and drop
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card 
            className={`cursor-pointer transition-all duration-200 ${
              selectedSource === "sample" ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => setSelectedSource("sample")}
            data-testid="card-sample-data"
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-accent/10">
                  <Database className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <CardTitle className="text-lg">Use Sample Data</CardTitle>
                  <CardDescription>Preview with DVOI demo project data</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-md p-6 text-center hover-elevate">
                <Sparkles className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  See Project Wrapped in action with sample data
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card 
            className={`cursor-pointer transition-all duration-200 ${
              selectedSource === "azure" ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => {
              setSelectedSource("azure");
              setShowAzureDialog(true);
            }}
            data-testid="card-azure-devops"
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-chart-1/10">
                  <Cloud className="w-6 h-6 text-chart-1" />
                </div>
                <div>
                  <CardTitle className="text-lg">Azure DevOps</CardTitle>
                  <CardDescription>Connect to your Azure DevOps project</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-md p-6 text-center hover-elevate">
                <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Pull commits, PRs, and work items
                </p>
              </div>
            </CardContent>
          </Card>

          <Card 
            className={`cursor-pointer transition-all duration-200 ${
              selectedSource === "github" ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => {
              setSelectedSource("github");
              setShowGitHubDialog(true);
            }}
            data-testid="card-git-repo"
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-chart-2/10">
                  <SiGithub className="w-6 h-6 text-chart-2" />
                </div>
                <div>
                  <CardTitle className="text-lg">GitHub Repository</CardTitle>
                  <CardDescription>Import from a GitHub repository</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-md p-6 text-center hover-elevate">
                <GitBranch className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Fetch commits, PRs, and issues
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 flex justify-center">
          {selectedSource === "json" && jsonFile && (
            <Button 
              size="lg" 
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              data-testid="button-upload"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Generate Your Wrapped
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          )}
          {selectedSource === "sample" && (
            <Button 
              size="lg" 
              onClick={handleUseSampleData}
              data-testid="button-sample"
            >
              View Sample Wrapped
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>

        <div className="mt-16 text-center">
          <h2 className="text-2xl font-semibold mb-4">JSON Format Reference</h2>
          <Card className="text-left max-w-2xl mx-auto">
            <CardContent className="p-4">
              <pre className="text-xs text-muted-foreground overflow-x-auto">
{`{
  "projectName": "Your Project Name",
  "version": "1.0",
  "dateRange": { "start": "2024-01-01", "end": "2024-12-31" },
  "stats": {
    "totalCommits": 1000,
    "totalPullRequests": 200,
    "totalReviews": 500,
    "totalComments": 1500,
    "totalBugsFixed": 50,
    "totalStoryPointsDone": 300,
    "sprintsCompleted": 12
  },
  "contributors": [...],
  "modules": [...],
  "top5": {...},
  "highlights": [...],
  "milestones": [...]
}`}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showAzureDialog} onOpenChange={setShowAzureDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-chart-1" />
              Connect to Azure DevOps
            </DialogTitle>
            <DialogDescription>
              Enter your Azure DevOps organization details and a Personal Access Token with Code (Read) and Work Items (Read) permissions.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAzureSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="azure-base-url">Base URL (Optional)</Label>
              <Input
                id="azure-base-url"
                placeholder="https://dev.azure.com/your-org OR https://your-server/collection"
                value={azureForm.baseUrl}
                onChange={(e) => {
                  setAzureForm({ ...azureForm, baseUrl: e.target.value });
                  setConnectionTestResult(null);
                }}
                data-testid="input-azure-base-url"
              />
              <p className="text-xs text-muted-foreground">
                For cloud: leave empty (uses dev.azure.com)<br />
                For on-premises: https://<strong>your-server</strong> (e.g., https://tfsdavinci.eu.mt.mtnet)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-org">Organization / Collection</Label>
              <Input
                id="azure-org"
                placeholder="your-organization or Collection Name"
                value={azureForm.organization}
                onChange={(e) => {
                  setAzureForm({ ...azureForm, organization: e.target.value });
                  setConnectionTestResult(null);
                }}
                required
                data-testid="input-azure-org"
              />
              <p className="text-xs text-muted-foreground">
                For cloud: Your organization name<br />
                For on-premises: Your collection name (e.g., "LabTec New")
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-project">Project Name</Label>
              <Input
                id="azure-project"
                placeholder="your-project"
                value={azureForm.project}
                onChange={(e) => {
                  setAzureForm({ ...azureForm, project: e.target.value });
                  setConnectionTestResult(null);
                }}
                required
                data-testid="input-azure-project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-pat">Personal Access Token</Label>
              <Input
                id="azure-pat"
                type="password"
                placeholder="Enter your PAT"
                value={azureForm.personalAccessToken}
                onChange={(e) => {
                  setAzureForm({ ...azureForm, personalAccessToken: e.target.value });
                  setConnectionTestResult(null);
                }}
                required
                data-testid="input-azure-pat"
              />
              <p className="text-xs text-muted-foreground">
                Required scopes: Code (Read), Work Items (Read)
              </p>
            </div>
            
            {connectionTestResult && (
              <div className={`p-3 rounded-md border ${
                connectionTestResult.success 
                  ? 'bg-green-50 border-green-200 text-green-800' 
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                <div className="flex items-start gap-2">
                  {connectionTestResult.success ? (
                    <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  ) : (
                    <X className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{connectionTestResult.message}</p>
                    {connectionTestResult.details && (
                      <p className="text-xs mt-1">
                        Found {connectionTestResult.details.repositoryCount} repositories
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            <Button 
              type="button" 
              variant="outline" 
              className="w-full"
              onClick={handleTestAzureConnection}
              disabled={isTestingConnection || !azureForm.organization || !azureForm.project || !azureForm.personalAccessToken}
            >
              {isTestingConnection ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4 mr-2" />
                  Test Connection
                </>
              )}
            </Button>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="azure-from">Date From (optional)</Label>
                <Input
                  id="azure-from"
                  type="date"
                  value={azureForm.dateFrom}
                  onChange={(e) => setAzureForm({ ...azureForm, dateFrom: e.target.value })}
                  data-testid="input-azure-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azure-to">Date To (optional)</Label>
                <Input
                  id="azure-to"
                  type="date"
                  value={azureForm.dateTo}
                  onChange={(e) => setAzureForm({ ...azureForm, dateTo: e.target.value })}
                  data-testid="input-azure-date-to"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setShowAzureDialog(false);
                setConnectionTestResult(null);
              }}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={azureMutation.isPending || !connectionTestResult?.success} 
                data-testid="button-azure-connect"
              >
                {azureMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Fetching Data...
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4 mr-2" />
                    Generate Wrapped
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showGitHubDialog} onOpenChange={setShowGitHubDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SiGithub className="w-5 h-5" />
              Connect to GitHub
            </DialogTitle>
            <DialogDescription>
              Enter the repository details. A Personal Access Token is optional but recommended for private repos.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGitHubSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gh-owner">Repository Owner</Label>
              <Input
                id="gh-owner"
                placeholder="owner or organization"
                value={githubForm.owner}
                onChange={(e) => setGithubForm({ ...githubForm, owner: e.target.value })}
                required
                data-testid="input-github-owner"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gh-repo">Repository Name</Label>
              <Input
                id="gh-repo"
                placeholder="repository-name"
                value={githubForm.repo}
                onChange={(e) => setGithubForm({ ...githubForm, repo: e.target.value })}
                required
                data-testid="input-github-repo"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gh-pat">Personal Access Token (optional)</Label>
              <Input
                id="gh-pat"
                type="password"
                placeholder="For private repos or higher rate limits"
                value={githubForm.personalAccessToken}
                onChange={(e) => setGithubForm({ ...githubForm, personalAccessToken: e.target.value })}
                data-testid="input-github-pat"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gh-from">Date From (optional)</Label>
                <Input
                  id="gh-from"
                  type="date"
                  value={githubForm.dateFrom}
                  onChange={(e) => setGithubForm({ ...githubForm, dateFrom: e.target.value })}
                  data-testid="input-github-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gh-to">Date To (optional)</Label>
                <Input
                  id="gh-to"
                  type="date"
                  value={githubForm.dateTo}
                  onChange={(e) => setGithubForm({ ...githubForm, dateTo: e.target.value })}
                  data-testid="input-github-date-to"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowGitHubDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={githubMutation.isPending} data-testid="button-github-connect">
                {githubMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
