import { useState, useRef, useCallback } from "react";
import { message } from "antd";
import { passwordsApi } from "../../api/vault";

const REVEAL_TIMEOUT_MS = 30_000;

interface RevealState {
  entryId: string | null;
  password: string | null;
  secondsLeft: number;
  loading: boolean;
}

interface UseRevealReturn {
  revealState: RevealState;
  copyingId: string | null;
  revealPassword: (entryId: string) => Promise<void>;
  copyPassword: (entryId: string) => Promise<void>;
  clearReveal: () => void;
  copyToClipboard: (text: string) => void;
}

export function useReveal(): UseRevealReturn {
  const [revealState, setRevealState] = useState<RevealState>({
    entryId: null,
    password: null,
    secondsLeft: 0,
    loading: false,
  });
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);

  const clearReveal = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRevealState({
      entryId: null,
      password: null,
      secondsLeft: 0,
      loading: false,
    });
  }, []);

  const revealPassword = useCallback(
    async (entryId: string): Promise<void> => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      setRevealState({
        entryId,
        password: null,
        secondsLeft: 0,
        loading: true,
      });

      try {
        const res = await passwordsApi.reveal(entryId);
        const password = res.data.password;

        secondsRef.current = Math.ceil(REVEAL_TIMEOUT_MS / 1000);
        setRevealState({
          entryId,
          password,
          secondsLeft: secondsRef.current,
          loading: false,
        });

        timerRef.current = setInterval(() => {
          secondsRef.current -= 1;
          if (secondsRef.current <= 0) {
            clearReveal();
          } else {
            setRevealState((prev) => ({
              ...prev,
              secondsLeft: secondsRef.current,
            }));
          }
        }, 1000);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        const detail =
          axiosErr.response?.data?.detail ?? "Failed to reveal password";
        message.error(detail);
        setRevealState({
          entryId: null,
          password: null,
          secondsLeft: 0,
          loading: false,
        });
      }
    },
    [clearReveal],
  );

  const copyPassword = useCallback(async (entryId: string): Promise<void> => {
    setCopyingId(entryId);
    try {
      const res = await passwordsApi.reveal(entryId);
      await navigator.clipboard.writeText(res.data.password);
      message.success("Password copied");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      message.error(
        axiosErr.response?.data?.detail ?? "Failed to copy password",
      );
    } finally {
      setCopyingId(null);
    }
  }, []);

  const copyToClipboard = useCallback((text: string): void => {
    navigator.clipboard.writeText(text).then(
      () => message.success("Copied to clipboard"),
      () => message.error("Failed to copy to clipboard"),
    );
  }, []);

  return {
    revealState,
    copyingId,
    revealPassword,
    copyPassword,
    clearReveal,
    copyToClipboard,
  };
}
