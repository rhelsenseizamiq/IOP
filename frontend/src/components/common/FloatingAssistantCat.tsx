import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip } from "antd";
import { useAuth } from "../../context/AuthContext";

const BRAND_COLOR = "#63e2b7";

/**
 * A small floating cat mascot, bottom-right on every page — a friendly
 * shortcut to the AI Assistant rather than a second chat surface of its
 * own (no embedded chat logic here, just navigation). Only shown once
 * logged in, and hidden on the Assistant page itself since it would
 * just point at the page already open.
 */
const FloatingAssistantCat: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!isAuthenticated || location.pathname === "/assistant") return null;

  return (
    <>
      <style>{`
        @keyframes catBlink {
          0%, 92%, 100% { transform: scaleY(1); }
          96% { transform: scaleY(0.1); }
        }
        @keyframes catBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .assistant-cat-eye { animation: catBlink 4.5s ease-in-out infinite; transform-origin: center; }
        .assistant-cat-badge { animation: catBob 3s ease-in-out infinite; }
        .assistant-cat-badge:hover { animation-play-state: paused; }
      `}</style>
      <Tooltip title="Ask AI Assistant" placement="left">
        <button
          onClick={() => navigate("/assistant")}
          aria-label="Open AI Assistant"
          className="assistant-cat-badge"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#252530",
            border: `1.5px solid ${BRAND_COLOR}66`,
            boxShadow: `0 4px 16px rgba(0,0,0,0.4), 0 0 0 4px ${BRAND_COLOR}11`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 0,
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            {/* Ears */}
            <path d="M5 8 L7.5 3 L10 8 Z" fill={BRAND_COLOR} />
            <path d="M19 8 L16.5 3 L14 8 Z" fill={BRAND_COLOR} />
            {/* Head */}
            <circle cx="12" cy="12.5" r="7.2" fill={BRAND_COLOR} />
            {/* Eyes */}
            <ellipse className="assistant-cat-eye" cx="9.3" cy="12" rx="1" ry="1.3" fill="#16161f" />
            <ellipse className="assistant-cat-eye" cx="14.7" cy="12" rx="1" ry="1.3" fill="#16161f" />
            {/* Nose + mouth */}
            <path
              d="M11.3 14.3 L12.7 14.3 L12 15.1 Z M12 15.1 Q12 16 11 16.2 M12 15.1 Q12 16 13 16.2"
              stroke="#16161f"
              strokeWidth="0.5"
              strokeLinecap="round"
              fill="#16161f"
            />
            {/* Whiskers */}
            <path
              d="M3.5 11.5 L7 12.2 M3.5 13.5 L7 13.3 M20.5 11.5 L17 12.2 M20.5 13.5 L17 13.3"
              stroke="#16161f"
              strokeWidth="0.4"
              strokeLinecap="round"
              opacity="0.5"
            />
          </svg>
        </button>
      </Tooltip>
    </>
  );
};

export default FloatingAssistantCat;
