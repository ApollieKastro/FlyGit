import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  Server,
  type Connection,
  type AuthContext,
  type PublicKeyAuthContext,
  type ServerChannel,
  type AcceptConnection,
} from 'ssh2';
import { createHash, createPublicKey, generateKeyPairSync, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as argon2 from 'argon2';
import { roleAtLeast } from '@flygit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GitStorageService } from './git-storage.service';
import { RepositoryAccessService } from './repository-access.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

const GIT_CMD_RE = /^(git-upload-pack|git-receive-pack)\s+['"]?([^'"]+?)['"]?\s*$/;

/**
 * Embedded SSH server providing `git clone/push` over SSH.
 *
 * Authentication: OpenSSH public keys (matched by SHA256 fingerprint,
 * signature verified against the signed blob) or account password.
 * Only git exec commands are accepted — no shell, no SFTP, no forwarding.
 *
 * URLs: ssh://<user>@<host>:<SSH_PORT>/<owner>/<repo>.git
 */
@Injectable()
export class GitSshServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GitSshServer.name);
  private server: Server | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: GitStorageService,
    private readonly access: RepositoryAccessService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SSH_ENABLED !== 'true') {
      this.logger.log('SSH git server disabled (SSH_ENABLED=false)');
      return;
    }
    try {
      const hostKey = await this.ensureHostKey();
      const port = Number(process.env.SSH_PORT ?? 2222);

      this.server = new Server({ hostKeys: [hostKey], keepaliveInterval: 15_000 });
      this.server.on('connection', (connection) => this.onConnection(connection));
      this.server.on('error', (err: Error) => this.logger.error(`SSH server error: ${err.message}`));

      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        this.server!.once('error', onError);
        this.server!.listen(port, '0.0.0.0', () => {
          this.server!.removeListener('error', onError);
          resolve();
        });
      });
      this.logger.log(`SSH git server listening on port ${port}`);
    } catch (error) {
      this.logger.error(`Failed to start SSH server: ${(error as Error).message}`);
      // Non-fatal: HTTPS git still works.
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
      setTimeout(resolve, 3000);
    });
  }

  // ───────────────────────── Connection flow ─────────────────────────

  private onConnection(connection: Connection): void {
    let authUser: AuthUser | null = null;
    let username: string | null = null;

    connection.on('authentication', (ctx: AuthContext) => {
      void this.handleAuthentication(ctx).then((result) => {
        if (result) {
          authUser = result.user;
          username = result.username;
          ctx.accept();
        } else {
          ctx.reject(['publickey', 'password']);
        }
      }).catch(() => ctx.reject(['publickey', 'password']));
    });

    connection.on('ready', () => {
      connection.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acceptChannel: AcceptConnection<ServerChannel>, _reject, info) => {
          this.handleExec(authUser, username, acceptChannel, info.command);
        });
        // No handlers for shell/sftp/subsystem → ssh2 rejects them automatically.
      });
    });

    connection.on('error', (err: Error) => {
      this.logger.debug(`SSH connection error: ${err.message}`);
    });
    connection.on('close', () => {
      authUser = null;
      username = null;
    });
  }

  private async handleAuthentication(
    ctx: AuthContext,
  ): Promise<{ user: AuthUser; username: string } | null> {
    if (ctx.method === 'publickey') {
      const pk = ctx as PublicKeyAuthContext;
      const fingerprint = fingerprintOf(pk.key.algo, pk.key.data);
      if (!fingerprint) return null;

      const key = await this.prisma.sshKey.findUnique({ where: { fingerprint } });
      if (!key) return null;
      const account = await this.prisma.user.findUnique({ where: { id: key.userId } });
      if (!account?.isActive) return null;

      // When the client provided a signature it MUST be verified — ssh2 only
      // parses the wire format, the crypto check is our responsibility.
      if (pk.signature && !verifyPublicKeySignature(pk)) return null;

      void this.prisma.sshKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
      return {
        user: {
          id: account.id,
          username: account.username,
          email: account.email,
          isAdmin: account.isAdmin,
          role: account.role,
        },
        username: account.username,
      };
    }

    if (ctx.method === 'password') {
      const account = await this.prisma.user.findFirst({
        where: { username: ctx.username.toLowerCase(), isActive: true },
      });
      if (!account) return null;
      const ok = await argon2.verify(account.passwordHash, ctx.password).catch(() => false);
      if (!ok) return null;
      return {
        user: {
          id: account.id,
          username: account.username,
          email: account.email,
          isAdmin: account.isAdmin,
          role: account.role,
        },
        username: account.username,
      };
    }

    return null;
  }

  private handleExec(
    authUser: AuthUser | null,
    username: string | null,
    accept: AcceptConnection<ServerChannel>,
    command: string,
  ): void {
    const channel = accept();

    const reject = (message: string) => {
      channel.stderr.write(`fatal: ${message}\n`);
      channel.exit(1);
      channel.end();
    };

    void this.authorizeCommand(authUser, username, command)
      .then((repoDir) => {
        if (!repoDir) return; // reject already emitted inside authorizeCommand

        const service = GIT_CMD_RE.exec(command.trim())?.[1];
        const child = spawn('git', [service!, repoDir], {
          env: {
            ...process.env,
            FLYGIT_USER: username ?? '',
            REMOTE_USER: username ?? '',
            GIT_TERMINAL_PROMPT: '0',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stdout.pipe(channel, { end: false });
        child.stderr.pipe(channel.stderr as NodeJS.WritableStream, { end: false });
        channel.pipe(child.stdin);
        channel.on('close', () => child.stdin.end());
        child.on('close', (code) => {
          channel.exit(code ?? 0);
          channel.end();
        });
        child.on('error', () => reject('internal git error'));
      })
      .catch((error: unknown) =>
        reject(error instanceof ExecRejection ? error.message : 'internal git error'),
      );
  }

  /** Validates command, identity and repository access → absolute repo path. */
  private async authorizeCommand(
    authUser: AuthUser | null,
    username: string | null,
    command: string,
  ): Promise<string | null> {
    const rejectReturn = (message: string): null => {
      // Channel rejection is handled by the caller via null + message; we
      // return null and let handleExec's caller print the message. To keep
      // the flow simple the message is attached to the error.
      throw new ExecRejection(message);
    };

    const match = GIT_CMD_RE.exec(command.trim());
    if (!match) return rejectReturn('FlyGit SSH only supports git-upload-pack / git-receive-pack');
    const service = match[1] as 'git-upload-pack' | 'git-receive-pack';

    const rawPath = match[2]!.replace(/^\/+/, '').replace(/\.git$/, '');
    const [owner, repo] = rawPath.split('/');
    if (!owner || !repo || !/^[a-z0-9._-]+$/i.test(owner) || !/^[a-z0-9._-]+$/i.test(repo)) {
      return rejectReturn('repository not found');
    }
    if (!authUser || !username) return rejectReturn('Authentication required');

    let repository;
    try {
      repository = await this.access.findRepository(owner.toLowerCase(), repo.toLowerCase());
    } catch {
      return rejectReturn('repository not found');
    }

    const required = service === 'git-receive-pack' ? 'developer' : 'guest';
    const access = await this.access.resolve(authUser, repository);
    if (!access || !roleAtLeast(access.role, required)) {
      return rejectReturn(`You need ${required} access to this repository`);
    }

    return this.storage.repoDir(owner.toLowerCase(), repo.toLowerCase());
  }

  // ───────────────────────── Host key ─────────────────────────

  private async ensureHostKey(): Promise<string> {
    const path = process.env.SSH_HOST_KEY_PATH ?? './storage/ssh/host_ed25519';
    try {
      return await readFile(path, 'utf8');
    } catch {
      const { privateKey } = generateKeyPairSync('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, privateKey, { mode: 0o600 });
      await chmod(path, 0o600);
      this.logger.log(`Generated new SSH host key at ${path}`);
      return privateKey;
    }
  }
}

class ExecRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecRejection';
  }
}

// ───────────────────────── Signature verification ─────────────────────────

/**
 * Verifies a userauth publickey signature using Node's crypto.
 * ssh2 pre-converts signatures to DER (or leaves raw Ed25519 bytes) and
 * supplies the exact signed blob (`sessionID || request`).
 */
export function verifyPublicKeySignature(ctx: PublicKeyAuthContext): boolean {
  try {
    const keyObject = sshBlobToKeyObject(ctx.key.data);
    if (!keyObject || !ctx.blob || !ctx.signature) return false;

    switch (keyObject.asymmetricKeyType) {
      case 'ed25519':
      case 'ed448':
        return cryptoVerify(null, ctx.blob, keyObject, ctx.signature);
      case 'rsa':
        return cryptoVerify(ctx.hashAlgo ?? 'sha1', ctx.blob, keyObject, ctx.signature);
      case 'ec': {
        const curve = keyObject.asymmetricKeyDetails?.namedCurve;
        const hash =
          curve === 'prime256v1' ? 'sha256' : curve === 'secp384r1' ? 'sha384' : 'sha512';
        return cryptoVerify(hash, ctx.blob, keyObject, ctx.signature);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** Converts an SSH wire-format public key blob into a Node KeyObject. */
export function sshBlobToKeyObject(blob: Buffer): KeyObject | null {
  const reader = createSshReader(blob);
  const algoBuf = reader.string();
  if (!algoBuf) return null;
  const algo = algoBuf.toString('utf8');

  if (algo === 'ssh-ed25519') {
    const raw = reader.string();
    if (!raw || raw.length !== 32) return null;
    // SPKI prefix for id-Ed25519 (RFC 8410).
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  }

  if (algo === 'ssh-rsa') {
    const e = reader.mpint();
    const n = reader.mpint();
    if (!e || !n) return null;
    return createPublicKey({
      key: { kty: 'RSA', e: toBase64Url(e), n: toBase64Url(n) },
      format: 'jwk',
    });
  }

  if (algo === 'ecdsa-sha2-nistp256' || algo === 'ecdsa-sha2-nistp384' || algo === 'ecdsa-sha2-nistp521') {
    const curveBuf = reader.string();
    const point = reader.string();
    if (!curveBuf || !point || point[0] !== 0x04) return null;
    const curveName = curveBuf.toString('utf8');
    const crv =
      curveName === 'nistp256' ? 'P-256' : curveName === 'nistp384' ? 'P-384' : 'P-521';
    const half = Math.floor((point.length - 1) / 2);
    const x = point.subarray(1, 1 + half);
    const y = point.subarray(1 + half);
    return createPublicKey({
      key: { kty: 'EC', crv, x: toBase64Url(x), y: toBase64Url(y) },
      format: 'jwk',
    });
  }

  return null;
}

function toBase64Url(buf: Buffer): string {
  let stripped = buf;
  while (stripped.length > 1 && stripped[0] === 0) stripped = stripped.subarray(1);
  return stripped.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createSshReader(buf: Buffer) {
  let offset = 0;
  const readLength = (): number | null => {
    if (offset + 4 > buf.length) return null;
    const len = buf.readUInt32BE(offset);
    offset += 4;
    return len;
  };
  return {
    string(): Buffer | null {
      const len = readLength();
      if (len === null || offset + len > buf.length) return null;
      const value = buf.subarray(offset, offset + len);
      offset += len;
      return value;
    },
    /** mpint → big-endian bytes without leading zeros. */
    mpint(): Buffer | null {
      const raw = this.string();
      if (!raw) return null;
      let stripped = raw;
      while (stripped.length > 1 && stripped[0] === 0) stripped = stripped.subarray(1);
      return stripped;
    },
  };
}

/** OpenSSH-style SHA256 fingerprint of a public key blob. */
export function fingerprintOf(algo: string, blob: Buffer): string | null {
  const supported = new Set([
    'ssh-ed25519',
    'ssh-rsa',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'sk-ssh-ed25519@openssh.com',
    'sk-ecdsa-sha2-nistp256@openssh.com',
  ]);
  const normalized = algo.startsWith('rsa-sha2-') ? 'ssh-rsa' : algo;
  if (!supported.has(normalized)) return null;
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}
