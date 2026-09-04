import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Button, Progress, Typography, Alert, Space } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import {
  bulkCheckAvailabilityStream,
  type BulkScanRecordStart,
  type BulkScanRecordError,
  type BulkScanSummary,
} from "../../api/ipRecords";
import type {
  CheckAvailabilityProgressEvent,
  CheckAvailabilityResult,
} from "../../api/ipRecords";

// Above this many records, ask for confirmation with a time estimate first
// instead of launching straight into a scan that could run several minutes
// — a real production batch of 71 records took ~5 minutes end to end.
const CONFIRM_THRESHOLD = 20;
const SECONDS_PER_RECORD = 4;

interface BulkCheckAvailabilityModalProps {
  open: boolean;
  onClose: () => void;
  ids: string[];
  /** Called once the scan finishes if anything was actually updated, so the
   * caller can refresh whatever list it's showing (duplicates, stale, etc). */
  onUpdated?: () => void;
}

const BulkCheckAvailabilityModal: React.FC<BulkCheckAvailabilityModalProps> = ({
  open,
  onClose,
  ids,
  onUpdated,
}) => {
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [summary, setSummary] = useState<BulkScanSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const needsConfirm = ids.length > CONFIRM_THRESHOLD;
  const estMinutes = Math.max(
    1,
    Math.round((ids.length * SECONDS_PER_RECORD) / 60),
  );

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev, line]);
  }, []);

  const run = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLog([]);
    setDone(0);
    setTotal(ids.length);
    setCurrentIp(null);
    setSummary(null);
    setErrorMsg(null);

    try {
      await bulkCheckAvailabilityStream(
        ids,
        {
          onRecordStart: (event: BulkScanRecordStart) => {
            setCurrentIp(event.ip_address);
            appendLog(
              `— Scanning ${event.ip_address} (${event.index + 1}/${event.total})…`,
            );
          },
          onProgress: (event: CheckAvailabilityProgressEvent) => {
            const label =
              event.source === "vsphere"
                ? "vSphere"
                : event.source[0].toUpperCase() + event.source.slice(1);
            if (event.status === "checking") {
              appendLog(`  [${label}] checking…`);
            } else if (event.status === "done") {
              appendLog(
                `  [${label}] ${event.found ? `found — ${event.name ?? "match"}` : "not found"}`,
              );
            } else if (event.status === "error") {
              appendLog(`  [${label}] error: ${event.message ?? "unknown"}`);
            }
          },
          onRecordResult: (result: CheckAvailabilityResult) => {
            const changes: string[] = [];
            if (result.status_updated)
              changes.push(`status → ${result.new_status}`);
            if (result.hostname) changes.push(`hostname → ${result.hostname}`);
            if (result.os_type) changes.push(`OS → ${result.os_type}`);
            if (result.vsphere_power_state)
              changes.push(`power → ${result.vsphere_power_state}`);
            appendLog(
              changes.length > 0
                ? `  → updated: ${changes.join(", ")}`
                : result.found
                  ? "  → found, nothing new to update"
                  : "  → not found anywhere",
            );
            setDone((prev) => prev + 1);
          },
          onRecordError: (event: BulkScanRecordError) => {
            appendLog(`  ✕ error: ${event.message}`);
            setDone((prev) => prev + 1);
          },
          onSummary: (s: BulkScanSummary) => {
            setSummary(s);
            if (s.updated > 0) onUpdated?.();
          },
          onError: (message: string) => setErrorMsg(message),
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const error = err as Error;
      setErrorMsg(error.message || "Bulk scan failed");
    }
  }, [ids, appendLog, onUpdated]);

  // On open, small batches start immediately; large ones wait behind a
  // confirmation screen (see needsConfirm) until the user opts in.
  useEffect(() => {
    if (open) {
      setStarted(!needsConfirm);
      setSummary(null);
      setErrorMsg(null);
      setLog([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && started) void run();
    return () => {
      if (!open) abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, started]);

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Modal
      title="Bulk Scan — Device42 + Zabbix + PaloAlto + vSphere"
      open={open}
      onCancel={() => {
        abortRef.current?.abort();
        onClose();
      }}
      footer={
        started ? (
          <Button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
          >
            Close
          </Button>
        ) : (
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" onClick={() => setStarted(true)}>
              Start Scan
            </Button>
          </Space>
        )
      }
      width={640}
    >
      {!started ? (
        <>
          <Typography.Paragraph>
            This will scan{" "}
            <Typography.Text strong>{ids.length}</Typography.Text> record
            {ids.length === 1 ? "" : "s"} across Device42, Zabbix, PaloAlto, and
            vSphere.
          </Typography.Paragraph>
          <Alert
            type="warning"
            showIcon
            icon={<ClockCircleOutlined />}
            message={`Estimated time: ~${estMinutes} minute${estMinutes === 1 ? "" : "s"}`}
            description="Large batches can take several minutes since each record is checked against all four sources in sequence."
          />
        </>
      ) : (
        <>
          <Progress
            percent={percent}
            status={errorMsg ? "exception" : summary ? "success" : "active"}
            style={{ marginBottom: 8 }}
          />
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginBottom: 12 }}
          >
            {summary
              ? `Done — ${summary.scanned} of ${summary.total} scanned, ${summary.found} found, ${summary.updated} updated`
              : `${done} of ${total} scanned${currentIp ? ` — currently ${currentIp}` : ""}…`}
          </Typography.Text>

          {errorMsg && (
            <Alert
              type="error"
              showIcon
              message={errorMsg}
              style={{ marginBottom: 12 }}
            />
          )}

          <div
            ref={logRef}
            style={{
              background: "#0b0f14",
              color: "#8ce68c",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.6,
              padding: "10px 14px",
              borderRadius: 4,
              maxHeight: 320,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>

          {summary && summary.errors.length > 0 && (
            <Typography.Text
              type="danger"
              style={{ fontSize: 12, display: "block", marginTop: 8 }}
            >
              {summary.errors.length} error(s):{" "}
              {summary.errors.slice(0, 3).join(" · ")}
              {summary.errors.length > 3
                ? ` · +${summary.errors.length - 3} more`
                : ""}
            </Typography.Text>
          )}
        </>
      )}
    </Modal>
  );
};

export default BulkCheckAvailabilityModal;
