import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert } from "lucide-react";

interface AuthMe {
  authenticated: boolean;
  email: string | null;
  mode: "cloudflare-access" | "dev-bypass" | "disabled";
}

// Small "who am I" badge backed by GET /api/auth/me. Hidden entirely when
// authentication is disabled (the pre-existing LAN mode) so the default
// deployment looks unchanged. See AUTHENTICATION.md.
export function AuthStatus() {
  const { data } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await fetch("/api/auth/me");
      if (!response.ok) throw new Error("Failed to load auth status");
      return (await response.json()) as AuthMe;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!data || data.mode === "disabled") return null;

  return (
    <div
      className="flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur"
      data-testid="auth-status"
    >
      {data.authenticated ? (
        <>
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span data-testid="text-auth-email">{data.email}</span>
        </>
      ) : (
        <>
          <ShieldAlert className="w-4 h-4 text-destructive" />
          <span>Not signed in</span>
        </>
      )}
    </div>
  );
}
