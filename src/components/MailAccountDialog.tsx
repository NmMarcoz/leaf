import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import {
  presets,
  saveSendConfig,
  type DeliveryConfig,
  type DeliveryStatus,
} from "@/lib/send";

/**
 * The one mail account every email device is sent through.
 *
 * One account, many devices: a household's Kindles each have their own
 * address, but they are all mailed from the same place, and that is the
 * address Amazon has to have approved. The device's own address lives on the
 * device; this is only the sending side.
 *
 * The password is write-only from here: it goes to the system keychain and
 * is never read back, so an empty field means "keep what is stored".
 */
export function MailAccountDialog({
  open,
  onOpenChange,
  status,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: DeliveryStatus | null;
  onSaved: (status: DeliveryStatus) => void;
}) {
  const t = useT();
  const [config, setConfig] = useState<DeliveryConfig | null>(status?.config ?? null);
  /** `null` means "leave the stored password alone". */
  const [password, setPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh each time it opens, so a cancelled edit does not linger.
  useEffect(() => {
    if (open) {
      setConfig(status?.config ?? null);
      setPassword(null);
      setError(null);
    }
  }, [open, status]);

  const patch = (fields: Partial<DeliveryConfig>) =>
    setConfig((current) => (current ? { ...current, ...fields } : current));

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveSendConfig(config, password));
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, password, onSaved, onOpenChange]);

  const preset = config
    ? presets(t).find((p) => p.host === config.host && p.port === config.port)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("mailAccount.title")}</DialogTitle>
          <DialogDescription>{t("mailAccount.description")}</DialogDescription>
        </DialogHeader>

        {config && (
          <DialogBody className="flex flex-col gap-5">
            {/* The failure nothing can detect, stated before it happens. */}
            <Callout tone="warning" title={t("sendView.approvalWarningTitle")}>
              <p>
                {t("sendView.approvedBefore")}{" "}
                <span className="text-foreground">{t("sendView.approvedEmphasis")}</span>{" "}
                {t("sendView.approvedAfter")}
              </p>
              <a
                href="https://www.amazon.com/hz/mycd/digital-console/alldevices"
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] hover:underline"
              >
                <ExternalLink className="size-3" />
                {t("sendView.manageDevicesLink")}
              </a>
            </Callout>

            <div className="flex flex-col gap-2">
              <Label htmlFor="from">{t("sendView.senderAddress")}</Label>
              <Input
                id="from"
                value={config.from}
                placeholder={t("sendView.exampleAddress")}
                onChange={(e) => patch({ from: e.target.value })}
              />
              <p className="text-xs text-text-secondary">{t("sendView.senderAddressHint")}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("sendView.mailProvider")}</Label>
              <Select
                value={preset?.label ?? ""}
                onValueChange={(label) => {
                  const p = presets(t).find((x) => x.label === label);
                  if (p) patch({ host: p.host, port: p.port, security: p.security });
                }}
              >
                <SelectTrigger className="w-60">
                  <SelectValue placeholder={t("sendView.mailProviderPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {presets(t).map((p) => (
                    <SelectItem key={p.label} value={p.label}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset?.note && <p className="text-xs text-text-secondary">{preset.note}</p>}
            </div>

            <div className="flex gap-3 max-sm:flex-wrap">
              <div className="flex min-w-40 flex-1 flex-col gap-2">
                <Label htmlFor="host">{t("sendView.server")}</Label>
                <Input
                  id="host"
                  value={config.host}
                  placeholder={t("sendView.serverPlaceholder")}
                  onChange={(e) => patch({ host: e.target.value })}
                />
              </div>
              <div className="flex w-24 flex-col gap-2">
                <Label htmlFor="port">{t("sendView.port")}</Label>
                <Input
                  id="port"
                  type="number"
                  value={config.port}
                  onChange={(e) => patch({ port: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="flex w-40 flex-col gap-2">
                <Label htmlFor="security">{t("sendView.encryption")}</Label>
                <Select value={config.security} onValueChange={(v) => patch({ security: v })}>
                  <SelectTrigger id="security">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="start-tls">{t("sendView.encryptionStartTls")}</SelectItem>
                    <SelectItem value="tls">{t("sendView.encryptionTls")}</SelectItem>
                    <SelectItem value="none">{t("sendView.encryptionNone")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-3 max-sm:flex-wrap">
                <div className="flex min-w-40 flex-1 flex-col gap-2">
                  <Label htmlFor="username">{t("sendView.username")}</Label>
                  <Input
                    id="username"
                    value={config.username}
                    placeholder={t("sendView.exampleAddress")}
                    onChange={(e) => patch({ username: e.target.value })}
                  />
                </div>
                <div className="flex min-w-40 flex-1 flex-col gap-2">
                  <Label htmlFor="password">{t("sendView.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password ?? ""}
                    placeholder={
                      status?.has_password
                        ? t("sendView.passwordStored")
                        : t("sendView.passwordPlaceholder")
                    }
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-text-secondary">
                {t("sendView.passwordHint", { keychain: keychainName(t) })}
              </p>
            </div>
          </DialogBody>
        )}

        <DialogFooter error={error}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("mailAccount.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={!config || saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t("mailAccount.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the system's secret store is called here, for the password hint. */
export function keychainName(t: (key: string) => string): string {
  const platform = navigator.platform;
  if (platform.startsWith("Win")) return t("sendView.windowsCredentialManager");
  if (platform.startsWith("Mac")) return t("sendView.macKeychain");
  return t("sendView.systemKeyring");
}
