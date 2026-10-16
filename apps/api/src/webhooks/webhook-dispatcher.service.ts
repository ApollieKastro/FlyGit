import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export type WebhookEvent =
  | 'push'
  | 'issue'
  | 'issue_comment'
  | 'merge_request'
  | 'merge_request_comment'
  | 'release'
  | 'member';

export interface WebhookPayload {
  event: WebhookEvent;
  repository?: { id: string; owner: string; name: string; fullName: string; url: string };
  [key: string]: unknown;
}

/**
 * Delivers repository webhooks (HMAC-SHA256 signed) to external endpoints.
 * Deliveries are fire-and-forget with a hard timeout; failures are recorded
 * in webhook_deliveries for the repository settings UI.
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  async dispatch(repositoryId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
    try {
      const hooks = await this.prisma.webhook.findMany({
        where: { repositoryId, active: true },
      });
      if (!hooks.length) return;

      const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } });
      const owner = await this.resolveOwner(repo.ownerType, repo.ownerId);
      const payload: WebhookPayload = {
        event,
        repository: {
          id: repo.id,
          owner: owner.slug,
          name: repo.name,
          fullName: `${owner.slug}/${repo.slug}`,
          url: `${process.env.APP_URL}/${owner.slug}/${repo.slug}`,
        },
        ...data,
      };
      const body = JSON.stringify(payload);

      await Promise.allSettled(hooks.map((hook) => this.deliver(hook, event, body)));
    } catch (error) {
      this.logger.warn(`webhook dispatch failed: ${(error as Error).message}`);
    }
  }

  private async deliver(
    hook: { id: string; url: string; secret: string | null; events: string[] },
    event: WebhookEvent,
    body: string,
  ): Promise<void> {
    if (!hook.events.includes(event)) return;
    const startedAt = Date.now();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-flygit-event': event,
      'user-agent': 'FlyGit-Webhook/1.0',
    };
    if (hook.secret) {
      headers['x-flygit-signature'] = `sha256=${createHmac('sha256', hook.secret).update(body).digest('hex')}`;
    }

    const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 10_000);
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      await this.prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          event,
          payload: JSON.parse(body) as object,
          responseCode: response.status,
          success: response.ok,
          error: response.ok ? null : `HTTP ${response.status}`,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      await this.prisma.webhookDelivery
        .create({
          data: {
            webhookId: hook.id,
            event,
            payload: JSON.parse(body) as object,
            responseCode: null,
            success: false,
            error: (error as Error).message.slice(0, 500),
            durationMs: Date.now() - startedAt,
          },
        })
        .catch(() => undefined);
    }
  }

  private async resolveOwner(ownerType: 'user' | 'organization', ownerId: string) {
    if (ownerType === 'user') {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
        select: { username: true },
      });
      return { slug: user.username };
    }
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: ownerId },
      select: { slug: true },
    });
    return { slug: org.slug };
  }
}
