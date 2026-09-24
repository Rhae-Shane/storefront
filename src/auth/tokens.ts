import { createHash, randomBytes } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError } from '../errors';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  typ: 'access';
};

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function signAccessToken(userId: string, email: string): string {
  const payload: AccessTokenPayload = {
    sub: userId,
    email,
    typ: 'access',
  };
  const options: SignOptions = {
    expiresIn: config.jwt.accessExpiresIn as SignOptions['expiresIn'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  };
  return jwt.sign(payload, config.jwt.accessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.sub !== 'string' ||
      typeof (decoded as AccessTokenPayload).email !== 'string' ||
      (decoded as AccessTokenPayload).typ !== 'access'
    ) {
      throw new UnauthorizedError('Invalid access token');
    }
    return decoded as AccessTokenPayload;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      throw err;
    }
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export function accessTokenExpiresInSeconds(): number {
  const value = config.jwt.accessExpiresIn;
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    return 900;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return amount * (multipliers[unit] ?? 60);
}
