import React from 'react';
import UseAnimations from 'react-useanimations';
import type { Animation } from 'react-useanimations';
import gridAnimation from 'react-useanimations/lib/grid';
import databaseAnimation from 'react-useanimations/lib/database';
import uploadCloudAnimation from 'react-useanimations/lib/uploadCloud';
import lockAnimation from 'react-useanimations/lib/lock';
import toolAnimation from 'react-useanimations/lib/tool';

// Same badge treatment as each portal card's icon circle below — tinted
// background + matching border, icon colored instead of white-on-solid.
const BRAND_COLOR = '#18a058';

interface PortalCard {
  title: string;
  description: string;
  animation: Animation;
  path: string;
  color: string;
  badge?: string;
}

const PORTALS: PortalCard[] = [
  {
    title: 'IPAM Portal',
    description: 'Manage IP addresses, subnets, VRFs, and aggregates across your network.',
    animation: databaseAnimation,
    path: '/dashboard',
    color: '#63e2b7',
  },
  {
    title: 'File Sharing',
    description: 'Upload, store, and share files securely with encryption and malware scanning.',
    animation: uploadCloudAnimation,
    path: '/files',
    color: '#c77dff',
    badge: 'Beta',
  },
  {
    title: 'Password Manager',
    description: 'Shared team credential cabinets with per-cabinet encrypted storage.',
    animation: lockAnimation,
    path: '/vault',
    color: '#70c0e8',
  },
  {
    title: 'IT Tools',
    description: 'Handy online tools for developers — converters, encoders, generators, formatters and more.',
    animation: toolAnimation,
    path: '/it-tools/',
    color: '#f2a65a',
  },
];

const HomePage: React.FC = () => {
  const [hovered, setHovered] = React.useState<string | null>(null);

  // Touch devices never fire hover events, so a hover-triggered Lottie icon
  // simply never plays there — loop it continuously instead on those devices,
  // keep the quieter hover-only behavior on desktop/mouse.
  const supportsHover = React.useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches,
    []
  );
  const iconInteraction = supportsHover ? 'hover-replay' : 'loop';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e28',
        padding: '48px 24px',
        fontFamily: 'inherit',
      }}
    >
      <style>{`
        @keyframes betaPulse {
          0%, 100% { box-shadow: 0 2px 6px rgba(0,0,0,0.35), 0 0 0 0 rgba(229,72,77,0.55); }
          50% { box-shadow: 0 2px 6px rgba(0,0,0,0.35), 0 0 10px 3px rgba(229,72,77,0.55); }
        }
        .beta-ribbon { animation: betaPulse 2s ease-in-out infinite; }

        @keyframes cardFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .portal-card { animation: cardFadeIn 0.4s ease-out both; }

        .portal-grid { grid-template-columns: repeat(4, 1fr); }
        @media (max-width: 900px) {
          .portal-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 520px) {
          .portal-grid { grid-template-columns: 1fr; }
        }
      `}</style>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 52 }}>
        {/* Logo row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              background: `${BRAND_COLOR}18`,
              border: `1.5px solid ${BRAND_COLOR}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <UseAnimations
              animation={gridAnimation}
              interaction={iconInteraction}
              size={44}
              strokeColor={BRAND_COLOR}
              fillColor={BRAND_COLOR}
            />
          </div>
          <h2
            style={{
              color: '#fff',
              margin: 0,
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: 0.5,
              lineHeight: 1.2,
            }}
          >
            IOP Portal
          </h2>
        </div>
        {/* Subtitle on its own line */}
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, margin: 0 }}>
          Select a portal to continue
        </p>
      </div>

      {/* Cards grid */}
      <div
        className="portal-grid"
        style={{
          display: 'grid',
          gap: 20,
          width: '100%',
          maxWidth: 1120,
        }}
      >
        {PORTALS.map((portal, index) => {
          const isHovered = hovered === portal.path;
          return (
            <div
              key={portal.path}
              className="portal-card"
              role="button"
              tabIndex={0}
              onClick={() => window.open(portal.path, '_blank')}
              onKeyDown={(e) => e.key === 'Enter' && window.open(portal.path, '_blank')}
              onMouseEnter={() => setHovered(portal.path)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(portal.path)}
              onBlur={() => setHovered(null)}
              style={{
                position: 'relative',
                animationDelay: `${index * 70}ms`,
                overflow: 'hidden',
                background: '#252530',
                border: `1px solid ${isHovered ? portal.color : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 12,
                padding: '32px 24px',
                cursor: 'pointer',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                userSelect: 'none',
                transition: 'border-color 0.2s, transform 0.15s, box-shadow 0.2s',
                transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
                boxShadow: isHovered
                  ? `0 8px 32px ${portal.color}28`
                  : '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              {/* Beta ribbon — clipped to the card's rounded corner, not bleeding past its edge */}
              {portal.badge && (
                <div
                  className="beta-ribbon"
                  style={{
                    position: 'absolute',
                    top: 18,
                    left: -46,
                    width: 170,
                    padding: '5px 0',
                    background: '#e5484d',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'center',
                    textTransform: 'uppercase',
                    letterSpacing: 1.5,
                    transform: 'rotate(-45deg)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                >
                  {portal.badge}
                </div>
              )}

              {/* Icon circle */}
              <div
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  background: `${portal.color}18`,
                  border: `1.5px solid ${portal.color}44`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: portal.color,
                  marginBottom: 4,
                }}
              >
                <UseAnimations
                  animation={portal.animation}
                  interaction={iconInteraction}
                  size={44}
                  strokeColor={portal.color}
                  fillColor={portal.color}
                />
              </div>

              <h4 style={{ color: '#fff', margin: 0, fontWeight: 600, fontSize: 16 }}>
                {portal.title}
              </h4>

              <p
                style={{
                  color: 'rgba(255,255,255,0.45)',
                  fontSize: 13,
                  lineHeight: '1.55',
                  margin: 0,
                }}
              >
                {portal.description}
              </p>

              {/* Open hint */}
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: portal.color,
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.2s',
                  fontWeight: 700,
                  letterSpacing: 1.5,
                }}
              >
                OPEN →
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HomePage;
