import type { Environment } from '../types/ipRecord';

export const ENV_OPTIONS: Environment[] = [
  'Production',
  'Staging',
  'UAT',
  'QA',
  'Test',
  'Development',
  'DR',
  'Lab',
];

export const ENV_COLOR: Record<Environment, string> = {
  Production:  'red',
  Staging:     'gold',
  UAT:         'purple',
  QA:          'volcano',
  Test:        'orange',
  Development: 'cyan',
  DR:          'magenta',
  Lab:         'geekblue',
};
