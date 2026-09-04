import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Space, Typography, Tag, Alert, Spin } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import {
  checkAvailabilityStream,
  checkAvailabilityStreamByIp,
} from "../../api/ipRecords";
import type {
  CheckAvailabilityProgressEvent,
  CheckAvailabilityResult,
} from "../../api/ipRecords";

type SourceKey = "device42" | "zabbix" | "paloalto" | "vsphere";
type SourceState = {
  status: "pending" | "checking" | "done" | "error";
  found?: boolean;
  name?: string | null;
  message?: string;
};

const SOURCE_ORDER: SourceKey[] = ["device42", "zabbix", "paloalto", "vsphere"];
const SOURCE_LABEL: Record<SourceKey, string> = {
  device42: "Device42",
  zabbix: "Zabbix",
  paloalto: "PaloAlto",
  vsphere: "vSphere",
};

const initialSources = (): Record<SourceKey, SourceState> => ({
  device42: { status: "pending" },
  zabbix: { status: "pending" },
  paloalto: { status: "pending" },
  vsphere: { status: "pending" },
});

const SourceRow: React.FC<{ label: string; state: SourceState }> = ({
  label,
  state,
}) => {
  let icon = (
    <MinusCircleOutlined style={{ color: "rgba(255,255,255,0.25)" }} />
  );
  let suffix: React.ReactNode = null;

  if (state.status === "checking") {
    icon = <LoadingOutlined style={{ color: "#1677ff" }} />;
    suffix = <Typography.Text type="secondary">checking…</Typography.Text>;
  } else if (state.status === "done") {
    icon = state.found ? (
      <CheckCircleOutlined style={{ color: "#52c41a" }} />
    ) : (
      <CloseCircleOutlined style={{ color: "#8c8c8c" }} />
    );
    const tagStyle: React.CSSProperties = {
      whiteSpace: "normal",
      wordBreak: "break-word",
      maxWidth: "100%",
      display: "inline-block",
    };
    suffix = state.found ? (
      <Tag color="green" style={tagStyle}>
        Found{state.name ? ` — ${state.name}` : ""}
      </Tag>
    ) : (
      <Tag style={tagStyle}>Not found</Tag>
    );
  } else if (state.status === "error") {
    icon = <CloseCircleOutlined style={{ color: "#faad14" }} />;
    suffix = (
      <Typography.Text type="warning" style={{ fontSize: 12 }}>
        {state.message ?? "check failed"}
      </Typography.Text>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 0",
      }}
    >
      <span
        style={{
          fontSize: 16,
          width: 20,
          flexShrink: 0,
          textAlign: "center",
          lineHeight: "22px",
        }}
      >
        {icon}
      </span>
      <Typography.Text
        strong
        style={{
          width: 90,
          flexShrink: 0,
          whiteSpace: "nowrap",
          lineHeight: "22px",
        }}
      >
        {label}
      </Typography.Text>
      <div style={{ flex: 1, minWidth: 0, lineHeight: "22px" }}>{suffix}</div>
    </div>
  );
};

interface CheckAvailabilityModalProps {
  open: boolean;
  onClose: () => void;
  ipAddress: string;
  recordId?: string;
  onUpdated?: () => void;
}

const CheckAvailabilityModal: React.FC<CheckAvailabilityModalProps> = ({
  open,
  onClose,
  ipAddress,
  recordId,
  onUpdated,
}) => {
  const [sources, setSources] =
    useState<Record<SourceKey, SourceState>>(initialSources());
  const [result, setResult] = useState<CheckAvailabilityResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSources(initialSources());
    setResult(null);
    setErrorMsg(null);
    setRunning(true);

    const handlers = {
      onProgress: (event: CheckAvailabilityProgressEvent) => {
        setSources((prev) => ({
          ...prev,
          [event.source]: {
            status: event.status,
            found: event.found,
            name: event.name,
            message: event.message,
          },
        }));
      },
      onResult: (r: CheckAvailabilityResult) => {
        setResult(r);
        if (r.status_updated) onUpdated?.();
      },
      onError: (message: string) => setErrorMsg(message),
    };

    try {
      if (recordId) {
        await checkAvailabilityStream(recordId, handlers, controller.signal);
      } else {
        await checkAvailabilityStreamByIp(
          ipAddress,
          handlers,
          controller.signal,
        );
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const error = err as Error;
      setErrorMsg(error.message || "Check Availability failed");
    } finally {
      if (abortRef.current === controller) setRunning(false);
    }
  }, [recordId, ipAddress, onUpdated]);

  useEffect(() => {
    if (open) void run();
    return () => {
      if (!open) abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      title={
        <Space>
          <WifiOutlined />
          Check Availability —{" "}
          <Typography.Text code>{ipAddress}</Typography.Text>
        </Space>
      }
      open={open}
      onCancel={() => {
        abortRef.current?.abort();
        onClose();
      }}
      footer={null}
      width={480}
    >
      <div style={{ marginBottom: 8 }}>
        {SOURCE_ORDER.map((key) => (
          <SourceRow key={key} label={SOURCE_LABEL[key]} state={sources[key]} />
        ))}
      </div>

      {running && !result && !errorMsg && (
        <Typography.Text type="secondary">
          <Spin size="small" style={{ marginRight: 8 }} />
          Scanning…
        </Typography.Text>
      )}

      {errorMsg && (
        <Alert
          type="error"
          showIcon
          message={errorMsg}
          style={{ marginTop: 8 }}
        />
      )}

      {result && !running && (
        <Alert
          style={{ marginTop: 12 }}
          type={result.found ? "success" : "warning"}
          showIcon
          message={
            result.found
              ? `${ipAddress} is IN USE`
              : `${ipAddress} appears unused across all 4 sources`
          }
          description={(() => {
            const powerLine =
              result.vsphere_power_state === "on"
                ? "Power: On"
                : result.vsphere_power_state === "off"
                  ? "Power: Off"
                  : null;

            if (!recordId) {
              return powerLine
                ? `Informational only — this address has no IP record yet. ${powerLine}.`
                : "Informational only — this address has no IP record yet.";
            }

            const changes: string[] = [];
            if (result.status_updated)
              changes.push(`Status → ${result.new_status}`);
            if (result.hostname) changes.push(`Hostname → ${result.hostname}`);
            if (result.os_type) changes.push(`OS → ${result.os_type}`);
            const summary = changes.length
              ? changes.join(" · ")
              : result.found
                ? "Found, but everything was already up to date — nothing changed."
                : "No source found it — status was not changed (absence isn't proof it's free).";
            return powerLine ? `${summary} · ${powerLine}` : summary;
          })()}
        />
      )}
    </Modal>
  );
};

export default CheckAvailabilityModal;
