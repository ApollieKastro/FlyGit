import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

/**
 * TOTP 2FA based on RFC 6238 (otplib v13 functional API) plus one-time
 * backup codes. Verification accepts ±30s drift (one time step).
 */
@Injectable()
export class TotpService {
  setup(user: { username: string; issuer?: string }): TotpSetup {
    const secret = generateSecret({ length: 20 });
    const issuer = user.issuer ?? 'FlyGit';
    const otpauthUrl = generateURI({ issuer, label: user.username, secret });
    const backupCodes = Array.from({ length: 8 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    return { secret, otpauthUrl, backupCodes };
  }

  async toQrDataUrl(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl, { margin: 2, width: 240 });
  }

  verify(token: string, secret: string): boolean {
    try {
      const normalized = token.replace(/\s/g, '');
      const result = verifySync({ token: normalized, secret, epochTolerance: 30 });
      return result.valid;
    } catch {
      return false;
    }
  }

  /** Accepts either a TOTP code or a backup code. */
  verifyWithBackup(token: string, secret: string, backupCodes: string[]): boolean {
    if (this.verify(token, secret)) return true;
    const normalized = token.replace(/[\s-]/g, '').toUpperCase();
    const candidate = Buffer.from(normalized);
    for (const code of backupCodes) {
      const stored = Buffer.from(code);
      if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
        return true;
      }
    }
    return false;
  }

  consumeBackupCode(token: string, backupCodes: string[]): string[] {
    const normalized = token.replace(/[\s-]/g, '').toUpperCase();
    return backupCodes.filter((code) => code !== normalized);
  }
}
