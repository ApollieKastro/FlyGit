import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export type MailLocale = 'ru' | 'en' | 'zh-CN';

interface MailStrings {
  confirmSubject: string;
  confirmTitle: string;
  confirmText: string;
  confirmCta: string;
  resetSubject: string;
  resetTitle: string;
  resetText: string;
  resetCta: string;
  resetNote: string;
  inviteSubject: string;
  inviteTitle: string;
  inviteText: (org: string) => string;
  inviteCta: string;
  footer: string;
}

const STRINGS: Record<MailLocale, MailStrings> = {
  en: {
    confirmSubject: 'Confirm your FlyGit email address',
    confirmTitle: 'Welcome to FlyGit!',
    confirmText: 'Please confirm your email address to activate your account.',
    confirmCta: 'Confirm email',
    resetSubject: 'Reset your FlyGit password',
    resetTitle: 'Password reset requested',
    resetText: 'We received a request to reset your password. Follow the link below to choose a new one.',
    resetCta: 'Reset password',
    resetNote: 'If you did not request this, you can safely ignore this email. The link expires in 1 hour.',
    inviteSubject: 'You have been invited to FlyGit',
    inviteTitle: 'Organization invitation',
    inviteText: (org) => `You have been invited to join the organization "${org}" on FlyGit.`,
    inviteCta: 'Accept invitation',
    footer: 'FlyGit — self-hosted Git platform',
  },
  ru: {
    confirmSubject: 'Подтвердите email во FlyGit',
    confirmTitle: 'Добро пожаловать во FlyGit!',
    confirmText: 'Подтвердите адрес электронной почты, чтобы активировать аккаунт.',
    confirmCta: 'Подтвердить email',
    resetSubject: 'Сброс пароля во FlyGit',
    resetTitle: 'Запрошен сброс пароля',
    resetText: 'Мы получили запрос на сброс пароля. Перейдите по ссылке ниже, чтобы задать новый.',
    resetCta: 'Сбросить пароль',
    resetNote: 'Если вы не запрашивали сброс — просто проигнорируйте письмо. Ссылка действует 1 час.',
    inviteSubject: 'Вас приглашают во FlyGit',
    inviteTitle: 'Приглашение в организацию',
    inviteText: (org) => `Вас пригласили присоединиться к организации «${org}» во FlyGit.`,
    inviteCta: 'Принять приглашение',
    footer: 'FlyGit — self-hosted Git-платформа',
  },
  'zh-CN': {
    confirmSubject: '确认您的 FlyGit 邮箱地址',
    confirmTitle: '欢迎使用 FlyGit！',
    confirmText: '请确认您的电子邮件地址以激活账户。',
    confirmCta: '确认邮箱',
    resetSubject: '重置您的 FlyGit 密码',
    resetTitle: '已请求重置密码',
    resetText: '我们收到了重置密码的请求。请通过下面的链接设置新密码。',
    resetCta: '重置密码',
    resetNote: '如果这不是您本人的操作，请忽略此邮件。链接 1 小时内有效。',
    inviteSubject: '您被邀请加入 FlyGit',
    inviteTitle: '组织邀请',
    inviteText: (org) => `有人邀请您加入 FlyGit 上的组织「${org}」。`,
    inviteCta: '接受邀请',
    footer: 'FlyGit — 自托管 Git 平台',
  },
};

export interface MailMessage {
  to: string;
  subject: string;
  /** Pre-rendered plain-text body. */
  text: string;
  html: string;
}

/** Rendered message without recipient — produced by MailTemplates. */
export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

/** Renders branded, localized transactional emails. */
export class MailTemplates {
  static confirmEmail(locale: MailLocale, confirmUrl: string): RenderedMail {
    const s = STRINGS[locale] ?? STRINGS.en;
    return {
      subject: s.confirmSubject,
      text: `${s.confirmTitle}\n\n${s.confirmText}\n\n${confirmUrl}\n\n— ${s.footer}`,
      html: MailTemplates.layout(s.confirmTitle, `<p>${s.confirmText}</p>`, confirmUrl, s.confirmCta, s.footer),
    };
  }

  static passwordReset(locale: MailLocale, resetUrl: string) {
    const s = STRINGS[locale] ?? STRINGS.en;
    return {
      subject: s.resetSubject,
      text: `${s.resetTitle}\n\n${s.resetText}\n\n${resetUrl}\n\n${s.resetNote}\n\n— ${s.footer}`,
      html: MailTemplates.layout(
        s.resetTitle,
        `<p>${s.resetText}</p><p class="note">${s.resetNote}</p>`,
        resetUrl,
        s.resetCta,
        s.footer,
      ),
    };
  }

  static invitation(locale: MailLocale, orgName: string, inviteUrl: string) {
    const s = STRINGS[locale] ?? STRINGS.en;
    return {
      subject: s.inviteSubject,
      text: `${s.inviteTitle}\n\n${s.inviteText(orgName)}\n\n${inviteUrl}\n\n— ${s.footer}`,
      html: MailTemplates.layout(s.inviteTitle, `<p>${s.inviteText(orgName)}</p>`, inviteUrl, s.inviteCta, s.footer),
    };
  }

  private static layout(title: string, body: string, ctaUrl: string, cta: string, footer: string): string {
    return `<!doctype html><html><body style="margin:0;background:#0B0D12;font-family:Inter,Segoe UI,Arial,sans-serif;padding:32px 16px;">
      <div style="max-width:520px;margin:0 auto;background:#11141B;border:1px solid #232833;border-radius:16px;padding:32px;">
        <div style="font-size:14px;font-weight:700;color:#5B7CFA;letter-spacing:.08em;text-transform:uppercase;">FlyGit</div>
        <h1 style="color:#F5F7FA;font-size:20px;margin:16px 0 12px;">${title}</h1>
        <div style="color:#9AA4B2;font-size:14px;line-height:1.6;">${body}</div>
        <a href="${ctaUrl}" style="display:inline-block;margin-top:24px;background:#5B7CFA;color:#fff;text-decoration:none;padding:10px 20px;border-radius:12px;font-size:14px;font-weight:600;">${cta}</a>
        <div style="color:#5A6474;font-size:12px;margin-top:32px;border-top:1px solid #232833;padding-top:16px;">${footer}</div>
      </div></body></html>`;
  }
}

/**
 * Mail delivery with pluggable driver:
 *  - `log`  — writes to the application log (development default)
 *  - `smtp` — delivers through configured SMTP server
 *  - `none` — silently discards (tests)
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor() {
    const driver = process.env.MAIL_DRIVER ?? 'log';
    if (driver === 'smtp' && process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }
  }

  async send(to: string, message: { subject: string; text: string; html: string }): Promise<void> {
    const driver = process.env.MAIL_DRIVER ?? 'log';
    if (driver === 'none') return;
    if (driver === 'log' || !this.transporter) {
      this.logger.log(`[MAIL → ${to}] ${message.subject}\n${message.text}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM ?? 'FlyGit <noreply@flygit.local>',
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${(error as Error).message}`);
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) return true;
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
