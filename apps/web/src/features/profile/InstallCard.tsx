import { Download, Share } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button, Card } from "../../components/ui";
import { install } from "../../lib/pwa";

export function InstallCard() {
  const available = useSyncExternalStore(install.subscribe, install.available, () => false);
  if (install.isStandalone()) return null;
  if (available) {
    return (
      <Card className="flex items-center gap-4">
        <Download aria-hidden className="size-6 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="font-semibold">Install TatkalFlow</p>
          <p className="text-sm text-muted">Open it from your home screen, like an app.</p>
        </div>
        <Button variant="secondary" onClick={() => void install.prompt()}>
          Install
        </Button>
      </Card>
    );
  }
  if (install.isIos()) {
    return (
      <Card className="flex items-center gap-4">
        <Share aria-hidden className="size-6 shrink-0 text-primary" />
        <p className="text-sm text-muted">
          To install on iPhone or iPad: tap <strong className="text-text">Share</strong>, then <strong className="text-text">Add to Home Screen</strong>. Installing also enables reminders on iOS.
        </p>
      </Card>
    );
  }
  return null;
}
