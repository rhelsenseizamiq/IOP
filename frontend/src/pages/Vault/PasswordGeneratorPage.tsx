import React, { useState, useCallback, useEffect } from 'react';
import {
  Card, Slider, Switch, Button, Typography, Space, message, Progress, Divider, Row, Col,
} from 'antd';
import { CopyOutlined, ReloadOutlined, KeyOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const UPPER_AMBIG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const LOWER_AMBIG = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '23456789';
const DIGITS_AMBIG = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

function generatePassword(
  length: number,
  useUpper: boolean,
  useLower: boolean,
  useDigits: boolean,
  useSymbols: boolean,
  noAmbiguous: boolean,
): string {
  const charset = [
    useUpper ? (noAmbiguous ? UPPER : UPPER_AMBIG) : '',
    useLower ? (noAmbiguous ? LOWER : LOWER_AMBIG) : '',
    useDigits ? (noAmbiguous ? DIGITS : DIGITS_AMBIG) : '',
    useSymbols ? SYMBOLS : '',
  ].join('');

  if (!charset) return '';

  const array = new Uint32Array(length);
  window.crypto.getRandomValues(array);
  return Array.from(array, (n) => charset[n % charset.length]).join('');
}

function entropy(length: number, charsetSize: number): number {
  if (charsetSize === 0) return 0;
  return length * Math.log2(charsetSize);
}

function charsetSize(useUpper: boolean, useLower: boolean, useDigits: boolean, useSymbols: boolean, noAmbiguous: boolean): number {
  return (
    (useUpper ? (noAmbiguous ? UPPER : UPPER_AMBIG).length : 0) +
    (useLower ? (noAmbiguous ? LOWER : LOWER_AMBIG).length : 0) +
    (useDigits ? (noAmbiguous ? DIGITS : DIGITS_AMBIG).length : 0) +
    (useSymbols ? SYMBOLS.length : 0)
  );
}

function strengthLabel(bits: number): { label: string; color: string; percent: number } {
  if (bits < 28) return { label: 'Very Weak', color: '#ff4d4f', percent: 10 };
  if (bits < 36) return { label: 'Weak', color: '#ff7a45', percent: 25 };
  if (bits < 60) return { label: 'Fair', color: '#ffa940', percent: 50 };
  if (bits < 80) return { label: 'Strong', color: '#73d13d', percent: 75 };
  return { label: 'Very Strong', color: '#52c41a', percent: 100 };
}

const PasswordGeneratorPage: React.FC = () => {
  const [length, setLength] = useState(16);
  const [useUpper, setUseUpper] = useState(true);
  const [useLower, setUseLower] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSymbols, setUseSymbols] = useState(false);
  const [noAmbiguous, setNoAmbiguous] = useState(true);
  const [password, setPassword] = useState('');

  const generate = useCallback(() => {
    setPassword(generatePassword(length, useUpper, useLower, useDigits, useSymbols, noAmbiguous));
  }, [length, useUpper, useLower, useDigits, useSymbols, noAmbiguous]);

  useEffect(() => { generate(); }, [generate]);

  const bits = entropy(length, charsetSize(useUpper, useLower, useDigits, useSymbols, noAmbiguous));
  const strength = strengthLabel(bits);

  const copy = () => {
    if (!password) return;
    navigator.clipboard.writeText(password).then(() => message.success('Password copied'));
  };

  const options: { label: string; value: boolean; setter: (v: boolean) => void; ariaLabel: string }[] = [
    { label: 'Uppercase (A-Z)', value: useUpper, setter: setUseUpper, ariaLabel: 'Toggle uppercase letters' },
    { label: 'Lowercase (a-z)', value: useLower, setter: setUseLower, ariaLabel: 'Toggle lowercase letters' },
    { label: 'Digits (0-9)', value: useDigits, setter: setUseDigits, ariaLabel: 'Toggle digits' },
    { label: 'Symbols (!@#…)', value: useSymbols, setter: setUseSymbols, ariaLabel: 'Toggle symbols' },
    { label: 'Exclude ambiguous (l, 1, I, O, 0)', value: noAmbiguous, setter: setNoAmbiguous, ariaLabel: 'Toggle exclude ambiguous characters' },
  ];

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <Space style={{ marginBottom: 24 }}>
        <KeyOutlined style={{ fontSize: 20, color: '#1677ff' }} />
        <Title level={4} style={{ margin: 0 }}>Password Generator</Title>
      </Space>

      <Card>
        {/* Generated password display */}
        <div
          style={{
            background: '#f5f5f5',
            borderRadius: 8,
            padding: '16px 20px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            minHeight: 56,
          }}
        >
          <Text
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 18,
              wordBreak: 'break-all',
              letterSpacing: 1,
              color: password ? '#000' : '#999',
            }}
          >
            {password || 'Select at least one character type'}
          </Text>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={generate} title="Regenerate" />
            <Button icon={<CopyOutlined />} type="primary" onClick={copy} disabled={!password}>
              Copy
            </Button>
          </Space>
        </div>

        {/* Strength bar */}
        <div style={{ marginBottom: 20 }}>
          <Progress
            percent={strength.percent}
            strokeColor={strength.color}
            showInfo={false}
            size="small"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Strength: <span style={{ color: strength.color, fontWeight: 600 }}>{strength.label}</span>
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{Math.round(bits)} bits entropy</Text>
          </div>
        </div>

        <Divider style={{ margin: '16px 0' }} />

        {/* Length slider */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text strong>Length</Text>
            <Text style={{ fontFamily: 'monospace', fontSize: 15 }}>{length}</Text>
          </div>
          <Slider min={4} max={128} value={length} onChange={setLength} />
        </div>

        {/* Character set toggles */}
        <Row gutter={[0, 12]}>
          {options.map((opt) => (
            <Col span={24} key={opt.ariaLabel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text>{opt.label}</Text>
                <Switch
                  checked={opt.value}
                  onChange={opt.setter}
                  aria-label={opt.ariaLabel}
                />
              </div>
            </Col>
          ))}
        </Row>

        <div style={{ marginTop: 20, padding: '10px 14px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Generated entirely in your browser using <code>window.crypto.getRandomValues</code> — no password is ever sent to the server.
          </Text>
        </div>
      </Card>
    </div>
  );
};

export default PasswordGeneratorPage;
