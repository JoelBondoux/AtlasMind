import { describe, expect, it } from 'vitest';

import {
  describeConnection,
  LENS_SECRET_PREFIX,
  lensSecretKey,
  looksLikeConnectionString,
  summarizeConnectionString,
} from '../../src/core/lensCredentials';

const PASSWORD = 'sup3r-s3cret-pw';
const DSN = `postgres://app_readonly:${PASSWORD}@ep-cool-1.eu-central-1.aws.neon.tech/orders?sslmode=require`;

describe('a summary can never carry the password', () => {
  it('describes the destination without any part of the credential', () => {
    const summary = summarizeConnectionString(DSN, 'postgres');
    expect(summary?.host).toBe('ep-cool-1.eu-central-1.aws.neon.tech');
    expect(summary?.database).toBe('orders');
    expect(summary?.user).toBe('app_readonly');
    expect(JSON.stringify(summary)).not.toContain(PASSWORD);
  });

  it('keeps the password out of the rendered description', () => {
    const summary = summarizeConnectionString(DSN, 'postgres')!;
    const rendered = describeConnection(summary);
    expect(rendered).toContain('ep-cool-1.eu-central-1.aws.neon.tech');
    expect(rendered).toContain('app_readonly');
    expect(rendered).not.toContain(PASSWORD);
  });

  it('carries the username, which identifies the role, but never the secret', () => {
    // A role name is what makes "is this the read-only user?" answerable at the
    // confirmation dialog, and a username is not a credential.
    const summary = summarizeConnectionString(DSN, 'postgres')!;
    expect(summary.user).toBe('app_readonly');
    expect(Object.values(summary).join(' ')).not.toContain(PASSWORD);
  });

  it('never echoes the input when it cannot parse it', () => {
    // The only detail available about a malformed DSN is the DSN.
    expect(summarizeConnectionString(`not-a-url-${PASSWORD}`, 'postgres')).toBeUndefined();
    expect(summarizeConnectionString('', 'postgres')).toBeUndefined();
  });
});

describe('dialect agreement', () => {
  it('accepts the schemes each dialect actually uses', () => {
    expect(summarizeConnectionString('postgres://h/db', 'postgres')?.dialect).toBe('postgres');
    expect(summarizeConnectionString('postgresql://h/db', 'postgres')?.dialect).toBe('postgres');
    expect(summarizeConnectionString('mysql://h/db', 'mysql')?.dialect).toBe('mysql');
    expect(summarizeConnectionString('mariadb://h/db', 'mysql')?.dialect).toBe('mysql');
  });

  it('refuses a string whose scheme contradicts the declared kind', () => {
    // A MySQL DSN on a `postgres` endpoint would connect to nothing and report
    // the database as unreachable, blaming the wrong thing.
    expect(summarizeConnectionString('mysql://h/db', 'postgres')).toBeUndefined();
    expect(summarizeConnectionString('postgres://h/db', 'mysql')).toBeUndefined();
  });

  it('refuses a scheme that is not a database at all', () => {
    for (const dsn of ['https://example.test/db', 'file:///etc/passwd', 'redis://h/0']) {
      expect(summarizeConnectionString(dsn, 'postgres'), dsn).toBeUndefined();
    }
  });
});

describe('TLS is reported as found', () => {
  it('reads the modes each driver spells differently', () => {
    expect(summarizeConnectionString('postgres://h/db?sslmode=require', 'postgres')?.tls).toBe('required');
    expect(summarizeConnectionString('postgres://h/db?sslmode=verify-full', 'postgres')?.tls).toBe('required');
    expect(summarizeConnectionString('postgres://h/db?sslmode=prefer', 'postgres')?.tls).toBe('preferred');
    expect(summarizeConnectionString('postgres://h/db?sslmode=disable', 'postgres')?.tls).toBe('disabled');
    expect(summarizeConnectionString('mysql://h/db?ssl-mode=REQUIRED', 'mysql')?.tls).toBe('required');
  });

  it('reports an absent or unrecognised mode as unstated, never as required', () => {
    // Guessing in the reassuring direction is the one guess worth refusing.
    expect(summarizeConnectionString('postgres://h/db', 'postgres')?.tls).toBe('unstated');
    expect(summarizeConnectionString('postgres://h/db?sslmode=whatever', 'postgres')?.tls).toBe('unstated');
  });

  it('does not silently upgrade a disabled connection', () => {
    const summary = summarizeConnectionString('postgres://h/db?sslmode=disable', 'postgres')!;
    expect(describeConnection(summary)).toContain('TLS disabled');
  });
});

describe('the secret namespace', () => {
  it('prefixes every ref before it reaches SecretStorage', () => {
    expect(lensSecretKey('orders-staging')).toBe(`${LENS_SECRET_PREFIX}orders-staging`);
  });

  it('refuses a ref that would reach outside the namespace', () => {
    // Without this, a committed file could name `atlasmind.anthropic.apiKey`
    // and AtlasMind would put a provider key in a header aimed at a host that
    // same file chose.
    for (const ref of ['../anthropic.apiKey', 'a/b', 'a\\b', '..', 'a..b', '', ' leading', 'x'.repeat(200)]) {
      expect(lensSecretKey(ref), ref).toBeUndefined();
    }
  });

  it('allows the ordinary identifier shapes', () => {
    for (const ref of ['orders', 'orders_staging', 'orders-staging', 'orders.staging', 'a1']) {
      expect(lensSecretKey(ref), ref).toBe(`${LENS_SECRET_PREFIX}${ref}`);
    }
  });
});

describe('validation before storage', () => {
  it('accepts a real connection string for its dialect', () => {
    expect(looksLikeConnectionString(DSN, 'postgres')).toBe(true);
  });

  it('rejects a typo at the point somebody can still see what they pasted', () => {
    expect(looksLikeConnectionString('postgres//host/db', 'postgres')).toBe(false);
    expect(looksLikeConnectionString('psql -h host', 'postgres')).toBe(false);
  });

  it('requires a host', () => {
    expect(summarizeConnectionString('postgres:///db', 'postgres')).toBeUndefined();
  });
});
