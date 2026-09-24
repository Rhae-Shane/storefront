import type { Prisma, PrismaClient, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { ConflictError, UnauthorizedError } from '../errors';
import { logger } from '../logger';
import {
  accessTokenExpiresInSeconds,
  generateRefreshToken,
  hashToken,
  signAccessToken,
} from './tokens';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  userId: string;
};

type Db = PrismaClient | Prisma.TransactionClient;

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async register(email: string, password: string): Promise<AuthTokens> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: { email: normalized, passwordHash },
    });

    return this.issueTokenPair(user);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedError('Invalid email or password');
    }

    return this.issueTokenPair(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);

    const anySession = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!anySession) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Reuse of a *rotated* refresh token is a theft signal.
    // A simply-revoked token (logout) is just invalid — don't nuke the family.
    if (anySession.revokedAt !== null) {
      if (anySession.replacedBySessionId) {
        await this.revokeAllSessions(anySession.userId);
        logger.warn(
          { userId: anySession.userId, sessionId: anySession.id },
          'Refresh token reuse detected; all sessions revoked',
        );
        throw new UnauthorizedError(
          'Refresh token reuse detected; all sessions revoked',
        );
      }
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (anySession.expiresAt <= new Date()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Re-check inside the txn to close a concurrent refresh race.
      const session = await tx.refreshSession.findFirst({
        where: {
          id: anySession.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
      });

      if (!session) {
        // Lost the race to another refresh → treat as reuse.
        await tx.refreshSession.updateMany({
          where: { userId: anySession.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        throw new UnauthorizedError(
          'Refresh token reuse detected; all sessions revoked',
        );
      }

      const { tokens, sessionId } = await this.createTokenPair(
        session.user,
        tx,
      );

      await tx.refreshSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          replacedBySessionId: sessionId,
        },
      });

      return tokens;
    }, {
      maxWait: 10_000,
      timeout: 20_000,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revokeAllSessions(userId);
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPair(user: User): Promise<AuthTokens> {
    const { tokens } = await this.createTokenPair(user);
    return tokens;
  }

  private async createTokenPair(
    user: User,
    db: Db = this.prisma,
  ): Promise<{ tokens: AuthTokens; sessionId: string }> {
    const accessToken = signAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(
      expiresAt.getDate() + config.jwt.refreshExpiresDays,
    );

    const session = await db.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt,
      },
    });

    return {
      sessionId: session.id,
      tokens: {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: accessTokenExpiresInSeconds(),
        userId: user.id,
      },
    };
  }
}
