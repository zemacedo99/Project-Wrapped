import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Clapperboard, Copy, ExternalLink, RotateCcw } from "lucide-react";

interface PosterPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The generated prompt; null when the recap has no champions. */
  prompt: string | null;
}

export function PosterPromptDialog({ open, onOpenChange, prompt }: PosterPromptDialogProps) {
  const { toast } = useToast();
  const [text, setText] = useState(prompt ?? "");

  // Start from the freshly generated prompt each time the dialog opens.
  useEffect(() => {
    if (open) setText(prompt ?? "");
  }, [open, prompt]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Prompt copied", description: "Paste it into ChatGPT or another image generator." });
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard className="w-5 h-5" />
            Movie poster prompt
          </DialogTitle>
          <DialogDescription>
            An image prompt starring this recap's Hall of Fame champions, their titles and the project's numbers. Edit it
            if you like, then paste it into ChatGPT or another image generator.
          </DialogDescription>
        </DialogHeader>

        {prompt ? (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[320px] font-mono text-xs leading-relaxed"
              spellCheck={false}
              data-testid="textarea-poster-prompt"
            />
            <p className="text-xs text-muted-foreground">
              It names real people. Only attach someone's photo to the image generator with their OK.
            </p>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="ghost" onClick={() => setText(prompt)} disabled={text === prompt} data-testid="button-poster-reset">
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset
              </Button>
              <Button variant="outline" asChild>
                <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" data-testid="link-open-chatgpt">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open ChatGPT
                </a>
              </Button>
              <Button onClick={copy} data-testid="button-poster-copy">
                <Copy className="w-4 h-4 mr-2" />
                Copy prompt
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This recap has no Hall of Fame champions to put on a poster (no contributors are shown).
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
